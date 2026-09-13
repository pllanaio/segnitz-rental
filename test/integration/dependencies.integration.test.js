'use strict';

const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const dbConfig = require('../../config/db');
const { rebuildDatabaseSchema } = require('../support/database-schema');
const {
    claimExternalEffect, enqueueExternalEffect, getExternalEffect, completeExternalEffect
} = require('../../services/externalEffectsOutbox');
const { processClaimedExternalEffect } = require('../../services/externalEffectsWorker');

before(async () => {
    const connection = await mysql.createConnection(dbConfig);
    try { await rebuildDatabaseSchema(connection); } finally { await connection.end(); }
});

test('patched MySQL session adapter persists across recreation and destroys logout state', async () => {
    const settings = { ...dbConfig, createDatabaseTable: false, clearExpired: false,
        endConnectionOnClose: true, schema: { tableName: 'user_sessions' } };
    const sessionId = crypto.randomUUID();
    const payload = { cookie: { expires: new Date(Date.now() + 60000).toISOString() },
        user: { id: 1, auth_version: 7 }, csrfToken: 'synthetic-noncredential' };
    const first = new MySQLStore(settings);
    try {
        await first.onReady();
        await first.set(sessionId, payload);
    } finally { await first.close(); }
    const restarted = new MySQLStore(settings);
    try {
        await restarted.onReady();
        assert.deepEqual(await restarted.get(sessionId), payload);
        await restarted.destroy(sessionId);
        assert.equal(await restarted.get(sessionId), null);
    } finally { await restarted.close(); }
});

test('maintenance skips mail claims without blocking payments or exhausting attempts', async () => {
    const previousPause = process.env.MAIL_DELIVERY_PAUSED;
    process.env.MAIL_DELIVERY_PAUSED = '1';
    const mailKey = `fixture-mail-${crypto.randomUUID()}`;
    const paymentKey = `fixture-payment-${crypto.randomUUID()}`;
    const payload = { message: { to: 'fixture@example.invalid', subject: 'synthetic fixture' } };
    try {
        await enqueueExternalEffect({ operationKey: mailKey, effectType: 'mail.send', payload, maxAttempts: 1 });
        await enqueueExternalEffect({ operationKey: paymentKey, effectType: 'mollie.payment.cancel',
            payload: { paymentId: 'tr_fixture' }, maxAttempts: 1 });
        for (let index = 0; index < 3; index += 1) {
            assert.equal(await claimExternalEffect({ operationKey: mailKey, workerId: 'fixture-worker' }), null);
        }
        const paused = await getExternalEffect(mailKey);
        assert.equal(paused.status, 'pending');
        assert.equal(paused.attempt_count, 0);
        assert.equal(paused.completed_at, null);
        assert.deepEqual(paused.payload, payload);
        const payment = await claimExternalEffect({ operationKey: paymentKey, workerId: 'fixture-worker' });
        assert.equal(payment.operation_key, paymentKey);
        await completeExternalEffect(payment, { fixture: true }); // No provider dispatch.
        process.env.MAIL_DELIVERY_PAUSED = '0';
        const mail = await claimExternalEffect({ operationKey: mailKey, workerId: 'fixture-worker', mailPaused: false });
        await processClaimedExternalEffect(mail, { deliverMail: async () => ({ accepted: true }) });
        assert.equal((await getExternalEffect(mailKey)).status, 'succeeded');
    } finally {
        if (previousPause === undefined) delete process.env.MAIL_DELIVERY_PAUSED;
        else process.env.MAIL_DELIVERY_PAUSED = previousPause;
    }
});

test('mail pause after a real claim returns its attempt and retains the payload', async () => {
    const mailKey = `fixture-mail-race-${crypto.randomUUID()}`;
    const payload = { message: { to: 'fixture@example.invalid', subject: 'pause race' } };
    await enqueueExternalEffect({ operationKey: mailKey, effectType: 'mail.send', payload, maxAttempts: 1 });
    const claimed = await claimExternalEffect({ operationKey: mailKey, workerId: 'fixture-worker', mailPaused: false });
    await processClaimedExternalEffect(claimed, { deliverMail: async () => {
        throw Object.assign(new Error('maintenance'), { code: 'MAIL_DELIVERY_PAUSED' });
    } });
    const deferred = await getExternalEffect(mailKey);
    assert.equal(deferred.status, 'pending');
    assert.equal(deferred.attempt_count, 0);
    assert.equal(deferred.completed_at, null);
    assert.equal(deferred.locked_by, null);
    assert.deepEqual(deferred.payload, payload);
});
