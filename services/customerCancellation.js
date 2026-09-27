'use strict';

function fail(message, statusCode) { throw Object.assign(new Error(message), { statusCode }); }

// Caller owns the transaction. Serialize against pickup and payment settlement.
async function cancelCustomerOrder(connection, orderId, customerEmail, services) {
    const [[order]] = await connection.execute(
        `SELECT id, order_no, customer_email, status, cart_id, payment_method, payment_status
         FROM rental_orders WHERE id = ? FOR UPDATE`, [orderId]
    );
    if (!order || order.customer_email.toLowerCase() !== customerEmail.toLowerCase()) {
        fail('Bestellung nicht gefunden oder kein Zugriff.', 404);
    }
    if (order.status === 'cancelled') return { orderId: order.id, alreadyCancelled: true };
    const [pickedUp] = await connection.execute(
        `SELECT id FROM rental_order_items WHERE order_id = ?
         AND (picked_up_at IS NOT NULL OR item_status = 'picked_up' OR returned_at IS NOT NULL)
         LIMIT 1 FOR UPDATE`, [order.id]
    );
    if (pickedUp.length || !['reserved', 'pending_payment', 'payment_failed', 'confirmed'].includes(order.status)) {
        fail('Eine automatische Stornierung ist nur vor der Abholung möglich. Sie können unabhängig davon eine Widerrufserklärung übermitteln.', 409);
    }
    await services.cancelOpenMolliePayments(connection, order.id, { reason: 'Kostenfreie Kundenstornierung' });
    await connection.execute(
        `UPDATE rental_orders SET status = 'cancelled', return_case_status = 'closed',
         cancel_reason = 'Kostenfreie Stornierung durch Kunden vor Abholung',
         cancelled_by_name = ?, cancelled_at = NOW() WHERE id = ?`, [customerEmail, order.id]
    );
    await connection.execute(
        `UPDATE rental_order_items SET item_status = 'cancelled', cancelled_at = NOW(),
         cancel_reason = 'Kostenfreie Kundenstornierung', cancelled_by_name = ?
         WHERE order_id = ? AND COALESCE(item_status, 'active') = 'active'`, [customerEmail, order.id]
    );
    await services.createCancellationRefunds(connection, order);
    await services.refreshCancelledOrderPaymentStatus(connection, order.id);
    if (order.cart_id) await connection.execute('DELETE FROM rental_carts WHERE id = ?', [order.cart_id]);
    await services.sendOrderCancelledEmail(order, 'Kostenfreie Stornierung durch Kunden vor Abholung', {
        connection, operationKey: `mail-order-cancelled-${order.id}`
    });
    return { orderId: order.id, alreadyCancelled: false };
}

module.exports = { cancelCustomerOrder };
