'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { initializeFreshSchema } = require('../../database/bootstrap');
const { assertTestDatabaseName } = require('../support/database-schema');
const TEST_LEGAL_ENV = require('../support/legal-fixture');

// Real entrypoint and APIs; only an unpredictable, newly created test DB is
// mutated. Both the lock holder and observer are outside the child's budget.
const database = `segnitz_http_load_test_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
const profile = { firstName: 'Lasttest', lastName: 'Administrator', company: '', phone: '+49 931 123456',
    address: 'Synthetischer Testweg 1', zip: '97070', city: 'Würzburg' };
const email = 'http-load-fixture@example.invalid';
const password = `LoadFixture1!${crypto.randomBytes(12).toString('base64url')}`;
const limits = Object.freeze({ connections: 4, normal: 3, queue: 4, acquireMs: 250, queryMs: 4000, readyMs: 350 });
let created = false;
let child;
let childExit;
let baseURL;
let cookie = '';
let csrfToken = '';

function createConnection(options = {}) {
    return mysql.createConnection({ ...dbConfig.connectionConfig(options), database });
}

function retainSession(response) {
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    const session = cookies.find(value => value.startsWith('segnitz.sid='));
    if (session) cookie = session.split(';', 1)[0];
    if (response.headers.get('x-csrf-token')) csrfToken = response.headers.get('x-csrf-token');
}

async function call(pathname, { authenticated = false, method = 'GET', body } = {}) {
    const headers = {};
    if (authenticated) headers.cookie = cookie;
    if (body !== undefined) {
        headers['content-type'] = 'application/json';
        headers['x-csrf-token'] = csrfToken;
    }
    const started = performance.now();
    const response = await fetch(`${baseURL}${pathname}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(7000), redirect: 'manual'
    });
    const result = await response.json();
    return { status: response.status, durationMs: performance.now() - started, result };
}

async function stopChild() {
    if (!child) return;
    if (child.exitCode === null) child.kill('SIGTERM');
    let deadline;
    try {
        return await Promise.race([
            childExit,
            new Promise((resolve, reject) => {
                deadline = setTimeout(() => reject(new Error('Isolated load-test application did not drain within its hard deadline')), 7000);
            })
        ]);
    } catch (error) {
        if (child.exitCode === null) child.kill('SIGKILL');
        await childExit;
        throw error;
    } finally { clearTimeout(deadline); }
}

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
        await own.execute(
            `INSERT INTO users (username, password, role, first_name, last_name, company, phone, address, zip, city, email_verified)
             VALUES (?, ?, 'global_admin', ?, ?, ?, ?, ?, ?, ?, 1)`,
            [email, await bcrypt.hash(password, 4), profile.firstName, profile.lastName, profile.company,
                profile.phone, profile.address, profile.zip, profile.city]
        );
    } finally { await own.end(); }

    const reservation = net.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    baseURL = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server.js'], {
        cwd: path.resolve(__dirname, '../..'),
        env: { ...process.env, ...TEST_LEGAL_ENV, DB_NAME: database, PORT: String(port), BASE_URL: baseURL,
            NODE_ENV: 'test', DEPLOYMENT_ENV: 'test', TRUST_PROXY: '0',
            SESSION_SECRET: crypto.randomBytes(32).toString('base64url'),
            MOLLIE_TEST_MODE: '1', DISABLE_EMAILS: '1', MAIL_DELIVERY_PAUSED: '1',
            DISABLE_PERIODIC_CLEANUP: '1', DISABLE_PAYMENT_RECONCILIATION: '1',
            DB_LEGACY_DATETIME_MODE: 'utc', DB_LEGACY_WRITERS_STOPPED: '1',
            EXTERNAL_EFFECT_INTERVAL_MS: '250',
            DB_CONNECTION_LIMIT: String(limits.connections), DB_QUEUE_LIMIT: String(limits.queue),
            DB_ACQUIRE_TIMEOUT_MS: String(limits.acquireMs), DB_QUERY_TIMEOUT_MS: String(limits.queryMs),
            DB_READINESS_TIMEOUT_MS: String(limits.readyMs), DB_TRANSACTION_TIMEOUT_MS: '10000',
            APP_SHUTDOWN_HARD_DEADLINE_MS: '6000', APP_HTTP_SHUTDOWN_GRACE_MS: '1000',
            APP_CLEANUP_SHUTDOWN_GRACE_MS: '1000', APP_RESOURCE_SHUTDOWN_GRACE_MS: '1000',
            EXTERNAL_EFFECT_SHUTDOWN_GRACE_MS: '1000' },
        // Child uses central structured redaction. No raw response bodies,
        // sessions, credentials or provider fixtures are emitted by this test.
        stdio: ['ignore', 'ignore', 'ignore']
    });
    childExit = once(child, 'exit');
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
        assert.equal(child.exitCode, null, 'Isolated load-test application exited before readiness');
        try { ready = (await call('/ready')).status === 200; } catch { /* startup not listening yet */ }
        if (ready) break;
        await delay(100);
    }
    assert.equal(ready, true, 'Isolated load-test application must pass real bootstrap and readiness');

    const csrf = await fetch(`${baseURL}/csrf-token`);
    assert.equal(csrf.status, 200);
    retainSession(csrf);
    csrfToken = (await csrf.json()).csrfToken;
    const login = await fetch(`${baseURL}/login`, { method: 'POST',
        headers: { cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
        body: JSON.stringify({ username: email, password }), signal: AbortSignal.timeout(7000) });
    assert.equal(login.status, 200);
    retainSession(login);
    await login.json();
    assert.equal(cookie.length > 0 && csrfToken.length > 0, true);
    assert.equal((await call('/my-profile', { authenticated: true })).status, 200);
});

