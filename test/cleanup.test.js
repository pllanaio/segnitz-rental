'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    createCleanupRunner,
    runCoordinatedDatabaseCleanup,
    runDatabaseCleanup
} = require('../utils/cleanup');

function createConnection({ failAtExecute = null } = {}) {
    const calls = [];
    let executeCount = 0;

    return {
        calls,
        async beginTransaction() {
            calls.push('begin');
        },
        async execute() {
            executeCount += 1;
            calls.push(`execute:${executeCount}`);
            if (executeCount === failAtExecute) throw new Error('simulierter Cleanup-Fehler');
            return [{ affectedRows: 0 }];
        },
        async commit() {
            calls.push('commit');
        },
        async rollback() {
            calls.push('rollback');
        }
    };
}

test('führt das gesamte Datenbank-Cleanup atomar aus', async () => {
    const connection = createConnection();

    await runDatabaseCleanup(connection);

    assert.deepEqual(connection.calls, [
        'begin',
        'execute:1',
        'execute:2',
        'execute:3',
        'execute:4',
        'commit'
    ]);
});

test('führt Cleanup pro Datenbank nur unter einem Advisory-Lock aus', async () => {
    const connection = createConnection();
    connection.query = async () => [[{ databaseName: 'segnitz_test' }]];
    connection.execute = async sql => {
        connection.calls.push(sql.includes('GET_LOCK') ? 'lock' :
            sql.includes('RELEASE_LOCK') ? 'unlock' : 'cleanup');
        if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
        if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
        return [{ affectedRows: 0 }];
    };

    assert.deepEqual(await runCoordinatedDatabaseCleanup(connection), { acquired: true });
    assert.deepEqual(connection.calls, [
        'lock', 'begin', 'cleanup', 'cleanup', 'cleanup', 'cleanup', 'commit', 'unlock'
    ]);
});

test('überspringt Cleanup, wenn eine andere Replik den Lock hält', async () => {
    const connection = createConnection();
    connection.query = async () => [[{ databaseName: 'segnitz_test' }]];
    connection.execute = async () => [[{ acquired: 0 }]];

    assert.deepEqual(await runCoordinatedDatabaseCleanup(connection), { acquired: false });
    assert.deepEqual(connection.calls, []);
});

test('rollt auch Fehler zwischen Item- und Order-Ablauf vollständig zurück', async () => {
    const connection = createConnection({ failAtExecute: 2 });

    await assert.rejects(
        runDatabaseCleanup(connection),
        /simulierter Cleanup-Fehler/
    );

    assert.deepEqual(connection.calls, [
        'begin',
        'execute:1',
        'execute:2',
        'rollback'
    ]);
});

test('koalesziert periodische Läufe und stellt den aktiven Job für Shutdown bereit', async () => {
    let finishCleanup;
    const cleanupGate = new Promise(resolve => { finishCleanup = resolve; });
    let cleanupCalls = 0;
    let connectionCloseCalls = 0;
    const runner = createCleanupRunner(
        async () => ({
            async end() { connectionCloseCalls += 1; }
        }),
        {
            async cleanup() {
                cleanupCalls += 1;
                await cleanupGate;
                return { acquired: true };
            },
            onError(error) {
                assert.fail(error);
            }
        }
    );

    const firstRun = runner.run();
    const concurrentRun = runner.run();
    const idle = runner.waitForIdle();

    assert.strictEqual(concurrentRun, firstRun);
    assert.strictEqual(idle, firstRun);
    await Promise.resolve();
    assert.equal(cleanupCalls, 1);

    finishCleanup();
    assert.deepEqual(await firstRun, { acquired: true });
    await runner.waitForIdle();
    assert.equal(connectionCloseCalls, 1);
});
