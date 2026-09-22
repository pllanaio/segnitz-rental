'use strict';

const { lockRentalProducts, checkProductAvailability } = require('../utils/availability');
const { deriveOrderStatusFromInitialPayment, transitionPaymentStatus } = require('./paymentStateService');
const { formatDateInTimeZone } = require('../utils/businessDate');

// All booking/payment writers acquire products (ascending), then the order, then
// payment/item rows. Network requests must finish before entering this boundary.
async function lockBookingOrder(connection, orderId) {
    const [references] = await connection.execute(
        'SELECT product_id FROM rental_order_items WHERE order_id = ? ORDER BY product_id, id', [orderId]
    );
    const products = await lockRentalProducts(connection, references.map(item => item.product_id));
    const [orders] = await connection.execute(
        'SELECT * FROM rental_orders WHERE id = ? FOR UPDATE', [orderId]
    );
    return { order: orders[0] || null, products: products || [] };
}

async function lockBookingForProviderPayment(connection, paymentId) {
    const [references] = await connection.execute(
        `SELECT order_id FROM rental_order_payments WHERE mollie_payment_id = ?
         UNION SELECT id AS order_id FROM rental_orders WHERE mollie_payment_id = ?`, [paymentId, paymentId]
    );
    if (references.length > 1) {
        const error = new Error('Eine Providerzahlung ist mehreren Aufträgen zugeordnet.');
        error.code = 'PROVIDER_CONTRACT_MISMATCH';
        throw error;
    }
    if (!references.length) return null;
    return lockBookingOrder(connection, references[0].order_id);
}

async function resolveInitialPaymentBooking(connection, order, observedStatus, options = {}) {
    let status = deriveOrderStatusFromInitialPayment(order.status, observedStatus);
    const paymentStatus = transitionPaymentStatus(order.payment_status, observedStatus);
    const waiting = ['reserved', 'pending_payment', 'payment_failed'].includes(order.status);
    if (!waiting) return { status, paymentStatus, reservationLost: false };
    if (paymentStatus !== 'paid') return { status: observedStatus === 'paid' ? order.status : status, paymentStatus, reservationLost: false };

    const [items] = await connection.execute(
        `SELECT id, product_id, item_status, returned_at,
                DATE_FORMAT(COALESCE(adjusted_rental_start, rental_start), '%Y-%m-%d') AS rental_start,
                DATE_FORMAT(COALESCE(adjusted_rental_end, rental_end), '%Y-%m-%d') AS rental_end
         FROM rental_order_items WHERE order_id = ? AND COALESCE(item_status, 'active') != 'cancelled' ORDER BY product_id, id FOR UPDATE`, [order.id]
    );
    const businessDay = formatDateInTimeZone(options.now || new Date());
    let available = items.length > 0 && !(options.products || []).some(product => Number(product.is_active) !== 1);
    for (const item of items) {
        if (item.returned_at || ['cancelled', 'expired'].includes(item.item_status) || item.rental_start < businessDay ||
            !await checkProductAvailability(connection, item.product_id, item.rental_start, item.rental_end, item.id, true)) {
            available = false;
            break;
        }
    }
    if (!available) {
        status = 'expired';
        // Expiring first is essential: callers create the refund intent in this
        // same transaction and must never send a rental confirmation for it.
        await connection.execute("UPDATE rental_orders SET status = 'expired', reserved_until = NULL WHERE id = ?", [order.id]);
        await connection.execute(
            "UPDATE rental_order_items SET item_status = 'expired' WHERE order_id = ? AND COALESCE(item_status, 'active') = 'active' AND returned_at IS NULL", [order.id]
        );
        return { status, paymentStatus, reservationLost: true };
    }
    return { status: 'confirmed', paymentStatus, reservationLost: false };
}

async function lockExternalEffectPaymentContext(connection, effect) {
    const application = effect.payload?.application;
    if (!application) return;
    // Mail completion updates the order's sent timestamp. Acquire the same
    // product/order locks before its outbox row as payment reconciliation does.
    if (application.kind === 'order_confirmation_mail') return lockBookingOrder(connection, application.orderId);
    if (application.kind === 'cancel_payment') return lockBookingForProviderPayment(connection, application.paymentId);
    if (!['payment_records', 'refund_record'].includes(application.kind)) return;
    if (application.orderId) return lockBookingOrder(connection, application.orderId);
    const ids = application.kind === 'refund_record' ? [application.paymentRecordId] : application.paymentRecordIds || [];
    if (!ids.length) return;
    const [rows] = await connection.execute(
        `SELECT DISTINCT order_id FROM rental_order_payments WHERE id IN (${ids.map(() => '?').join(',')})`, ids
    );
    if (rows.length > 1) throw new Error('Eine Zahlungsoperation darf nur einen Mietauftrag betreffen.');
    if (rows.length) return lockBookingOrder(connection, rows[0].order_id);
}

module.exports = { lockExternalEffectPaymentContext, lockBookingOrder, lockBookingForProviderPayment, resolveInitialPaymentBooking };