after(async () => {
    try { await stopChild(); }
    finally {
        if (created) {
            const { database: ignored, ...serverConfig } = dbConfig.connectionConfig({ migration: true });
            const cleanup = await mysql.createConnection(serverConfig);
            try { await cleanup.query(`DROP DATABASE \`${database}\``); }
            finally { await cleanup.end(); }
        }
    }
});

test('real HTTP overload keeps probes independent, releases queued work and recovers a persisted session', { timeout: 30000 }, async t => {
    const holder = await createConnection();
    const observer = await createConnection();
    const externalIds = new Set([holder.threadId, observer.threadId]);
    const childThreadIds = new Set();
    const blockedThreadIds = new Set();
    let maxChildThreads = 0;
    let sampling = true;
    let sampler;
    let blockedWrites = [];
    let held = false;
    const observe = async () => {
        const [rows] = await observer.execute('SELECT ID, INFO FROM information_schema.PROCESSLIST WHERE DB = ?', [database]);
        const owned = rows.filter(row => !externalIds.has(Number(row.ID)));
        for (const row of owned) childThreadIds.add(Number(row.ID));
        maxChildThreads = Math.max(maxChildThreads, owned.length);
        return owned;
    };
    try {
        const baseline = await call('/admin/operations-metrics', { authenticated: true });
        assert.equal(baseline.status, 200);
        assert.equal(baseline.result.dbPool.limit, limits.normal);
        assert.equal(baseline.result.dbPool.queueLimit, limits.queue);
        await holder.beginTransaction();
        await holder.execute('SELECT id FROM users WHERE username = ? FOR UPDATE', [email]);
        held = true;
        blockedWrites = Array.from({ length: limits.normal }, () => call('/my-profile', {
            authenticated: true, method: 'PUT', body: { ...profile, address: 'Nicht gespeicherter Lasttestweg 2' }
        }));
        // Attach rejection handling immediately; assertions below still consume
        // all outcomes if the app fails or a request crosses its hard timeout.
        for (const pending of blockedWrites) pending.catch(() => {});
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
            const rows = await observe();
            const writes = rows.filter(row => /\bUPDATE\s+users\b/iu.test(String(row.INFO || '')));
            if (writes.length === limits.normal) {
                for (const row of writes) blockedThreadIds.add(Number(row.ID));
                blocked = true;
                break;
            }
            await delay(10);
        }
        assert.equal(blocked, true, 'All normal app connections must reach the owned user-row lock before the burst');
        sampler = (async () => {
            while (sampling) { await observe(); await delay(15); }
        })();
        sampler.catch(() => {});
        const cases = Array.from({ length: 8 }, (_, index) => [
            { kind: 'live', pathname: '/live', authenticated: index % 2 === 0 },
            { kind: 'ready', pathname: '/ready', authenticated: index % 2 === 0 },
            { kind: 'profile', pathname: '/my-profile', authenticated: true }
        ]).flat();
        const results = await Promise.all(cases.map(async scenario => ({
            ...scenario, ...await call(scenario.pathname, scenario)
        })));
        for (const result of results) {
            assert.equal(result.status, result.kind === 'live' ? 200 : 503, `${result.kind} under the controlled DB lock`);
            assert.ok(result.durationMs < (result.kind === 'live' ? 750 : 1500),
                `${result.kind} exceeded the documented CI latency allowance (${Math.ceil(result.durationMs)} ms)`);
            if (result.kind === 'live') assert.equal(result.result.status, 'alive');
            if (result.kind === 'ready') assert.equal(result.result.database, 'unavailable');
        }
        const writes = await Promise.all(blockedWrites);
        for (const result of writes) {
            assert.equal(result.status, 503);
            assert.ok(result.durationMs < 6500, 'Blocked API query exceeded its bounded SQL/cleanup allowance');
        }
        sampling = false;
        await sampler;
        assert.ok(maxChildThreads <= limits.connections, `Child app exceeded its shared ${limits.connections}-connection budget`);
        let waitingGone = false;
        for (let attempt = 0; attempt < 100; attempt++) {
            const rows = await observe();
            waitingGone = !rows.some(row => blockedThreadIds.has(Number(row.ID)));
            if (waitingGone) break;
            await delay(20);
        }
        assert.equal(waitingGone, true, 'Every timed-out query connection must disappear from MySQL before releasing the blocking fixture');
        const [unchanged] = await holder.execute('SELECT address FROM users WHERE username = ?', [email]);
        assert.equal(unchanged[0].address, profile.address);
        await holder.rollback();
        held = false;

        for (const authenticated of [false, true]) {
            assert.equal((await call('/live', { authenticated })).status, 200);
            assert.equal((await call('/ready', { authenticated })).status, 200);
        }
        const recovered = await call('/my-profile', { authenticated: true });
        assert.equal(recovered.status, 200);
        assert.equal(recovered.result.address, profile.address);
        assert.equal((await call('/products')).status, 200);
        const finalMetrics = await call('/admin/operations-metrics', { authenticated: true });
        assert.equal(finalMetrics.status, 200);
        const pool = finalMetrics.result.dbPool;
        assert.equal(pool.queued, 0, 'Completed/aborted acquisitions may not remain queued');
        // The metrics snapshot is taken synchronously downstream of the auth
        // check, before its finally/end completes; that legitimate slot and
        // an independent worker may each still be present.
        assert.ok(pool.active <= 2, 'Only the current auth check and periodic worker may still own slots');
        assert.equal(pool.quarantined, 0);
        assert.equal(pool.cancellationFailures, 0);
        assert.ok(pool.rejected > baseline.result.dbPool.rejected);
        assert.ok(pool.acquireTimeouts > baseline.result.dbPool.acquireTimeouts);
        const shutdown = await stopChild();
        assert.equal(shutdown[0], 0, 'Server must finish its real shutdown drain successfully');
        const remaining = await observe();
        assert.equal(remaining.length, 0, 'Shutdown may leave no app connection/controller thread in the isolated DB');
        t.diagnostic(JSON.stringify({ profile: 'controlled-lock-burst', blockedWrites: writes.length,
            burstRequests: results.length, live200: results.filter(value => value.kind === 'live').length,
            ready503: results.filter(value => value.kind === 'ready').length,
            profile503: results.filter(value => value.kind === 'profile').length,
            maxLiveMs: Math.ceil(Math.max(...results.filter(value => value.kind === 'live').map(value => value.durationMs))),
            maxReadyMs: Math.ceil(Math.max(...results.filter(value => value.kind === 'ready').map(value => value.durationMs))),
            maxChildThreads, observedThreadCount: childThreadIds.size, queuedAfterRecovery: pool.queued,
            rejected: pool.rejected, acquireTimeouts: pool.acquireTimeouts,
            queryTimeouts: pool.queryTimeouts, shutdownExitCode: shutdown[0] }));
    } finally {
        sampling = false;
        if (sampler) await sampler.catch(() => {});
        if (held) await holder.rollback();
        await Promise.allSettled(blockedWrites);
        await holder.end();
        await observer.end();
    }
});
