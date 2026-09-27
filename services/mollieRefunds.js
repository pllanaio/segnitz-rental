'use strict';
const { listMollieRefundsForPayment } = require('./mollieService');
const { mapMollieRefundStatus } = require('./paymentStateService');

async function syncMollieRefundsForPayment(connection, paymentId, prefetchedRefunds = null) {
    const refunds = prefetchedRefunds || await listMollieRefundsForPayment(paymentId);
    const refundList =
        refunds?._embedded?.refunds ||
        refunds?._embedded?.payment_refunds ||
        (Array.isArray(refunds) ? refunds : []);

    for (const refund of refundList) {
        if (!refund?.id) continue;

        const status = mapMollieRefundStatus(refund.status);
        if (refund.metadata?.operationKey) {
            await connection.execute(
                `UPDATE rental_order_payments SET mollie_refund_id = ?
                 WHERE external_operation_key = ? AND mollie_payment_id = ?
                 AND payment_type IN ('deposit_refund', 'order_cancellation_refund', 'duplicate_payment_refund')
                 AND (mollie_refund_id IS NULL OR mollie_refund_id = ?)`,
                [refund.id, refund.metadata.operationKey, paymentId, refund.id]
            );
        }
        // Also reconcile refunds created directly in the Mollie Dashboard.
        await connection.execute(
            `INSERT INTO rental_order_payments
             (order_id, order_item_id, payment_type, payment_method, payment_status,
              amount, mollie_payment_id, mollie_refund_id, external_operation_key, note)
             SELECT source.order_id, source.order_item_id, 'refund_record', 'online', ?,
                    ?, ?, ?, ?, 'Erstattung im Mollie Dashboard'
             FROM rental_order_payments source
             WHERE source.mollie_payment_id = ?
             AND source.payment_type IN ('initial_payment', 'rental', 'deposit', 'rental_adjustment', 'return_additional_charge')
             AND NOT EXISTS (SELECT 1 FROM rental_order_payments known WHERE known.mollie_refund_id = ?)
             ORDER BY (source.payment_type = 'initial_payment') DESC, source.id LIMIT 1
             ON DUPLICATE KEY UPDATE id = rental_order_payments.id`,
            [status, -Math.abs(Number(refund.amount?.value || 0)), paymentId, refund.id,
                `mollie-refund-${refund.id}`, paymentId, refund.id]
        );
        await connection.execute(
            `UPDATE rental_order_payments
             SET payment_status = ?,
                 paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, NOW()) ELSE NULL END
             WHERE mollie_refund_id = ?`,
            [status, status, refund.id]
        );
    }
}

module.exports = { syncMollieRefundsForPayment };
