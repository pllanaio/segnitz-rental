'use strict';

const crypto = require('node:crypto');
const {
    EFFECT_TYPES,
    OUTBOX_STATUSES,
    claimExternalEffect,
    completeExternalEffect,
    createOperationKey,
    failExternalEffect,
    getExternalEffect,
    purgeExternalEffects,
    enqueueExternalEffect,
    enqueueMollieRefundCreation
} = require('./externalEffectsOutbox');
const { executeMollieExternalEffect } = require('./mollieService');
const {
    mapMolliePaymentStatus,
    mapMollieRefundStatus,
    deriveReturnCaseStatus
} = require('./paymentStateService');

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_BATCH_SIZE = 20;
const workerId = `${process.pid}-${crypto.randomUUID()}`;

let workerTimer = null;
let workerStopping = false;
let drainPromise = null;
let lastPurgeAt = 0;

function normalizeRecordIds(values) {
    return (values || [])
        .map(Number)
        .filter(id => Number.isInteger(id) && id > 0);
}

async function getPaymentRecordsForUpdate(connection, recordIds) {
    if (recordIds.length === 0) return [];
    const placeholders = recordIds.map(() => '?').join(',');
    const [rows] = await connection.execute(
        `SELECT id, order_id, order_item_id, payment_type, payment_status,
                payment_method, amount, mollie_payment_id, external_operation_key
         FROM rental_order_payments
         WHERE id IN (${placeholders})
         ORDER BY id ASC
         FOR UPDATE`,
        recordIds
    );
    return rows;
}

async function refreshCancelledOrderProjection(connection, orderId) {
    const [rows] = await connection.execute(
        `SELECT
            COUNT(*) AS refundCount,
            SUM(effectiveStatus = 'paid') AS paidCount,
            SUM(effectiveStatus = 'pending') AS pendingCount,
            SUM(effectiveStatus = 'failed') AS failedCount
         FROM (
            SELECT order_item_id, mollie_payment_id,
                   CASE
                       WHEN SUM(payment_status IN ('pending', 'open', 'authorized')) > 0 THEN 'pending'
                       WHEN SUM(payment_status = 'paid') > 0 THEN 'paid'
                       ELSE 'failed'
                   END AS effectiveStatus
            FROM rental_order_payments
            WHERE order_id = ?
            AND payment_type = 'order_cancellation_refund'
            GROUP BY order_item_id, mollie_payment_id
         ) refundTargets`,
        [orderId]
    );
    const summary = rows[0] || {};
    let paymentStatus = 'cancelled';
    if (Number(summary.pendingCount || 0) > 0) paymentStatus = 'refund_pending';
    else if (
        Number(summary.refundCount || 0) > 0 &&
        Number(summary.refundCount) === Number(summary.paidCount || 0)
    ) {
        paymentStatus = 'refunded';
    } else if (Number(summary.failedCount || 0) > 0) {
        paymentStatus = 'refund_failed';
    }

    await connection.execute(
        `UPDATE rental_orders
         SET payment_status = ?
         WHERE id = ? AND status IN ('cancelled', 'expired')`,
        [paymentStatus, orderId]
    );
    return paymentStatus;
}

