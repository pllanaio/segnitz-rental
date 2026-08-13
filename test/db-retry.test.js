'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    isRetryableTransactionError,
    runInTransactionWithRetry
} = require('../utils/dbRetry');

function connectionDouble(events) {
    return {
        async beginTransaction() { events.push('begin'); },
        async commit() { events.push('commit'); },
        async rollback() { events.push('rollback'); },
        async end() { events.push('end'); }
    };
}

test('erkennt ausschließlich Deadlocks und Lock-Timeouts als wiederholbar', () => {
    assert.equal(isRetryableTransactionError({ code: 'ER_LOCK_DEADLOCK' }), true);
    assert.equal(isRetryableTransactionError({ errno: 1205 }), true);
    assert.equal(isRetryableTransactionError({ code: 'ER_DUP_ENTRY' }), false);
});

test('wiederholt eine Transaktion nach Deadlock mit frischer Verbindung', async () => {
    const events = [];
    let calls = 0;

    const result = await runInTransactionWithRetry(
        async () => connectionDouble(events),
        async () => {
            calls += 1;
            if (calls === 1) {
                const error = new Error('deadlock');
                error.code = 'ER_LOCK_DEADLOCK';
                throw error;
            }
            return 'ok';
        }
    );

    assert.equal(result, 'ok');
    assert.equal(calls, 2);
    assert.deepEqual(events, [
        'begin', 'rollback', 'end',
        'begin', 'commit', 'end'
    ]);
});

test('wiederholt fachliche oder Constraint-Fehler nicht', async () => {
    let calls = 0;

    await assert.rejects(
        runInTransactionWithRetry(
            async () => connectionDouble([]),
            async () => {
                calls += 1;
                const error = new Error('duplicate');
                error.code = 'ER_DUP_ENTRY';
                throw error;
            }
        ),
        /duplicate/
    );

    assert.equal(calls, 1);
});
