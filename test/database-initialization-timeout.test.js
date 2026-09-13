'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const mysqlDriver = require('mysql2');
const mysql = require('mysql2/promise');
const db = require('../config/db');

test('session initialization timeout keeps capacity charged until server cancellation is confirmed', async () => {
    const originalConnect = mysqlDriver.createConnection;
    const originalTimeout = process.env.DB_QUERY_TIMEOUT_MS;
    process.env.DB_QUERY_TIMEOUT_MS = '10';
    let connects = 0;
    let confirm;
    let controlStarted;
    const started = new Promise(resolve => { controlStarted = resolve; });
    const confirmation = new Promise(resolve => { confirm = resolve; });
    mysqlDriver.createConnection = () => {
        const work = connects++ === 0;
        const promiseConnection = {
            threadId: work ? 42 : 43,
            async execute() { if (work) return new Promise(() => {}); controlStarted(); return confirmation; },
            async query() { return [[]]; },
            async end() {}, destroy() {},
            async beginTransaction() {}, async commit() {}, async rollback() {}
        };
        return { connect(callback) { callback(null); }, promise() { return promiseConnection; }, destroy() {} };
    };
    const activeBefore = db.connectionBudget.active;
    try {
        await assert.rejects(mysql.createConnection(db), { code: 'DB_QUERY_TIMEOUT' });
        await started;
        assert.equal(db.connectionBudget.active, activeBefore + 1, 'failed SET SESSION must not bypass server cancellation quarantine');
    } finally {
        confirm([[]]);
        await delay(0);
        mysqlDriver.createConnection = originalConnect;
        if (originalTimeout === undefined) delete process.env.DB_QUERY_TIMEOUT_MS;
        else process.env.DB_QUERY_TIMEOUT_MS = originalTimeout;
    }
    assert.equal(db.connectionBudget.active, activeBefore);
});

test('shutdown dispatches and drains owned server cancellation before stopping the controller', async () => {
    const originalConnect = mysqlDriver.createConnection;
    let connects = 0;
    const kills = [];
    mysqlDriver.createConnection = () => {
        const work = connects++ === 0;
        const promiseConnection = {
            threadId: work ? 52 : 53,
            async execute() { return [[]]; },
            async query(sql) { if (!work) kills.push(sql); return [[]]; },
            async end() {}, destroy() {},
            async beginTransaction() {}, async commit() {}, async rollback() {}
        };
        return { connect(callback) { callback(null); }, promise() { return promiseConnection; }, destroy() {} };
    };
    try {
        await mysql.createConnection(db);
        await db.closeConnections();
        assert.deepEqual(kills, ['KILL CONNECTION 52']);
        assert.equal(db.connectionBudget.active, 0);
    } finally { mysqlDriver.createConnection = originalConnect; }
});
