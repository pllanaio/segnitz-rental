'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { before, after, test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { initializeFreshSchema } = require('../../database/bootstrap');
const { createPaymentReconciler } = require('../../services/paymentReconciliationService');
const { assertTestDatabaseName } = require('../support/database-schema');

// All writes belong to a newly created, unpredictable database. The provider
// callback is explicitly isolated; no Mollie API or application API is mocked.
const database = `segnitz_reconciliation_test_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
let created = false;
const createConnection = options => mysql.createConnection({ ...dbConfig.connectionConfig(options), database });
const eligible = ['tr_paid_old1', 'tr_paid_old2', 'tr_pending1', 'tr_pending2',
    'tr_failed1', 'tr_charged', 'tr_refund', 'tr_paid_old3'];

before(async () => {
    assertTestDatabaseName(database);
    const { database: ignored, ...serverConfig } = dbConfig.connectionConfig({ migration: true });
    const setup = await mysql.createConnection(serverConfig);
    try {
        await setup.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
        created = true;
    } finally { await setup.end(); }
    const own = await createConnection({ migration: true });
    try {
        await initializeFreshSchema(own);
        const [order] = await own.execute("INSERT INTO rental_orders (order_no, status, payment_status, total_amount) VALUES ('SYNTHETIC-RECONCILIATION', 'confirmed', 'paid', 100)");
        const statuses = ['paid', 'paid', 'pending', 'pending', 'failed', 'paid', 'paid', 'paid'];
        for (const [index, id] of eligible.entries()) {
            await own.execute(
                `INSERT INTO rental_order_payments (order_id, payment_type, payment_method, payment_status, amount, mollie_payment_id)
                 VALUES (?, ?, 'online', ?, 10, ?)`,
                [order.insertId, index === 3 ? 'rental_adjustment' : 'initial_payment', statuses[index], id]
            );
        }
        // Shared initial/rent rows must be grouped. Paid sources with pending
        // refunds or chargebacks must still enter the urgent queue.
        for (const [type, method, status, amount, paymentId, refundId] of [
            ['rental', 'online', 'paid', 10, 'tr_paid_old1', null],
            ['chargeback', 'online', 'charged_back', -2, 'tr_charged', null],
            ['deposit_refund', 'online', 'pending', -2, 'tr_refund', null],
            ['deposit_refund', 'online', 'paid', -2, 'tr_refund_only', 're_refund_only'],
            ['initial_payment', 'cash', 'paid', 10, 'tr_cash', null],
            ['initial_payment', 'cash', 'paid', 10, null, null]
        ]) {
            await own.execute(
                `INSERT INTO rental_order_payments (order_id, payment_type, payment_method, payment_status, amount, mollie_payment_id, mollie_refund_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [order.insertId, type, method, status, amount, paymentId, refundId]
            );
        }
    } finally { await own.end(); }
});

after(async () => {
    if (!created) return;
    const { database: ignored, ...serverConfig } = dbConfig.connectionConfig({ migration: true });
    const cleanup = await mysql.createConnection(serverConfig);
    try { await cleanup.query(`DROP DATABASE \`${database}\``); }
    finally { await cleanup.end(); }
});

async function assertScannerClosed(observer, threadId) {
    // Observe the actual server connection, rather than just an end() spy.
    let rows;
    for (let attempt = 0; attempt < 20; attempt++) {
        [rows] = await observer.execute('SELECT ID FROM information_schema.PROCESSLIST WHERE ID = ?', [threadId]);
        if (!rows.length) break;
        await delay(10);
    }
    assert.equal(rows.length, 0, 'scanner connection must close before the external provider callback');
    assert.equal((await observer.query('SELECT 1 AS alive'))[0][0].alive, 1);
}

async function within(promise, timeoutMs) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Periodic reconciliation did not reach its isolated provider callback')), timeoutMs);
        })]);
    } finally { clearTimeout(timer); }
}

