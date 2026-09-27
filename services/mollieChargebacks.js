'use strict';

// A paid Mollie payment stays paid after a chargeback. The separate chargeback
// resources carry the amount and reversedAt; never infer this from status alone.
async function syncMollieChargebacks(connection, payment) {
    if (!Array.isArray(payment.chargebacks)) return { active: false };
    const [sources] = await connection.execute(
        `SELECT order_id, order_item_id FROM rental_order_payments
         WHERE mollie_payment_id = ? AND payment_method = 'online'
         AND payment_type IN ('initial_payment', 'rental', 'deposit', 'rental_adjustment', 'return_additional_charge')
         ORDER BY (payment_type = 'initial_payment') DESC, id ASC LIMIT 1`, [payment.id]
    );
    if (!sources.length) return { active: false };
    const source = sources[0];
    const [orders] = await connection.execute(
        'SELECT payment_status FROM rental_orders WHERE id = ? FOR UPDATE', [source.order_id]
    );
    for (const chargeback of payment.chargebacks) {
        const amount = Number(chargeback.amount?.value);
        if (!/^chb_[A-Za-z0-9_]+$/.test(chargeback.id) ||
            (chargeback.paymentId && chargeback.paymentId !== payment.id) ||
            chargeback.amount?.currency !== 'EUR' || !Number.isFinite(amount) || amount <= 0) {
            throw new Error('Ungültige Mollie-Chargeback-Daten.');
        }
        const reversed = Boolean(chargeback.reversedAt);
        await connection.execute(
            `INSERT INTO rental_order_payments
             (order_id, order_item_id, payment_type, payment_method, payment_status,
              amount, mollie_payment_id, external_operation_key, note)
             VALUES (?, ?, 'chargeback', 'online', ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE payment_status = VALUES(payment_status),
                 amount = VALUES(amount), note = VALUES(note)`,
            [source.order_id, source.order_item_id, reversed ? 'cancelled' : 'charged_back',
                -amount, payment.id, `mollie-chargeback-${chargeback.id}`,
                `Mollie ${chargeback.id}: ${reversed ? 'Rückbuchung aufgehoben' : 'Rückbuchung'}${chargeback.reason?.description ? ` – ${chargeback.reason.description}` : ''}`]
        );
    }
    const [active] = await connection.execute(
        `SELECT id FROM rental_order_payments WHERE order_id = ?
         AND payment_type = 'chargeback' AND payment_status = 'charged_back' LIMIT 1`, [source.order_id]
    );
    if (active.length) {
        await connection.execute(
            `UPDATE rental_orders SET payment_status = 'charged_back', return_case_status = 'payment_dispute'
             WHERE id = ?`, [source.order_id]
        );
    } else if (orders[0]?.payment_status === 'charged_back') {
        // Restore the financial state only. Pickup, return and cancellation remain intact.
        await connection.execute(
            `UPDATE rental_orders ro SET payment_status = COALESCE(
                (SELECT p.payment_status FROM rental_order_payments p
                 WHERE p.order_id = ro.id AND p.payment_type = 'initial_payment'
                 AND p.mollie_payment_id = ro.mollie_payment_id ORDER BY p.id DESC LIMIT 1), 'paid'),
                return_case_status = NULL WHERE ro.id = ?`, [source.order_id]
        );
    }
    return { active: active.length > 0, orderId: source.order_id };
}

module.exports = { syncMollieChargebacks };