async function refreshReturnCaseProjection(connection, orderId) {
    const [orderRows] = await connection.execute(
        `SELECT status, payment_status
         FROM rental_orders
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [orderId]
    );
    if (orderRows.length === 0) return null;

    const [paymentRows] = await connection.execute(
        `SELECT
            SUM(payment_status IN ('pending', 'open', 'authorized')) AS pendingCount,
            SUM(payment_status IN ('failed', 'cancelled', 'expired')) AS failedCount
         FROM rental_order_payments
         WHERE order_id = ?
         AND payment_type IN ('rental_adjustment', 'return_additional_charge')
         AND payment_status IN (
            'pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'
         )`,
        [orderId]
    );
    const [refundRows] = await connection.execute(
        `SELECT
            SUM(refund.payment_status IN ('pending', 'open', 'authorized')) AS pendingCount,
            SUM(refund.payment_status IN ('failed', 'cancelled', 'expired')) AS failedCount
         FROM rental_order_payments refund
         WHERE refund.order_id = ?
         AND refund.payment_type IN (
            'deposit_refund', 'order_cancellation_refund', 'duplicate_payment_refund'
         )
         AND NOT EXISTS (
            SELECT 1
            FROM rental_order_payments newerRefund
            WHERE newerRefund.order_id = refund.order_id
            AND newerRefund.payment_type = refund.payment_type
            AND newerRefund.order_item_id <=> refund.order_item_id
            AND newerRefund.payment_method = refund.payment_method
            AND newerRefund.mollie_payment_id <=> refund.mollie_payment_id
            AND newerRefund.id > refund.id
         )`,
        [orderId]
    );
    const [uncreatedRefundRows] = await connection.execute(
        `SELECT COUNT(*) AS missingCount
         FROM rental_order_items item
         WHERE item.order_id = ?
         AND item.item_status LIKE 'returned_%'
         AND COALESCE(item.deposit_refund_amount, 0) > 0
         AND NOT EXISTS (
            SELECT 1
            FROM rental_order_payments refund
            WHERE refund.order_id = item.order_id
            AND refund.order_item_id = item.id
            AND refund.payment_type = 'deposit_refund'
         )`,
        [orderId]
    );
    const [itemRows] = await connection.execute(
        `SELECT
            SUM(COALESCE(item_status, 'active') = 'picked_up') AS pickedUpCount,
            SUM(COALESCE(item_status, 'active') LIKE 'returned_%') AS returnedCount
         FROM rental_order_items
         WHERE order_id = ?`,
        [orderId]
    );

    const returnCaseStatus = deriveReturnCaseStatus({
        orderStatus: orderRows[0].status,
        orderPaymentStatus: orderRows[0].payment_status,
        pickedUpCount: Number(itemRows[0]?.pickedUpCount || 0),
        returnedCount: Number(itemRows[0]?.returnedCount || 0),
        pendingPaymentCount: Number(paymentRows[0]?.pendingCount || 0),
        failedPaymentCount: Number(paymentRows[0]?.failedCount || 0),
        pendingRefundCount:
            Number(refundRows[0]?.pendingCount || 0) +
            Number(uncreatedRefundRows[0]?.missingCount || 0),
        failedRefundCount: Number(refundRows[0]?.failedCount || 0)
    });

    await connection.execute(
        'UPDATE rental_orders SET return_case_status = ? WHERE id = ?',
        [returnCaseStatus, orderId]
    );
    return returnCaseStatus;
}

async function refreshRefundProjection(connection, paymentRecord) {
    if (!paymentRecord?.order_id) return;
    if (paymentRecord.payment_type === 'order_cancellation_refund') {
        await refreshCancelledOrderProjection(connection, paymentRecord.order_id);
        return;
    }
    if (['deposit_refund', 'duplicate_payment_refund'].includes(paymentRecord.payment_type)) {
        await refreshReturnCaseProjection(connection, paymentRecord.order_id);
    }
}

async function enqueueDependentPaymentMail(
    connection,
    successMail,
    result,
    enqueueEffect = enqueueExternalEffect
) {
    if (!result.checkoutUrl) {
        throw new Error('Checkout-URL für abhängige Zahlungs-Mail fehlt.');
    }

    const message = {
        ...successMail.message,
        html: String(successMail.message.htmlTemplate || '')
            .replaceAll('{{CHECKOUT_URL}}', result.checkoutUrl),
        text: String(successMail.message.textTemplate || '')
            .replaceAll('{{CHECKOUT_URL}}', result.checkoutUrl),
        operationKey: successMail.operationKey
    };
    delete message.htmlTemplate;
    delete message.textTemplate;

    return enqueueEffect({
        operationKey: successMail.operationKey,
        effectType: EFFECT_TYPES.MAIL_SEND,
        payload: { message },
        maxAttempts: 8
    }, { connection });
}

async function enqueueObsoletePaymentCancellation(connection, effect, result, paymentRecords) {
    if (!result?.id) {
        throw new Error('Mollie-Zahlung ohne ID kann nicht als veraltet geschlossen werden.');
    }

    const firstRecord = paymentRecords.find(record => record.payment_type === 'initial_payment') ||
        paymentRecords[0] || {};
    const amount = getProviderAmount(result, paymentRecords);
    const operationKey = createOperationKey('cancel-obsolete-payment', {
        sourceOperationKey: effect.operation_key,
        paymentId: result.id
    });

    await enqueueExternalEffect({
        operationKey,
        effectType: EFFECT_TYPES.MOLLIE_PAYMENT_CANCEL,
        payload: {
            paymentId: result.id,
            idempotencyKey: operationKey,
            application: {
                kind: 'cancel_payment',
                paymentId: result.id,
                paymentStatus: 'cancelled',
                refundIfPaid: amount > 0 ? {
                    orderId: firstRecord.order_id || null,
                    orderItemId: firstRecord.order_item_id || null,
                    amount,
                    sourceOperationKey: effect.operation_key
                } : null
            }
        },
        maxAttempts: 8
    }, { connection });
}

function getProviderAmount(result, paymentRecords) {
    const providerAmount = Number(result?.amount?.value);
    if (Number.isFinite(providerAmount) && providerAmount > 0) return providerAmount;

    const initialRecord = paymentRecords.find(record => record.payment_type === 'initial_payment');
    if (initialRecord) return Math.abs(Number(initialRecord.amount || 0));

    const additionalRecord = paymentRecords.find(record =>
        ['rental_adjustment', 'return_additional_charge'].includes(record.payment_type)
    );
    if (additionalRecord) return Math.abs(Number(additionalRecord.amount || 0));

    return 0;
}

async function enqueuePaidObsoletePaymentRefund(connection, application, result) {
    const recovery = application.refundIfPaid;
    const amount = Number(recovery?.amount || result.amount?.value || 0);
    if (!recovery?.orderId || !application.paymentId || !(amount > 0)) return;

    const operationKey = createOperationKey('refund-obsolete-payment', {
        sourceOperationKey: recovery.sourceOperationKey || null,
        paymentId: application.paymentId
    });
    const [insertResult] = await connection.execute(
        `INSERT INTO rental_order_payments
         (order_id, order_item_id, payment_type, payment_method, payment_status,
          amount, mollie_payment_id, external_operation_key, note)
         VALUES (?, ?, 'duplicate_payment_refund', 'online', 'pending', ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [
            recovery.orderId,
            recovery.orderItemId || null,
            -Math.abs(amount),
            application.paymentId,
            operationKey,
            'Veralteter Checkout wurde vor der Stornierung bezahlt; Rückerstattung vorgemerkt'
        ]
    );

    await enqueueMollieRefundCreation(connection, {
        operationKey,
        refund: {
            paymentId: application.paymentId,
            amount,
            description: 'Automatische Rückerstattung eines veralteten Checkouts',
            metadata: {
                orderId: String(recovery.orderId),
                itemId: recovery.orderItemId ? String(recovery.orderItemId) : null,
                type: 'duplicate_payment_refund'
            }
        },
        application: {
            kind: 'refund_record',
            paymentRecordId: Number(insertResult.insertId)
        }
    });
}

async function applyExternalEffectResult(connection, effect, result) {
    const application = effect.payload.application || null;
    if (!application) return;

    if (application.kind === 'order_confirmation_mail') {
        if (effect.effect_type !== EFFECT_TYPES.MAIL_SEND) {
            throw new Error('Versandprojektion wurde einem Nicht-Mail-Effekt zugeordnet.');
        }
        await connection.execute(
            `UPDATE rental_orders
             SET order_confirmation_sent_at = COALESCE(order_confirmation_sent_at, NOW())
             WHERE id = ?`,
            [application.orderId]
        );
        return;
    }

    if (application.kind === 'payment_records') {
        const recordIds = normalizeRecordIds(application.paymentRecordIds);
        const paymentRecords = await getPaymentRecordsForUpdate(connection, recordIds);
        const activePaymentStatuses = new Set(['pending', 'open', 'authorized']);
        const recordsAreActive =
            paymentRecords.length === recordIds.length &&
            paymentRecords.every(record => activePaymentStatuses.has(record.payment_status));

        let order = null;
        let orderAcceptsPayment = true;
        if (application.orderId) {
            const [orderRows] = await connection.execute(
                `SELECT id, status, payment_status, mollie_payment_id
                 FROM rental_orders
                 WHERE id = ?
                 LIMIT 1
                 FOR UPDATE`,
                [application.orderId]
            );
            order = orderRows[0] || null;
            orderAcceptsPayment = Boolean(
                order &&
                ['reserved', 'pending_payment', 'payment_failed'].includes(
                    String(order.status || '').toLowerCase()
                ) &&
                !['paid', 'refunded', 'charged_back'].includes(
                    String(order.payment_status || '').toLowerCase()
                )
            );
        }

        if (!recordsAreActive || !orderAcceptsPayment) {
            if (recordIds.length > 0) {
                const placeholders = recordIds.map(() => '?').join(',');
                await connection.execute(
                    `UPDATE rental_order_payments
                     SET mollie_payment_id = ?, checkout_url = COALESCE(?, checkout_url),
                         payment_status = CASE
                            WHEN payment_status IN ('pending', 'open', 'authorized') THEN 'cancelled'
                            ELSE payment_status
                         END,
                         note = CONCAT(
                            COALESCE(note, ''),
                            CASE WHEN note IS NULL OR note = '' THEN '' ELSE ' | ' END,
                            'Veralteter Checkout automatisch geschlossen'
                         )
                     WHERE id IN (${placeholders})`,
                    [result.id, result.checkoutUrl || null, ...recordIds]
                );
            }
            await enqueueObsoletePaymentCancellation(connection, effect, result, paymentRecords);
            return;
        }

        if (recordIds.length > 0) {
            const placeholders = recordIds.map(() => '?').join(',');
            await connection.execute(
                `UPDATE rental_order_payments
                 SET mollie_payment_id = ?, checkout_url = COALESCE(?, checkout_url)
                 WHERE id IN (${placeholders})`,
                [result.id, result.checkoutUrl || null, ...recordIds]
            );
        }

        if (application.orderId) {
            await connection.execute(
                `UPDATE rental_orders
                 SET mollie_payment_id = ?, mollie_checkout_url = ?,
                     mollie_payment_status = ?, payment_method = 'online',
                     payment_status = 'pending'
                 WHERE id = ?
                 AND status IN ('reserved', 'pending_payment', 'payment_failed')
                 AND payment_status NOT IN ('paid', 'refunded', 'charged_back')`,
                [
                    result.id,
                    result.checkoutUrl || null,
                    result.status || 'open',
                    application.orderId
                ]
            );
        }

        if (application.successMail) {
            await enqueueDependentPaymentMail(
                connection,
                application.successMail,
                result
            );
        }
        return;
    }

    if (application.kind === 'refund_record') {
        const refundStatus = mapMollieRefundStatus(result.status);
        await connection.execute(
            `UPDATE rental_order_payments
             SET mollie_refund_id = ?, payment_status = ?,
                 paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END
             WHERE id = ? AND external_operation_key = ?`,
            [
                result.id,
                refundStatus,
                refundStatus,
                application.paymentRecordId,
                effect.operation_key
            ]
        );
        const [paymentRows] = await connection.execute(
            `SELECT id, order_id, order_item_id, payment_type, payment_status
             FROM rental_order_payments
             WHERE id = ? AND external_operation_key = ?
             LIMIT 1
             FOR UPDATE`,
            [application.paymentRecordId, effect.operation_key]
        );
        await refreshRefundProjection(connection, paymentRows[0]);
        return;
    }

    if (application.kind === 'cancel_payment') {
        const mappedStatus = mapMolliePaymentStatus(result.status);
        const desiredStatus = ['cancelled', 'expired', 'failed', 'paid', 'charged_back'].includes(mappedStatus)
            ? mappedStatus
            : String(application.paymentStatus || 'cancelled');
        await connection.execute(
            `UPDATE rental_order_payments
             SET payment_status = ?,
                 paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END
             WHERE mollie_payment_id = ?
             AND payment_status IN ('pending', 'open', 'authorized', 'cancelled', 'expired')`,
            [desiredStatus, desiredStatus, application.paymentId]
        );
        if (desiredStatus === 'paid' && application.refundIfPaid) {
            await enqueuePaidObsoletePaymentRefund(connection, application, result);
        }
        return;
    }

    throw new Error(`Unbekannte Outbox-Result-Anwendung: ${application.kind}`);
}

async function applyExternalEffectFailure(connection, effect, error) {
    const application = effect.payload?.application || null;
    if (!application) return;
    const errorMessage = String(error?.message || error || 'Externer Effekt fehlgeschlagen').slice(0, 1000);

    if (application.kind === 'payment_records') {
        const recordIds = normalizeRecordIds(application.paymentRecordIds);
        const paymentRecords = await getPaymentRecordsForUpdate(connection, recordIds);
        if (recordIds.length > 0) {
            const placeholders = recordIds.map(() => '?').join(',');
            await connection.execute(
                `UPDATE rental_order_payments
                 SET payment_status = 'failed',
                     note = CONCAT(
                        COALESCE(note, ''),
                        CASE WHEN note IS NULL OR note = '' THEN '' ELSE ' | ' END,
                        ?
                     )
                 WHERE id IN (${placeholders})
                 AND payment_status IN ('pending', 'open', 'authorized')`,
                [`Externer Zahlungsauftrag endgültig fehlgeschlagen: ${errorMessage}`, ...recordIds]
            );
        }

        if (application.orderId) {
            await connection.execute(
                `UPDATE rental_orders
                 SET mollie_payment_status = 'failed',
                     payment_status = 'failed',
                     status = 'payment_failed'
                 WHERE id = ?
                 AND status IN ('reserved', 'pending_payment', 'payment_failed')
                 AND payment_status NOT IN ('paid', 'refunded', 'charged_back')`,
                [application.orderId]
            );
        }

        const additionalOrderIds = [...new Set(paymentRecords
            .filter(record => ['rental_adjustment', 'return_additional_charge'].includes(record.payment_type))
            .map(record => Number(record.order_id))
            .filter(Boolean))];
        for (const orderId of additionalOrderIds) {
            await refreshReturnCaseProjection(connection, orderId);
        }
        return;
    }

    if (application.kind === 'refund_record') {
        const [paymentRows] = await connection.execute(
            `SELECT id, order_id, order_item_id, payment_type, payment_status
             FROM rental_order_payments
             WHERE id = ? AND external_operation_key = ?
             LIMIT 1
             FOR UPDATE`,
            [application.paymentRecordId, effect.operation_key]
        );
        const paymentRecord = paymentRows[0];
        if (!paymentRecord) return;

        await connection.execute(
            `UPDATE rental_order_payments
             SET payment_status = 'failed',
                 note = CONCAT(
                    COALESCE(note, ''),
                    CASE WHEN note IS NULL OR note = '' THEN '' ELSE ' | ' END,
                    ?
                 )
             WHERE id = ?
             AND external_operation_key = ?
             AND payment_status IN ('pending', 'open', 'authorized')`,
            [
                `Externe Rückerstattung endgültig fehlgeschlagen: ${errorMessage}`,
                application.paymentRecordId,
                effect.operation_key
            ]
        );
        paymentRecord.payment_status = 'failed';
        await refreshRefundProjection(connection, paymentRecord);
    }
}

async function dispatchExternalEffect(effect, dependencies = {}) {
    const executeMollie = dependencies.executeMollie || executeMollieExternalEffect;
    const deliverMail = dependencies.deliverMail || (async message => {
        const { deliverGraphMail } = require('./mailService');
        return deliverGraphMail(message);
    });

    if (effect.effect_type === EFFECT_TYPES.MAIL_SEND) {
        return deliverMail(effect.payload.message);
    }

    if ([
        EFFECT_TYPES.MOLLIE_PAYMENT_CREATE,
        EFFECT_TYPES.MOLLIE_PAYMENT_CANCEL,
        EFFECT_TYPES.MOLLIE_REFUND_CREATE
    ].includes(effect.effect_type)) {
        return executeMollie(effect.effect_type, effect.payload, effect.operation_key);
    }

    throw new Error(`Kein Dispatcher für Outbox-Effekt ${effect.effect_type}.`);
}

async function processClaimedExternalEffect(effect, dependencies = {}) {
    const completeEffect = dependencies.completeEffect || completeExternalEffect;
    const failEffect = dependencies.failEffect || failExternalEffect;

    try {
        const result = await dispatchExternalEffect(effect, dependencies);
        await completeEffect(
            effect,
            result ?? { accepted: true },
            dependencies.applyResult || applyExternalEffectResult
        );
        return result;
    } catch (error) {
        await failEffect(
            effect,
            error,
            dependencies.applyFailure || applyExternalEffectFailure
        );
        throw error;
    }
}

async function processExternalEffectByKey(operationKey, dependencies = {}) {
    const existing = await getExternalEffect(operationKey);
    if (!existing) throw new Error(`Outbox-Effekt ${operationKey} wurde nicht gefunden.`);
    if (existing.status === OUTBOX_STATUSES.SUCCEEDED) return existing.result;
    if (existing.status === OUTBOX_STATUSES.DEAD) {
        throw new Error(`Outbox-Effekt ${operationKey} ist endgültig fehlgeschlagen: ${existing.last_error || ''}`);
    }

    const effect = await claimExternalEffect({
        operationKey,
        workerId,
        leaseSeconds: Number(process.env.EXTERNAL_EFFECT_LEASE_SECONDS || 60),
        applyDead: dependencies.applyFailure || applyExternalEffectFailure
    });

    if (!effect) {
        const current = await getExternalEffect(operationKey);
        if (current?.status === OUTBOX_STATUSES.SUCCEEDED) return current.result;

        const error = new Error(`Outbox-Effekt ${operationKey} wird bereits verarbeitet oder wartet auf Retry.`);
        error.code = 'EXTERNAL_EFFECT_PENDING';
        throw error;
    }

    return processClaimedExternalEffect(effect, dependencies);
}

async function drainExternalEffects(options = {}) {
    if (drainPromise) return drainPromise;

    const batchSize = Math.min(
        Math.max(Number(options.batchSize || process.env.EXTERNAL_EFFECT_BATCH_SIZE || DEFAULT_BATCH_SIZE), 1),
        100
    );

    drainPromise = (async () => {
        const now = Date.now();
        if (now - lastPurgeAt >= 60 * 60 * 1000) {
            try {
                await purgeExternalEffects({
                    succeededDays: Number(process.env.EXTERNAL_EFFECT_SUCCEEDED_RETENTION_DAYS || 30),
                    deadDays: Number(process.env.EXTERNAL_EFFECT_DEAD_RETENTION_DAYS || 90)
                });
                lastPurgeAt = now;
            } catch (error) {
                console.error('Outbox-Retention fehlgeschlagen; Dispatch wird fortgesetzt:', error);
            }
        }

        let processed = 0;
        while (!workerStopping && processed < batchSize) {
            const effect = await claimExternalEffect({
                workerId,
                leaseSeconds: Number(process.env.EXTERNAL_EFFECT_LEASE_SECONDS || 60),
                applyDead: options.dependencies?.applyFailure || applyExternalEffectFailure
            });
            if (!effect) break;

            try {
                await processClaimedExternalEffect(effect, options.dependencies || {});
            } catch (error) {
                console.error(
                    `${new Date().toISOString()} - Externer Effekt ${effect.operation_key} fehlgeschlagen:`,
                    error.message
                );
            }
            processed += 1;
        }
        return processed;
    })();

    try {
        return await drainPromise;
    } finally {
        drainPromise = null;
    }
}

async function startExternalEffectsWorker() {
    if (workerTimer) return workerTimer;

    workerStopping = false;

    const intervalMs = Math.min(
        Math.max(Number(process.env.EXTERNAL_EFFECT_INTERVAL_MS || DEFAULT_INTERVAL_MS), 250),
        60000
    );

    workerTimer = setInterval(() => {
        drainExternalEffects().catch(error => {
            console.error('Outbox-Worker konnte nicht ausgeführt werden:', error);
        });
    }, intervalMs);
    workerTimer.unref?.();

    // Recovery starts immediately, but never delays HTTP startup during a
    // provider outage or a large backlog.
    Promise.resolve().then(() => drainExternalEffects()).catch(error => {
        console.error('Initialer Outbox-Recovery-Lauf fehlgeschlagen:', error);
    });
    return workerTimer;
}

async function stopExternalEffectsWorker() {
    workerStopping = true;
    if (workerTimer) clearInterval(workerTimer);
    workerTimer = null;
    if (drainPromise) {
        const graceMs = Math.min(
            Math.max(Number(process.env.EXTERNAL_EFFECT_SHUTDOWN_GRACE_MS || 8000), 1000),
            60000
        );
        await Promise.race([
            drainPromise,
            new Promise(resolve => {
                const timeout = setTimeout(resolve, graceMs);
                timeout.unref?.();
            })
        ]);
    }
}

module.exports = {
    applyExternalEffectFailure,
    applyExternalEffectResult,
    dispatchExternalEffect,
    drainExternalEffects,
    enqueueDependentPaymentMail,
    processClaimedExternalEffect,
    processExternalEffectByKey,
    startExternalEffectsWorker,
    stopExternalEffectsWorker
};