test('real MySQL reconciliation pages urgent and historical sources, deduplicates and recovers after provider timeout', { timeout: 15000 }, async () => {
    const observer = await createConnection();
    const logs = [];
    const seen = [];
    const batches = [];
    let scannerThreadId;
    let connections = 0;
    let failedOnce = false;
    const reconciler = createPaymentReconciler({
        batchSize: 4,
        logger: { error: (...args) => logs.push(args) },
        createConnection: async () => {
            const connection = await createConnection();
            scannerThreadId = connection.threadId;
            assert.notEqual(scannerThreadId, observer.threadId);
            connections++;
            return connection;
        },
        reconcilePayment: async id => {
            await assertScannerClosed(observer, scannerThreadId);
            seen.push(id);
            if (id === 'tr_failed1' && !failedOnce) {
                failedOnce = true;
                throw Object.assign(new Error('Isolated provider timeout'), { code: 'MOLLIE_TIMEOUT' });
            }
        }
    });
    try {
        for (let cycle = 0; cycle < 6; cycle++) {
            const start = seen.length;
            await reconciler.cycle(); // Execute the genuine prepared SQL; no query stubs.
            const batch = seen.slice(start);
            assert.ok(batch.length <= 4);
            assert.equal(new Set(batch).size, batch.length);
            batches.push(batch);
            if (cycle === 4) assert.equal(reconciler.progress.cursor, 0, 'historical scan must wrap after its final page');
        }
        assert.deepEqual(batches[0], ['tr_pending1', 'tr_pending2', 'tr_paid_old1', 'tr_paid_old2']);
        assert.deepEqual(batches[1], ['tr_failed1', 'tr_charged', 'tr_pending1', 'tr_pending2']);
        assert.deepEqual(batches[2], ['tr_refund', 'tr_failed1', 'tr_charged']);
        assert.deepEqual(batches[3], ['tr_paid_old3']);
        assert.deepEqual(new Set(seen), new Set(eligible));
        assert.equal(connections, 6);
        assert.equal(reconciler.progress.attempted, seen.length);
        assert.equal(reconciler.progress.succeeded, seen.length - 1);
        assert.equal(reconciler.progress.failed, 1);
        assert.ok(reconciler.progress.lastCompletedAt);
        assert.equal(logs.length, 1);
        assert.equal(logs[0][0], 'payment_reconciliation_failed');
        assert.equal(logs[0][1].code, 'MOLLIE_TIMEOUT');
    } finally { await reconciler.stop(); await observer.end(); }
});

test('real MySQL periodic reconciliation runs, coalesces concurrent cycles and drains with no provider-held DB connection', { timeout: 10000 }, async () => {
    const observer = await createConnection();
    const logs = [];
    let connections = 0;
    let scannerThreadId;
    let releaseProvider;
    const providerGate = new Promise(resolve => { releaseProvider = resolve; });
    let signalProvider;
    const providerEntered = new Promise(resolve => { signalProvider = resolve; });
    const reconciler = createPaymentReconciler({
        batchSize: 4, intervalMs: 1000,
        logger: { error: (...args) => logs.push(args) },
        createConnection: async () => {
            const connection = await createConnection();
            scannerThreadId = connection.threadId;
            connections++;
            return connection;
        },
        reconcilePayment: async () => {
            signalProvider();
            await providerGate;
        }
    });
    try {
        reconciler.start();
        await within(providerEntered, 4000);
        await assertScannerClosed(observer, scannerThreadId);
        const parallelCycle = reconciler.cycle();
        const stopped = reconciler.stop();
        releaseProvider();
        await Promise.all([parallelCycle, stopped]);
        assert.equal(connections, 1, 'active periodic and explicit cycles must share one scan');
        assert.equal(reconciler.progress.attempted, 1, 'shutdown drains the active callback and prevents further dispatch');
        assert.equal(reconciler.progress.succeeded, 1);
        assert.equal(reconciler.progress.failed, 0);
        assert.ok(reconciler.progress.lastCompletedAt);
        assert.deepEqual(logs, [], 'prepared reconciliation SQL must not produce ER_WRONG_ARGUMENTS');
    } finally { releaseProvider(); await reconciler.stop(); await observer.end(); }
});
