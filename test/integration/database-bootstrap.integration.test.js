'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { after, before, test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { dropDatabaseSchema } = require('../support/database-schema');
const { resetTestDatabase } = require('../support/test-database');

const PORT = Number(process.env.BOOTSTRAP_TEST_PORT || 3104);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SETUP_TOKEN = 'bootstrap-test-token-with-at-least-32-characters';
const ADMIN = Object.freeze({
    email: 'first.admin@example.com',
    password: 'FirstAdminPassword123!'
});
const TEST_MOLLIE_API_KEY = 'test_abcdefghijklmnopqrstuvwxyz1234';

let serverProcess;
let serverOutput = '';

class SessionClient {
    constructor() {
        this.cookie = '';
    }

    async request(pathname, options = {}) {
        const headers = new Headers(options.headers || {});

        if (this.cookie) headers.set('cookie', this.cookie);

        const response = await fetch(`${BASE_URL}${pathname}`, {
            ...options,
            headers
        });
        const setCookie = response.headers.get('set-cookie');

        if (setCookie) this.cookie = setCookie.split(';', 1)[0];
        return response;
    }
}

async function waitForServer() {
    let lastError;

    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (serverProcess.exitCode !== null) {
            throw new Error(`Server wurde vorzeitig beendet.\n${serverOutput}`);
        }

        try {
            const response = await fetch(`${BASE_URL}/health`);
            if (response.ok) return;
        } catch (error) {
            lastError = error;
        }

        await delay(250);
    }

    throw new Error(
        `Bootstrap-Server wurde nicht rechtzeitig bereit: ${lastError?.message || 'unbekannter Fehler'}\n` +
        serverOutput
    );
}

async function startServer() {
    serverOutput = '';
    serverProcess = spawn(process.execPath, ['segnitz_rental.js'], {
        cwd: path.resolve(__dirname, '../..'),
        env: {
            ...process.env,
            PORT: String(PORT),
            BASE_URL,
            NODE_ENV: 'test',
            ADMIN_SETUP_TOKEN: SETUP_TOKEN,
            DISABLE_PERIODIC_CLEANUP: '1',
            MOLLIE_API_KEY: process.env.MOLLIE_API_KEY || TEST_MOLLIE_API_KEY
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', chunk => {
        serverOutput += chunk.toString();
    });
    serverProcess.stderr.on('data', chunk => {
        serverOutput += chunk.toString();
    });

    await waitForServer();
}

async function stopServer() {
    if (!serverProcess || serverProcess.exitCode !== null) return;

    serverProcess.kill('SIGTERM');
    await Promise.race([
        new Promise(resolve => serverProcess.once('exit', resolve)),
        delay(3000)
    ]);
}

before(async () => {
    const connection = await mysql.createConnection(dbConfig);

    try {
        await dropDatabaseSchema(connection);
    } finally {
        await connection.end();
    }

    await startServer();
});

after(async () => {
    await stopServer();
    await resetTestDatabase();
});

test('baut eine leere Datenbank auf und sperrt die Anwendung bis zum ersten Admin', async () => {
    const client = new SessionClient();

    const statusResponse = await client.request('/setup-status');
    assert.equal(statusResponse.status, 200);
    assert.deepEqual(await statusResponse.json(), { setupRequired: true });

    const setupPageResponse = await client.request('/setup.html');
    assert.equal(setupPageResponse.status, 200);
    assert.match(await setupPageResponse.text(), /Ersteinrichtung/);

    const blockedApiResponse = await client.request('/products', {
        headers: { Accept: 'application/json' }
    });
    assert.equal(blockedApiResponse.status, 503);
    assert.equal((await blockedApiResponse.json()).setupRequired, true);

    const blockedPageResponse = await client.request('/index.html', {
        headers: { Accept: 'text/html' },
        redirect: 'manual'
    });
    assert.equal(blockedPageResponse.status, 303);
    assert.equal(blockedPageResponse.headers.get('location'), '/setup.html');

    const invalidTokenResponse = await client.request('/setup-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            setupToken: 'wrong-token',
            firstName: 'First',
            lastName: 'Admin',
            email: ADMIN.email,
            password: ADMIN.password
        })
    });
    assert.equal(invalidTokenResponse.status, 403);

    const setupResponse = await client.request('/setup-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            setupToken: SETUP_TOKEN,
            firstName: 'First',
            lastName: 'Admin',
            email: ADMIN.email,
            password: ADMIN.password
        })
    });
    const setupResult = await setupResponse.json();

    assert.equal(setupResponse.status, 201, JSON.stringify(setupResult));
    assert.equal(setupResult.redirectTo, '/backend.html');
    assert.ok(client.cookie.startsWith('segnitz.sid='));

    const authResponse = await client.request('/auth-status');
    const auth = await authResponse.json();
    assert.equal(auth.loggedIn, true);
    assert.equal(auth.user, ADMIN.email);
    assert.equal(auth.role, 'global_admin');
    assert.match(auth.csrfToken, /^[a-f0-9]{64}$/);

    const ordersResponse = await client.request('/admin/orders');
    assert.equal(
        ordersResponse.status,
        200,
        `${await ordersResponse.clone().text()}\n\nServerausgabe:\n${serverOutput}`
    );
    assert.deepEqual((await ordersResponse.json()).items, []);

    const completedStatusResponse = await client.request('/setup-status');
    assert.deepEqual(await completedStatusResponse.json(), { setupRequired: false });
});

test('repariert ein unvollständiges Bestandsschema beim nächsten Start automatisch', async () => {
    await stopServer();

    const connection = await mysql.createConnection(dbConfig);

    try {
        await connection.query(
            'ALTER TABLE rental_order_payments DROP COLUMN checkout_url'
        );
        await connection.query(
            'ALTER TABLE rental_orders DROP COLUMN return_case_status'
        );
        await connection.query(
            `DELETE FROM app_schema_migrations
             WHERE version IN (
                '20260813_01_align_dump_with_application',
                '20260813_02_harden_return_lifecycle'
             )`
        );
    } finally {
        await connection.end();
    }

    await startServer();

    const verificationConnection = await mysql.createConnection(dbConfig);

    try {
        const [columns] = await verificationConnection.execute(
            `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
             AND (
                (TABLE_NAME = 'rental_orders' AND COLUMN_NAME = 'return_case_status')
                OR
                (TABLE_NAME = 'rental_order_payments' AND COLUMN_NAME = 'checkout_url')
             )`
        );
        const [migrationRows] = await verificationConnection.execute(
            `SELECT version
             FROM app_schema_migrations
             ORDER BY version`
        );

        assert.deepEqual(
            columns
                .map(row => `${row.tableName}.${row.columnName}`)
                .sort(),
            [
                'rental_order_payments.checkout_url',
                'rental_orders.return_case_status'
            ]
        );
        assert.deepEqual(
            migrationRows.map(row => row.version),
            [
                '20260813_01_align_dump_with_application',
                '20260813_02_harden_return_lifecycle'
            ]
        );
    } finally {
        await verificationConnection.end();
    }

    const client = new SessionClient();
    const statusResponse = await client.request('/setup-status');
    assert.deepEqual(await statusResponse.json(), { setupRequired: false });

    const loginResponse = await client.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username: ADMIN.email,
            password: ADMIN.password
        })
    });
    assert.equal(loginResponse.status, 200, await loginResponse.clone().text());

    const ordersResponse = await client.request('/admin/orders');
    assert.equal(
        ordersResponse.status,
        200,
        `${await ordersResponse.clone().text()}\n\nServerausgabe:\n${serverOutput}`
    );
});
