'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { before, after, test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { initializeFreshSchema } = require('../../database/bootstrap');
const { verifyCanonicalSchema } = require('../../database/schemaContract');
const { migrateUtcInstants } = require('../../database/migrations/20260913_utc_instants');
const { formatDateInTimeZone } = require('../../utils/businessDate');
const { assertTestDatabaseName } = require('../support/database-schema');

// Never reuse a deployment DB: even with an incorrectly supplied DB_NAME all
// mutation is confined to this newly created, unpredictable test database.
const testDatabase = `segnitz_runtime_test_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
let created = false;
const createConnection = options => mysql.createConnection({
    ...dbConfig.connectionConfig(options), database: testDatabase
});

before(async () => {
    assertTestDatabaseName(testDatabase);
    const { database, ...serverConfig } = dbConfig.connectionConfig({ migration: true });
    const connection = await mysql.createConnection(serverConfig);
    try {
        await connection.query(`CREATE DATABASE \`${testDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
        created = true;
    } finally { await connection.end(); }
    const own = await createConnection({ migration: true });
    try { await initializeFreshSchema(own); }
    finally { await own.end(); }
});

after(async () => {
    if (!created) return;
    const { database, ...serverConfig } = dbConfig.connectionConfig({ migration: true });
    const connection = await mysql.createConnection(serverConfig);
    try { await connection.query(`DROP DATABASE \`${testDatabase}\``); }
    finally { await connection.end(); }
});

test('UTC reconnect and real MySQL roundtrips preserve DST holds, leases, TIMESTAMP and DATE', async () => {
    for (const instant of ['2026-03-29T00:55:00Z', '2026-10-25T00:55:00Z']) {
        const connection = await createConnection();
        try {
            await connection.query('CREATE TEMPORARY TABLE instant_probe (hold_until DATETIME, locked_at DATETIME, instant TIMESTAMP, rental_day DATE)');
            await connection.query('SET timestamp = ?', [new Date(instant).getTime() / 1000]);
            await connection.execute("INSERT INTO instant_probe VALUES (DATE_ADD(NOW(), INTERVAL 15 MINUTE), NOW(), ?, '2026-10-25')", [new Date(instant)]);
            const [[row]] = await connection.query('SELECT *, @@session.time_zone AS zone, TIMESTAMPDIFF(SECOND, locked_at, hold_until) AS duration FROM instant_probe');
            assert.equal(row.zone, '+00:00');
            assert.equal(row.duration, 900);
            assert.equal(row.hold_until.getTime() - new Date(instant).getTime(), 900000);
            assert.equal(row.instant.toISOString(), new Date(instant).toISOString());
            assert.equal(row.rental_day, '2026-10-25');
            const [[serialized]] = await connection.query("SELECT DATE_FORMAT(instant, '%Y-%m-%dT%H:%i:%sZ') AS instant FROM instant_probe");
            assert.equal(new Date(serialized.instant).getTime(), new Date(instant).getTime());
            assert.equal(formatDateInTimeZone(row.instant), formatDateInTimeZone(new Date(instant)));
            await connection.query('SET timestamp = ?', [new Date(instant).getTime() / 1000 + 899]);
            const [[lease]] = await connection.query('SELECT locked_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE) AS expired FROM instant_probe');
            assert.equal(lease.expired, 0);
            await connection.query('SET timestamp = ?', [new Date(instant).getTime() / 1000 + 901]);
            const [[expiredLease]] = await connection.query('SELECT locked_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE) AS expired FROM instant_probe');
            assert.equal(expiredLease.expired, 1);
        } finally { await connection.end(); }
    }
    assert.equal(formatDateInTimeZone(new Date('2026-03-28T23:30:00Z')), '2026-03-29');
    assert.equal(formatDateInTimeZone(new Date('2026-10-24T22:30:00Z')), '2026-10-25');
});

test('schema verifier rejects disabled CHECK, missing AUTO_INCREMENT, ON UPDATE and collation/engine drift', async () => {
    const connection = await createConnection({ migration: true });
    try {
        await verifyCanonicalSchema(connection);
        const drifts = [
            ["ALTER TABLE users ALTER CHECK chk_users_email_verified NOT ENFORCED", "ALTER TABLE users ALTER CHECK chk_users_email_verified ENFORCED"],
            ["ALTER TABLE opening_hours MODIFY id INT NOT NULL", "ALTER TABLE opening_hours MODIFY id INT NOT NULL AUTO_INCREMENT"],
            ["ALTER TABLE opening_hours MODIFY updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP", "ALTER TABLE opening_hours MODIFY updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"],
            ["ALTER TABLE opening_hours DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin", "ALTER TABLE opening_hours DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"],
            ["ALTER TABLE users MODIFY username VARCHAR(255) COLLATE utf8mb4_bin NOT NULL", "ALTER TABLE users MODIFY username VARCHAR(255) COLLATE utf8mb4_0900_ai_ci NOT NULL"],
            ["ALTER TABLE user_sessions ENGINE=MyISAM", "ALTER TABLE user_sessions ENGINE=InnoDB"]
        ];
        for (const [drift, restore] of drifts) {
            await connection.query(drift);
            try { await assert.rejects(verifyCanonicalSchema(connection), { name: 'SchemaVerificationError' }); }
            finally { await connection.query(restore); }
            await verifyCanonicalSchema(connection);
        }
    } finally { await connection.end(); }
});

