'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { ConnectionBudget, boundConnection } = require('../database/connectionBudget');

function rawConnection() {
    return {
        destroyed: 0,
        async query() { return [[{ alive: 1 }]]; },
        async execute() { return [[]]; },
        async beginTransaction() {}, async commit() {}, async rollback() {}, async end() {},
        destroy() { this.destroyed += 1; }
    };
}

test('shared budget bounds live sockets and its queue, times out acquires and recovers', async () => {
    const budget = new ConnectionBudget({ limit: 1, queueLimit: 1, acquireTimeoutMs: 15 });
    const release = await budget.acquire();
    const queued = budget.acquire();
    await assert.rejects(budget.acquire(), { code: 'DB_QUEUE_FULL', status: 503 });
    await assert.rejects(queued, { code: 'DB_ACQUIRE_TIMEOUT' });
    assert.equal(budget.snapshot().queued, 0);
    release(); release();
    const next = await budget.acquire();
    next();
    assert.equal(budget.snapshot().active, 0);
    assert.equal(budget.snapshot().acquired, 2);
});

test('query deadline destroys socket, rejects in-flight SQL and releases capacity', async () => {
    const budget = new ConnectionBudget({ limit: 1 });
    const raw = rawConnection();
    raw.query = async () => new Promise(() => {});
    const connection = boundConnection(raw, await budget.acquire(), { budget, queryTimeoutMs: 15 });
    await assert.rejects(connection.query('SELECT SLEEP(100)'), { code: 'DB_QUERY_TIMEOUT' });
    assert.equal(raw.destroyed, 1);
    assert.equal(budget.active, 0);
    await assert.rejects(connection.execute('SELECT 1'), { code: 'DB_QUERY_TIMEOUT' });
    await connection.end();
});

test('idle transaction deadline rolls back by disconnecting and cannot commit late', async () => {
    const budget = new ConnectionBudget();
    const raw = rawConnection();
    const connection = boundConnection(raw, await budget.acquire(), { budget, queryTimeoutMs: 200, transactionTimeoutMs: 15 });
    await connection.beginTransaction();
    await delay(25);
    await assert.rejects(connection.commit(), { code: 'DB_TRANSACTION_TIMEOUT' });
    assert.equal(raw.destroyed, 1);
    assert.equal(budget.snapshot().transactionTimeouts, 1);
    assert.equal(budget.active, 0);
});

test('shutdown closes all connections, cancels queued acquires and does not admit new work', async () => {
    const budget = new ConnectionBudget({ limit: 1 });
    const raw = rawConnection();
    boundConnection(raw, await budget.acquire(), { budget });
    const queued = budget.acquire();
    budget.close();
    await assert.rejects(queued, { code: 'DB_UNAVAILABLE' });
    await assert.rejects(budget.acquire(), { code: 'DB_UNAVAILABLE' });
    assert.equal(raw.destroyed, 1);
    assert.equal(budget.active, 0);
});

test('aborting a queued probe removes its queue entry immediately', async () => {
    const budget = new ConnectionBudget({ limit: 1 });
    const release = await budget.acquire();
    const abort = new AbortController();
    const waiting = budget.acquire(abort.signal);
    abort.abort();
    await assert.rejects(waiting, { code: 'DB_UNAVAILABLE' });
    assert.equal(budget.queue.length, 0);
    release();
});

test('timeout capacity stays charged until server execution cleanup is confirmed', async () => {
    const budget = new ConnectionBudget({ limit: 1 });
    const raw = rawConnection();
    raw.query = async () => new Promise(() => {});
    let confirm;
    const serverCleanup = new Promise(resolve => { confirm = resolve; });
    const connection = boundConnection(raw, await budget.acquire(), { budget, queryTimeoutMs: 10, cancelServer: () => serverCleanup });
    await assert.rejects(connection.query('SELECT SLEEP(30)'), { code: 'DB_QUERY_TIMEOUT' });
    assert.equal(budget.active, 1);
    confirm();
    await delay(0);
    assert.equal(budget.active, 0);
});

test('unconfirmed server cancellation quarantines capacity instead of overbooking connections', async () => {
    const budget = new ConnectionBudget({ limit: 1, queueLimit: 0 });
    const raw = rawConnection();
    const connection = boundConnection(raw, await budget.acquire(), { budget, cancelServer: async () => { throw new Error('control unavailable'); } });
    connection.destroy();
    await delay(0);
    assert.equal(budget.active, 1);
    assert.equal(budget.snapshot().quarantined, 1);
    await assert.rejects(budget.acquire(), { code: 'DB_QUEUE_FULL' });
});

test('one control connection kills only server-issued thread IDs and waits for disappearance', async () => {
    const { ServerCancellation } = require('../database/serverCancellation');
    const events = [];
    let reads = 0;
    const controller = new ServerCancellation({ connect: async () => ({
        async query(sql) { events.push(sql); },
        async execute(sql, params) { assert.equal(params[0], 42); reads += 1; return [reads < 2 ? [{ ID: 42 }] : []]; },
        destroy() { events.push('close'); }
    }) });
    await assert.rejects(controller.cancel({}, '1; DROP TABLE users'), { code: 'DB_CANCEL_INVALID_THREAD' });
    await controller.cancel({}, 42);
    assert.deepEqual(events, ['KILL CONNECTION 42', 'close']);
    assert.equal(reads, 2);
});

test('normal end keeps capacity until transport closes and rolls back an unfinished transaction first', async () => {
    const { EventEmitter } = require('node:events');
    const stream = new EventEmitter();
    const events = [];
    const raw = rawConnection();
    raw.connection = { stream };
    raw.rollback = async () => events.push('rollback');
    raw.end = async () => events.push('quit-queued');
    const budget = new ConnectionBudget({ limit: 1 });
    const connection = boundConnection(raw, await budget.acquire(), { budget });
    await connection.beginTransaction();
    const ending = connection.end();
    try {
        await delay(0);
        assert.equal(budget.active, 1, 'mysql2 end callback is not a transport-close acknowledgement');
        assert.deepEqual(events, ['rollback', 'quit-queued']);
    } finally {
        stream.emit('close');
        await ending;
    }
    assert.equal(budget.active, 0);
});

test('readonly transaction marker follows begin, commit, rollback, destruction and close', async () => {
    const key = Symbol.for('segnitz.mysql.transaction-active');
    const budget = new ConnectionBudget();
    const connection = boundConnection(rawConnection(), await budget.acquire(), { budget });
    assert.equal(connection[key], false);
    assert.throws(() => { connection[key] = true; }, TypeError);
    assert.equal(Object.getOwnPropertyDescriptor(connection, key).enumerable, false);
    await connection.beginTransaction();
    assert.equal(connection[key], true);
    await connection.commit();
    assert.equal(connection[key], false);
    await connection.beginTransaction();
    assert.equal(connection[key], true);
    await connection.rollback();
    assert.equal(connection[key], false);
    await connection.beginTransaction();
    await connection.end();
    assert.equal(connection[key], false);
    const destroyed = boundConnection(rawConnection(), await budget.acquire(), { budget });
    await destroyed.beginTransaction();
    assert.equal(destroyed[key], true);
    destroyed.destroy();
    assert.equal(destroyed[key], false);
});
