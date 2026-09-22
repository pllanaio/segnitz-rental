'use strict';

const { mapMollieRefundStatus, transitionRefundStatus, validateProviderAmount, providerContractError } = require('./paymentStateService');

async function applyRefundObservation(connection, paymentId, refund) {
    if (!refund || !/^re_[A-Za-z0-9_-]+$/.test(refund.id || '') || refund.paymentId !== paymentId) throw providerContractError();
    let [records] = await connection.execute(
        `SELECT id, amount, payment_status, mollie_payment_id FROM rental_order_payments
         WHERE mollie_refund_id = ? ORDER BY id FOR UPDATE`, [refund.id]
    );
    if (!records.length && typeof refund.metadata?.externalOperationKey === 'string') {
        [records] = await connection.execute(
            `SELECT id, order_id, amount, payment_status, mollie_payment_id FROM rental_order_payments
             WHERE external_operation_key = ? AND mollie_refund_id IS NULL FOR UPDATE`,
            [refund.metadata.externalOperationKey]
        );
        for (const record of records) {
            if (record.mollie_payment_id !== paymentId ||
                (refund.metadata.orderId && String(refund.metadata.orderId) !== String(record.order_id))) throw providerContractError();
            validateProviderAmount(refund.amount, record.amount);
            await connection.execute('UPDATE rental_order_payments SET mollie_refund_id = ? WHERE id = ?', [refund.id, record.id]);
        }
    }
    if (!records.length) {
        const error = new Error('Provider-Erstattung ohne eindeutig zugeordnete lokale Absicht; manuelle Klärung erforderlich.');
        error.code = 'PROVIDER_REFUND_UNMATCHED';
        throw error;
    }
    for (const record of records) {
        if (record.mollie_payment_id !== paymentId) throw providerContractError();
        validateProviderAmount(refund.amount, record.amount);
        const status = transitionRefundStatus(record.payment_status, mapMollieRefundStatus(refund.status));
        await connection.execute(
            `UPDATE rental_order_payments SET payment_status = ?,
             paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END WHERE id = ?`,
            [status, status, record.id]
        );
    }
    return records.length;
}

// Provider resource IDs are the idempotency identity, not a mutable payment status.
// A reversal is terminal for its chargeback ID, so an older non-reversed snapshot
// can never reintroduce the loss. Amount and original payment remain auditable.
async function applyChargebackObservations(connection, payment, chargebacks, context) {
    if (!context) return;
    const sourceCents = validateProviderAmount(payment.amount, context.providerAmount ?? context.amount);
    if (payment.amountChargedBack) {
        const aggregate = validateProviderAmount(payment.amountChargedBack);
        const listed = chargebacks.reduce((total, entry) => total + (entry.reversedAt ? 0 : validateProviderAmount(entry.amount)), 0);
        if (aggregate !== listed) {
            const error = new Error('Chargeback-Aggregat und Ressourcen sind noch nicht konsistent; Abgleich wird wiederholt.');
            error.code = 'PROVIDER_OBSERVATION_INCOMPLETE';
            throw error;
        }
    }
    const seen = new Set();
    let totalCents = 0;
    for (const chargeback of chargebacks) {
        if (!/^chb_[A-Za-z0-9_-]+$/.test(chargeback?.id || '') || chargeback.paymentId !== payment.id || seen.has(chargeback.id)) throw providerContractError();
        seen.add(chargeback.id);
        const cents = validateProviderAmount(chargeback.amount);
        if (!cents || cents > sourceCents || (chargeback.reversedAt && !Number.isFinite(Date.parse(chargeback.reversedAt)))) throw providerContractError();
        if (!chargeback.reversedAt) totalCents += cents;
        if (totalCents > sourceCents) throw providerContractError();
        const key = `mollie-chargeback-${payment.id}-${chargeback.id}`;
        const [existing] = await connection.execute(
            'SELECT id, order_id, amount, payment_status FROM rental_order_payments WHERE external_operation_key = ? FOR UPDATE', [key]
        );
        if (existing.length) {
            if (Number(existing[0].order_id) !== Number(context.order_id)) throw providerContractError();
            validateProviderAmount(chargeback.amount, existing[0].amount);
            if (chargeback.reversedAt) await connection.execute("UPDATE rental_order_payments SET payment_status = 'cancelled' WHERE id = ?", [existing[0].id]);
        } else {
            await connection.execute(
                `INSERT INTO rental_order_payments
                 (order_id, order_item_id, payment_type, payment_method, payment_status, amount, mollie_payment_id, external_operation_key, note)
                 VALUES (?, ?, 'chargeback', 'online', ?, ?, ?, ?, ?)`,
                [context.order_id, context.order_item_id || null, chargeback.reversedAt ? 'cancelled' : 'charged_back',
                    (-cents / 100).toFixed(2), payment.id, key,
                    `Mollie Chargeback ${chargeback.id}; EUR${chargeback.reversedAt ? '; aufgehoben' : ''}`]
            );
        }
    }
    const [active] = await connection.execute(
        "SELECT id, payment_status FROM rental_order_payments WHERE order_id = ? AND payment_type = 'chargeback' ORDER BY id FOR UPDATE", [context.order_id]
    );
    const activeCount = active.filter(row => row.payment_status === 'charged_back').length;
    if (activeCount > 0) {
        await connection.execute(
            "UPDATE rental_orders SET payment_status = 'charged_back', return_case_status = 'payment_dispute' WHERE id = ?", [context.order_id]
        );
    } else if (active.length > 0) {
        await connection.execute(
            "UPDATE rental_orders SET payment_status = 'paid' WHERE id = ? AND payment_status = 'charged_back'", [context.order_id]
        );
    }
    return activeCount;
}

module.exports = { applyRefundObservation, applyChargebackObservations };
