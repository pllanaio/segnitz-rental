'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { resetTestDatabase, TEST_USER } = require('../support/test-database');
const { hashAuthToken } = require('../../services/authTokenService');
const { up } = require('../../database/migrations/20260913_auth_secrets');

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
