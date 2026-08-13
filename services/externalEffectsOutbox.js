'use strict';

const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

// Keep this module importable by isolated unit tests. The server still enforces
// bootstrap ordering when it loads the application; the worker only resolves
// the regular DB configuration when it actually opens a connection.
function getDbConfig() {
    return require('../config/db');
}

function createDbConnection() {
    return mysql.createConnection(getDbConfig());
}

const EFFECT_TYPES = Object.freeze({
    MAIL_SEND: 'mail.send',
    MOLLIE_PAYMENT_CREATE: 'mollie.payment.create',
    MOLLIE_PAYMENT_CANCEL: 'mollie.payment.cancel',
    MOLLIE_REFUND_CREATE: 'mollie.refund.create'
});

const OUTBOX_STATUSES = Object.freeze({
    PENDING: 'pending',
    PROCESSING: 'processing',
    RETRY: 'retry',
    SUCCEEDED: 'succeeded',
    DEAD: 'dead'
});

function canonicalizeJson(value, seen = new Set(), inArray = false) {
    if (value === undefined) return inArray ? null : undefined;
    if (typeof value === 'bigint') throw new TypeError('BIGINT ist in Outbox-JSON nicht erlaubt.');
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    if (typeof value === 'function' || typeof value === 'symbol') {
        return inArray ? null : undefined;
    }
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) throw new TypeError('Zyklische Outbox-Payload ist nicht erlaubt.');

    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map(item => canonicalizeJson(item, seen, true));
        }

        const canonical = {};
        for (const key of Object.keys(value).sort()) {
            const child = canonicalizeJson(value[key], seen, false);
            if (child !== undefined) canonical[key] = child;
        }
        return canonical;
    } finally {
        seen.delete(value);
    }
}

function stableJson(value) {
    return JSON.stringify(canonicalizeJson(value));
}

function createOperationKey(prefix, value) {
    const digest = crypto
        .createHash('sha256')
        .update(stableJson(value), 'utf8')
        .digest('hex');

    return `${String(prefix || 'effect').slice(0, 40)}:${digest}`;
}

function hashPayload(payload) {
    return crypto.createHash('sha256').update(stableJson(payload), 'utf8').digest('hex');
}

