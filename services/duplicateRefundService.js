'use strict';
const { lockBookingOrder } = require('./bookingPaymentService');
const { enqueueMollieRefundCreation } = require('./externalEffectsOutbox');
const { validateProviderAmount, providerContractError } = require('./paymentStateService');

// All recovery entrypoints share one provider idempotency identity and payload.
// A pending refund consumes capacity already; retries cannot spend it twice.
async function ensureDuplicatePaymentRefund(connection, { orderId, orderItemId = null, paymentId, amount, note }) {
    const cents = validateProviderAmount({ currency: 'EUR', value: Number(amount).toFixed(2) });
    if (!cents) return null;
    const { order } = await lockBookingOrder(connection, orderId);
    if (!order) throw providerContractError();
    const [existing] = await connection.execute(
        `SELECT id, payment_status FROM rental_order_payments
         WHERE order_id = ? AND mollie_payment_id = ? AND payment_type = 'duplicate_payment_refund'
         ORDER BY id DESC LIMIT 1 FOR UPDATE`, [orderId, paymentId]
    );
    if (existing.length) return existing[0].payment_status;
    const [consumed] = await connection.execute(
        `SELECT amount FROM rental_order_payments
         WHERE order_id = ? AND mollie_payment_id = ? AND amount < 0
         AND payment_type IN ('deposit_refund', 'order_cancellation_refund', 'duplicate_payment_refund', 'chargeback')
         AND payment_status NOT IN ('failed', 'cancelled') ORDER BY id FOR UPDATE`, [orderId, paymentId]
    );
    const refundCents = Math.max(cents - consumed.reduce((sum, row) => sum + Math.round(Math.abs(Number(row.amount)) * 100), 0), 0);
    if (!refundCents) return null;
    const refundAmount = (refundCents / 100).toFixed(2);
    const operationKey = `duplicate-payment-refund-${paymentId}`;
    const [record] = await connection.execute(
        `INSERT INTO rental_order_payments
         (order_id, order_item_id, payment_type, payment_method, payment_status, amount, mollie_payment_id, external_operation_key, note)
         VALUES (?, ?, 'duplicate_payment_refund', 'online', 'pending', ?, ?, ?, ?)`,
        [orderId, orderItemId, `-${refundAmount}`, paymentId, operationKey, note || 'Zusätzliche Onlinezahlung zur Erstattung vorgemerkt']
    );
    await enqueueMollieRefundCreation(connection, {
        operationKey,
        refund: {
            paymentId, amount: Number(refundAmount), description: 'Automatische Erstattung einer zusätzlichen Onlinezahlung',
            metadata: { orderId: String(orderId), itemId: orderItemId ? String(orderItemId) : null, type: 'duplicate_payment_refund' }
        },
        application: { kind: 'refund_record', paymentRecordId: Number(record.insertId) }
    });
    return 'pending';
}
module.exports = { ensureDuplicatePaymentRefund };
