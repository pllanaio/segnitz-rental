'use strict';
const { toCents } = require('./orderFinanceService');

// Caller owns product/order locks and has validated current rental days and
// availability. A zero payable contract never creates a provider operation.
async function settleZeroAmountBooking(connection, { orderId, paymentMethod, totalAmount, items }) {
    if (toCents(totalAmount) !== 0) return false;
    if (!items?.length || items.some(item => toCents(item.pricePerDay ?? item.price_per_day) !== 0 || toCents(item.deposit) !== 0)) {
        throw new Error('Der kostenfreie Auftrag stimmt nicht mit seinen Mietpositionen überein.');
    }
    const [contradictory] = await connection.execute(
        `SELECT id FROM rental_order_payments WHERE order_id = ? AND amount != 0
         AND payment_type IN ('initial_payment', 'rental', 'deposit') LIMIT 1 FOR UPDATE`, [orderId]
    );
    if (contradictory.length) throw new Error('Ein kostenfreier Auftrag enthält widersprüchliche Zahlungsabsichten.');
    await connection.execute(
        `UPDATE rental_orders SET payment_method = ?, payment_status = 'paid', status = 'confirmed',
         reserved_until = NULL, paid_at = COALESCE(paid_at, NOW()),
         confirmation_json = JSON_SET(COALESCE(confirmation_json, JSON_OBJECT()), '$.status', 'confirmed') WHERE id = ?`,
        [paymentMethod, orderId]
    );
    await connection.execute(
        `UPDATE rental_order_items SET item_status = 'active', return_status = NULL
         WHERE order_id = ? AND item_status = 'expired'`, [orderId]
    );
    await connection.execute(
        `UPDATE rental_order_payments SET payment_status = 'paid', paid_at = COALESCE(paid_at, NOW())
         WHERE order_id = ? AND amount = 0 AND payment_type IN ('initial_payment', 'rental', 'deposit')`, [orderId]
    );
    await connection.execute(
        `INSERT INTO rental_order_payments (order_id, payment_type, payment_method, payment_status, amount, paid_at, note)
         SELECT ?, 'rental', ?, 'paid', 0, NOW(), 'Kostenfreier Mietauftrag; keine Providerzahlung erforderlich'
         WHERE NOT EXISTS (SELECT 1 FROM rental_order_payments WHERE order_id = ? AND payment_type = 'rental' AND amount = 0)`,
        [orderId, paymentMethod, orderId]
    );
    return true;
}
module.exports = { settleZeroAmountBooking };
