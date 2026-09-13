'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { resetTestDatabase, TEST_USER } = require('../support/test-database');
const { hashAuthToken } = require('../../services/authTokenService');
const { up } = require('../../database/migrations/20260913_auth_secrets');
const { claimExternalEffect, hashPayload } = require('../../services/externalEffectsOutbox');

test('migrates legacy auth secrets once while preserving financial idempotency and queued mail', async () => {
    await resetTestDatabase(); // Guarded by the existing test/ci database-name restriction.
    const connection = await mysql.createConnection(dbConfig);
    const token = crypto.randomBytes(32).toString('hex');
    const legacyKey = `mail-password-reset-${token}`;
    const financialKey = 'deposit-refund-test-stable';
    try {
        await connection.execute('UPDATE users SET reset_token = ?, verification_token = ? WHERE username = ?', [token, token, TEST_USER.email]);
        await connection.execute('INSERT INTO guest_verifications(email, verification_token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))', ['migration-test@example.com', token]);
        await connection.execute(
            `INSERT INTO external_effects_outbox(operation_key, effect_type, payload_json, payload_hash, status, available_at)
             VALUES (?, 'mail.send', ?, ?, 'pending', NOW()), (?, 'mollie.refund.create', ?, ?, 'pending', NOW())`,
            [legacyKey, JSON.stringify({ message: { operationKey: legacyKey, text: `resetToken=${token}` } }), 'a'.repeat(64), financialKey, '{}', 'b'.repeat(64)]
        );
        await up(connection);
        await up(connection);
        const [users] = await connection.execute('SELECT reset_token, verification_token FROM users WHERE username = ?', [TEST_USER.email]);
        assert.equal(users[0].reset_token === hashAuthToken(token), true);
        assert.equal(users[0].verification_token === hashAuthToken(token), true);
        const [guests] = await connection.execute('SELECT verification_token FROM guest_verifications WHERE email = ?', ['migration-test@example.com']);
        assert.equal(guests[0].verification_token === hashAuthToken(token), true);
        const [effects] = await connection.execute('SELECT operation_key, effect_type, payload_json FROM external_effects_outbox ORDER BY id');
        const mail = effects.find(effect => effect.effect_type === 'mail.send');
        const payload = typeof mail.payload_json === 'string' ? JSON.parse(mail.payload_json) : mail.payload_json;
        assert.equal(mail.operation_key.includes(token), false);
        assert.equal(payload.message.operationKey.includes(token), false);
        assert.equal(payload.message.text.includes(token), true); // Deliberate, pending delivery only.
        assert.equal(effects.find(effect => effect.effect_type === 'mollie.refund.create').operation_key, financialKey);
    } finally { await connection.end(); }
});

test('restarted MySQL outbox reaper scrubs only exhausted auth mail without losing idempotency', async () => {
    await resetTestDatabase();
    const connection = await mysql.createConnection(dbConfig);
    const payload = { message: { text: 'synthetic-auth-link' } };
    const payloadHash = hashPayload(payload);
    const fixtures = [
        ['mail-password-reset:reaper-test', 'mail.send', true],
        ['mail-verify-resend-reaper-test', 'mail.send', true],
        ['mail-order-confirmation:reaper-test', 'mail.send', false],
        ['deposit-refund-reaper-test', 'mollie.refund.create', false]
    ];
    try {
        for (const [key, type] of fixtures) {
            await connection.execute(
                `INSERT INTO external_effects_outbox
                 (operation_key, effect_type, payload_json, payload_hash, status, available_at,
                  attempt_count, max_attempts, locked_at, locked_by)
                 VALUES (?, ?, ?, ?, 'processing', NOW(), 8, 8, DATE_SUB(NOW(), INTERVAL 2 MINUTE), 'crashed-worker')`,
                [key, type, JSON.stringify(payload), payloadHash]
            );
        }
        const reap = () => claimExternalEffect({
            workerId: 'restarted-worker', mailPaused: false,
            connectionFactory: () => mysql.createConnection(dbConfig)
        });
        assert.equal(await reap(), null);
        assert.equal(await reap(), null);
        const [rows] = await connection.execute(
            'SELECT operation_key, effect_type, status, payload_json, payload_hash FROM external_effects_outbox ORDER BY id'
        );
        assert.equal(rows.length, fixtures.length);
        for (const [key, type, redact] of fixtures) {
            const row = rows.find(candidate => candidate.operation_key === key);
            assert.equal(row.effect_type, type);
            assert.equal(row.status, 'dead');
            assert.equal(row.payload_hash, payloadHash);
            assert.deepEqual(typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json,
                redact ? { redacted: true } : payload);
        }
    } finally { await connection.end(); }
});