function parseJson(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function normalizeOutboxRow(row) {
    if (!row) return null;
    return {
        ...row,
        payload: parseJson(row.payload_json, {}),
        result: parseJson(row.result_json, null)
    };
}

function validateEffect({ operationKey, effectType, payload, maxAttempts = 8 }) {
    if (typeof operationKey !== 'string' || !operationKey || operationKey.length > 191) {
        throw new Error('Outbox operationKey ist ungültig.');
    }
    if (!Object.values(EFFECT_TYPES).includes(effectType)) {
        throw new Error(`Unbekannter Outbox-Effekttyp: ${effectType}`);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Outbox payload muss ein Objekt sein.');
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 25) {
        throw new Error('Outbox maxAttempts muss zwischen 1 und 25 liegen.');
    }
}

async function insertEffect(connection, effect) {
    validateEffect(effect);
    const payloadJson = stableJson(effect.payload);
    const payloadHash = hashPayload(effect.payload);

    await connection.execute(
        `INSERT INTO external_effects_outbox
         (operation_key, effect_type, payload_json, payload_hash, status, max_attempts, available_at)
         VALUES (?, ?, CAST(? AS JSON), ?, 'pending', ?, NOW())
         ON DUPLICATE KEY UPDATE
            id = LAST_INSERT_ID(id),
            updated_at = updated_at`,
        [effect.operationKey, effect.effectType, payloadJson, payloadHash, effect.maxAttempts || 8]
    );

    const [rows] = await connection.execute(
        `SELECT *
         FROM external_effects_outbox
         WHERE operation_key = ?
         LIMIT 1`,
        [effect.operationKey]
    );
    const existing = normalizeOutboxRow(rows[0]);

    if (
        existing.effect_type !== effect.effectType ||
        existing.payload_hash !== payloadHash
    ) {
        throw new Error(
            `Outbox operationKey ${effect.operationKey} wurde mit abweichendem Inhalt wiederverwendet.`
        );
    }

    return existing;
}

async function enqueueExternalEffect(effect, options = {}) {
    if (options.connection) {
        return insertEffect(options.connection, effect);
    }

    const connection = await createDbConnection();
    try {
        await connection.beginTransaction();
        const row = await insertEffect(connection, effect);
        await connection.commit();
        return row;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }
}

async function enqueueMolliePaymentCreation(connection, options) {
    const operationKey = options.operationKey;
    return enqueueExternalEffect({
        operationKey,
        effectType: EFFECT_TYPES.MOLLIE_PAYMENT_CREATE,
        payload: {
            payment: {
                ...options.payment,
                idempotencyKey: operationKey
            },
            application: options.application || null
        },
        maxAttempts: options.maxAttempts || 6
    }, { connection });
}

async function enqueueMollieRefundCreation(connection, options) {
    const operationKey = options.operationKey;
    return enqueueExternalEffect({
        operationKey,
        effectType: EFFECT_TYPES.MOLLIE_REFUND_CREATE,
        payload: {
            refund: {
                ...options.refund,
                idempotencyKey: operationKey
            },
            application: options.application || null
        },
        maxAttempts: options.maxAttempts || 8
    }, { connection });
}

async function enqueueMolliePaymentCancellation(connection, options) {
    const operationKey = options.operationKey;
    return enqueueExternalEffect({
        operationKey,
        effectType: EFFECT_TYPES.MOLLIE_PAYMENT_CANCEL,
        payload: {
            paymentId: options.paymentId,
            idempotencyKey: operationKey,
            application: options.application || null
        },
        maxAttempts: options.maxAttempts || 8
    }, { connection });
}

async function getExternalEffect(operationKey, options = {}) {
    const ownsConnection = !options.connection;
    const connection = options.connection || await createDbConnection();

    try {
        const [rows] = await connection.execute(
            `SELECT * FROM external_effects_outbox
             WHERE operation_key = ? LIMIT 1`,
            [operationKey]
        );
        return normalizeOutboxRow(rows[0]);
    } finally {
        if (ownsConnection) await connection.end();
    }
}

async function claimExternalEffect({
    operationKey = null,
    workerId,
    leaseSeconds = 60,
    applyDead = null,
    connectionFactory = createDbConnection
} = {}) {
    if (!workerId) throw new Error('workerId ist zum Claimen erforderlich.');

    const connection = await connectionFactory();
    try {
        await connection.beginTransaction();

        const expiredLeaseMessage = 'Worker-Lease nach letztem Versuch abgelaufen.';
        const [expiredEffects] = await connection.execute(
            `SELECT *
             FROM external_effects_outbox
             WHERE status = 'processing'
             AND attempt_count >= max_attempts
             AND locked_at < DATE_SUB(NOW(), INTERVAL ? SECOND)
             ORDER BY id ASC
             LIMIT 20
             FOR UPDATE SKIP LOCKED`,
            [leaseSeconds]
        );

        for (const expiredEffectRow of expiredEffects) {
            const expiredEffect = normalizeOutboxRow(expiredEffectRow);
            if (applyDead) {
                await applyDead(connection, expiredEffect, new Error(expiredLeaseMessage));
            }
            await connection.execute(
                `UPDATE external_effects_outbox
                 SET status = 'dead',
                     last_error = COALESCE(last_error, ?),
                     completed_at = COALESCE(completed_at, NOW()),
                     locked_at = NULL,
                     locked_by = NULL
                 WHERE id = ? AND status = 'processing'`,
                [expiredLeaseMessage, expiredEffect.id]
            );
        }

        const params = [];
        let operationFilter = '';
        if (operationKey) {
            operationFilter = 'AND operation_key = ?';
            params.push(operationKey);
        }

        const [rows] = await connection.execute(
            `SELECT *
             FROM external_effects_outbox
             WHERE (
                (status IN ('pending', 'retry') AND available_at <= NOW())
                OR (status = 'processing' AND locked_at < DATE_SUB(NOW(), INTERVAL ? SECOND))
             )
             AND attempt_count < max_attempts
             ${operationFilter}
             ORDER BY id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            [leaseSeconds, ...params]
        );

        if (rows.length === 0) {
            await connection.commit();
            return null;
        }

        const row = rows[0];
        await connection.execute(
            `UPDATE external_effects_outbox
             SET status = 'processing',
                 attempt_count = attempt_count + 1,
                 locked_at = NOW(),
                 locked_by = ?,
                 last_error = NULL
             WHERE id = ?`,
            [workerId, row.id]
        );
        await connection.commit();

        return normalizeOutboxRow({
            ...row,
            status: OUTBOX_STATUSES.PROCESSING,
            attempt_count: Number(row.attempt_count) + 1,
            locked_by: workerId
        });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }
}

function calculateBackoffSeconds(attemptCount) {
    const exponent = Math.max(Number(attemptCount || 1) - 1, 0);
    return Math.min(15 * (2 ** exponent), 60 * 60);
}

async function completeExternalEffect(effect, result, applyResult = null) {
    const connection = await createDbConnection();
    try {
        await connection.beginTransaction();

        const [lockedRows] = await connection.execute(
            `SELECT status, locked_by
             FROM external_effects_outbox
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [effect.id]
        );
        const locked = lockedRows[0];

        if (!locked || locked.status === OUTBOX_STATUSES.SUCCEEDED) {
            await connection.commit();
            return;
        }
        if (locked.locked_by !== effect.locked_by) {
            throw new Error(`Outbox-Lease für Effekt #${effect.id} gehört einem anderen Worker.`);
        }

        if (applyResult) await applyResult(connection, effect, result);

        await connection.execute(
            `UPDATE external_effects_outbox
             SET status = 'succeeded', result_json = CAST(? AS JSON),
                 payload_json = JSON_OBJECT('redacted', TRUE), completed_at = NOW(),
                 locked_at = NULL, locked_by = NULL, last_error = NULL
             WHERE id = ?`,
            [JSON.stringify(result ?? null), effect.id]
        );
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }
}

async function failExternalEffect(effect, error, applyFailure = null) {
    const connection = await createDbConnection();
    const errorMessage = String(error?.message || error || 'Unbekannter externer Fehler').slice(0, 8000);

    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
            `SELECT *
             FROM external_effects_outbox
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [effect.id]
        );
        const lockedEffect = normalizeOutboxRow(rows[0]);
        if (
            !lockedEffect ||
            lockedEffect.status !== OUTBOX_STATUSES.PROCESSING ||
            lockedEffect.locked_by !== effect.locked_by
        ) {
            await connection.commit();
            return;
        }

        const exhausted = Number(lockedEffect.attempt_count) >= Number(lockedEffect.max_attempts);
        const nextStatus = exhausted ? OUTBOX_STATUSES.DEAD : OUTBOX_STATUSES.RETRY;
        const backoffSeconds = calculateBackoffSeconds(lockedEffect.attempt_count);
        if (exhausted && applyFailure) {
            await applyFailure(connection, lockedEffect, error);
        }

        await connection.execute(
            `UPDATE external_effects_outbox
             SET status = ?, last_error = ?,
                 available_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
                 completed_at = CASE WHEN ? = 'dead' THEN NOW() ELSE NULL END,
                 locked_at = NULL, locked_by = NULL
             WHERE id = ? AND status = 'processing' AND locked_by = ?`,
            [
                nextStatus,
                errorMessage,
                backoffSeconds,
                nextStatus,
                lockedEffect.id,
                lockedEffect.locked_by
            ]
        );
        await connection.commit();
    } catch (failureError) {
        await connection.rollback();
        throw failureError;
    } finally {
        await connection.end();
    }
}

async function purgeExternalEffects(options = {}) {
    const succeededDays = Math.min(Math.max(Number(options.succeededDays || 30), 1), 3650);
    const deadDays = Math.min(Math.max(Number(options.deadDays || 90), 1), 3650);
    const batchSize = Math.min(Math.max(Number(options.batchSize || 500), 1), 5000);
    const connection = await createDbConnection();

    try {
        const [result] = await connection.execute(
             `DELETE FROM external_effects_outbox
             WHERE effect_type = 'mail.send'
             AND (
                (
                    status = 'succeeded'
                    AND completed_at < DATE_SUB(NOW(), INTERVAL ? DAY)
                ) OR (
                    status = 'dead'
                    AND completed_at < DATE_SUB(NOW(), INTERVAL ? DAY)
                )
             )
             ORDER BY id ASC
             LIMIT ${batchSize}`,
            [succeededDays, deadDays]
        );
        return Number(result.affectedRows || 0);
    } finally {
        await connection.end();
    }
}

module.exports = {
    EFFECT_TYPES,
    OUTBOX_STATUSES,
    calculateBackoffSeconds,
    canonicalizeJson,
    claimExternalEffect,
    completeExternalEffect,
    createOperationKey,
    enqueueExternalEffect,
    enqueueMolliePaymentCancellation,
    enqueueMolliePaymentCreation,
    enqueueMollieRefundCreation,
    failExternalEffect,
    getExternalEffect,
    hashPayload,
    normalizeOutboxRow,
    purgeExternalEffects,
    stableJson
};