test('legacy migration preflight stops at DST fold before DML and preserves TIMESTAMP', async () => {
    const connection = await createConnection({ migration: true });
    try {
        await connection.execute("INSERT INTO guest_verifications (email, verification_token, expires_at) VALUES ('fold@example.invalid', 'synthetic-fold', '2026-10-25 02:10:00')");
        const [[before]] = await connection.query("SELECT CAST(expires_at AS CHAR) AS expiry, UNIX_TIMESTAMP(created_at) AS created FROM guest_verifications WHERE verification_token='synthetic-fold'");
        await assert.rejects(migrateUtcInstants(connection, { env: { DB_LEGACY_DATETIME_MODE: 'berlin', DB_LEGACY_WRITERS_STOPPED: '1' } }), { code: 'DB_LEGACY_DATETIME_REVIEW_REQUIRED' });
        const [[after]] = await connection.query("SELECT CAST(expires_at AS CHAR) AS expiry, UNIX_TIMESTAMP(created_at) AS created FROM guest_verifications WHERE verification_token='synthetic-fold'");
        assert.deepEqual(after, before);
        await connection.execute("DELETE FROM guest_verifications WHERE verification_token='synthetic-fold'");
    } finally { await connection.end(); }
});

test('legacy conversion survives interruption after committed batch and never applies twice', async () => {
    const connection = await createConnection({ migration: true });
    const env = { DB_LEGACY_DATETIME_MODE: 'berlin', DB_LEGACY_WRITERS_STOPPED: '1' };
    try {
        for (let index = 0; index < 201; index += 1) {
            await connection.execute("INSERT INTO guest_verifications (email, verification_token, expires_at) VALUES (?, ?, '2026-07-15 12:00:00')", [`batch-${index}@example.invalid`, `synthetic-batch-${index}`]);
        }
        const [[original]] = await connection.query("SELECT SUM(UNIX_TIMESTAMP(created_at)) AS created FROM guest_verifications WHERE verification_token LIKE 'synthetic-batch-%'");
        let interrupted = false;
        await assert.rejects(migrateUtcInstants(connection, { env, afterBatch: ({ table, completed }) => {
            if (table === 'guest_verifications' && !completed) { interrupted = true; throw new Error('injected worker exit after commit'); }
        } }), /injected worker exit/);
        assert.equal(interrupted, true);
        await migrateUtcInstants(connection, { env });
        await migrateUtcInstants(connection, { env });
        const [[result]] = await connection.query("SELECT COUNT(*) AS count, MIN(CAST(expires_at AS CHAR)) AS minExpiry, MAX(CAST(expires_at AS CHAR)) AS maxExpiry, SUM(UNIX_TIMESTAMP(created_at)) AS created FROM guest_verifications WHERE verification_token LIKE 'synthetic-batch-%'");
        assert.equal(result.count, 201);
        assert.equal(result.minExpiry, '2026-07-15 10:00:00');
        assert.equal(result.maxExpiry, '2026-07-15 10:00:00');
        assert.equal(result.created, original.created);
    } finally { await connection.end(); }
});

test('query deadline kills only the owned server thread and keeps independent connection usable', async () => {
    const timed = await createConnection();
    const observer = await createConnection();
    const threadId = timed.threadId;
    try {
        await assert.rejects(timed.query('SELECT SLEEP(30)'), error => ['DB_QUERY_TIMEOUT', 'ER_QUERY_TIMEOUT', 'ER_QUERY_INTERRUPTED'].includes(error.code));
        let running = true;
        for (let retry = 0; retry < 100; retry += 1) {
            const [rows] = await observer.execute('SELECT ID FROM information_schema.PROCESSLIST WHERE ID = ?', [threadId]);
            running = rows.length > 0;
            if (!running) break;
            await delay(50);
        }
        assert.equal(running, false, 'server-side query and connection cleanup must finish');
        assert.equal((await observer.query('SELECT 1 AS alive'))[0][0].alive, 1);
    } finally { await timed.end(); await observer.end(); }
});

test('session store persists and destroys sessions through the shared bounded adapter', async () => {
    const session = require('express-session');
    const MySQLStore = require('express-mysql-session')(session);
    const store = new MySQLStore({ createDatabaseTable: false, clearExpired: false, schema: { tableName: 'user_sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } } }, {
        async query(sql, params) {
            const connection = await createConnection();
            try { return await connection.query(sql, params); }
            finally { await connection.end(); }
        }
    });
    try {
        await store.onReady();
        await store.set('synthetic-runtime-session', { cookie: { expires: new Date(Date.now() + 60000) }, userId: 123 });
        assert.equal((await store.get('synthetic-runtime-session')).userId, 123);
        await store.destroy('synthetic-runtime-session');
        assert.equal(await store.get('synthetic-runtime-session'), null);
    } finally { await store.close(); }
});
