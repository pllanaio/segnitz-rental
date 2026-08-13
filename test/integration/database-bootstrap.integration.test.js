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
        this.csrfToken = '';
    }

    async request(pathname, options = {}) {
        const headers = new Headers(options.headers || {});
        const method = String(options.method || 'GET').toUpperCase();
        const csrfExempt = pathname === '/setup-admin' || pathname === '/webhooks/mollie';

        if (
            this.csrfToken === '' &&
            !csrfExempt &&
            !['GET', 'HEAD', 'OPTIONS'].includes(method)
        ) {
            const csrfHeaders = this.cookie ? { cookie: this.cookie } : {};
            const csrfResponse = await fetch(`${BASE_URL}/csrf-token`, {
                headers: csrfHeaders
            });
            const csrfCookie = csrfResponse.headers.get('set-cookie');
            if (csrfCookie) this.cookie = csrfCookie.split(';', 1)[0];

            const csrfResult = await csrfResponse.json();
            assert.equal(csrfResponse.status, 200, JSON.stringify(csrfResult));
            this.csrfToken = String(csrfResult.csrfToken || '');
        }

        if (this.cookie) headers.set('cookie', this.cookie);
        if (this.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
            headers.set('x-csrf-token', this.csrfToken);
        }

        const response = await fetch(`${BASE_URL}${pathname}`, {
            ...options,
            headers
        });
        const setCookie = response.headers.get('set-cookie');

        if (setCookie) this.cookie = setCookie.split(';', 1)[0];
        const responseCsrfToken = response.headers.get('x-csrf-token');
        if (responseCsrfToken) this.csrfToken = responseCsrfToken;
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
    serverProcess = spawn(process.execPath, ['server.js'], {
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

    const liveResponse = await client.request('/live');
    assert.equal(liveResponse.status, 200);
    assert.equal((await liveResponse.json()).status, 'alive');

    for (const healthPath of ['/health', '/ready']) {
        const healthResponse = await client.request(healthPath);
        const health = await healthResponse.json();
        assert.equal(healthResponse.status, 200, JSON.stringify(health));
        assert.equal(health.database, 'ready');
        assert.equal(health.schema, 'ready');
    }

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

    const connection = await mysql.createConnection(dbConfig);
    try {
        const [openingHours] = await connection.execute(
            `SELECT weekday, is_open,
                    TIME_FORMAT(open_time, '%H:%i') AS openTime,
                    TIME_FORMAT(close_time, '%H:%i') AS closeTime
             FROM opening_hours ORDER BY weekday`
        );
        assert.deepEqual(openingHours, [
            { weekday: 0, is_open: 0, openTime: null, closeTime: null },
            { weekday: 1, is_open: 1, openTime: '08:00', closeTime: '17:00' },
            { weekday: 2, is_open: 1, openTime: '08:00', closeTime: '17:00' },
            { weekday: 3, is_open: 1, openTime: '08:00', closeTime: '17:00' },
            { weekday: 4, is_open: 1, openTime: '08:00', closeTime: '17:00' },
            { weekday: 5, is_open: 1, openTime: '08:00', closeTime: '17:00' },
            { weekday: 6, is_open: 0, openTime: null, closeTime: null }
        ]);
    } finally {
        await connection.end();
    }
});

test('akzeptiert alle definierten Lifecycle-Werte und verwirft unbekannte Status', async () => {
    const connection = await mysql.createConnection(dbConfig);
    let cartId;
    let orderId;
    let paymentId;
    let productId;
    let itemId;

    const expectConstraintFailure = promise => assert.rejects(
        promise,
        error => error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || /check constraint/iu.test(error?.message)
    );

    try {
        const [product] = await connection.execute(
            `INSERT INTO rental_products (product_key, title, price_per_day, deposit)
             VALUES ('bootstrap-lifecycle-product', 'Lifecycle-Test', 1, 1)`
        );
        productId = product.insertId;
        const [cart] = await connection.execute(
            `INSERT INTO rental_carts (session_id, status) VALUES ('bootstrap-lifecycle-cart', 'active')`
        );
        cartId = cart.insertId;
        await connection.execute("UPDATE rental_carts SET status = 'converted' WHERE id = ?", [cartId]);
        await expectConstraintFailure(
            connection.execute("UPDATE rental_carts SET status = 'unknown' WHERE id = ?", [cartId])
        );

        const [order] = await connection.execute(
            `INSERT INTO rental_orders (status, total_amount) VALUES ('reserved', 0)`
        );
        orderId = order.insertId;
        for (const status of [
            'reserved', 'pending_payment', 'payment_failed', 'paid', 'confirmed', 'active',
            'picked_up', 'returned', 'partially_returned', 'cancelled',
            'partially_cancelled', 'expired', 'payment_dispute'
        ]) {
            await connection.execute('UPDATE rental_orders SET status = ? WHERE id = ?', [status, orderId]);
        }
        for (const status of [
            null, 'pending', 'open', 'authorized', 'paid', 'failed', 'cancelled', 'expired',
            'charged_back', 'refunded', 'refund_pending', 'refund_failed'
        ]) {
            await connection.execute(
                'UPDATE rental_orders SET payment_status = ? WHERE id = ?', [status, orderId]
            );
        }
        for (const status of [
            null, 'pending', 'not_required', 'returned_ok', 'returned_damaged',
            'returned_late', 'returned_late_damaged'
        ]) {
            await connection.execute(
                'UPDATE rental_orders SET return_status = ? WHERE id = ?', [status, orderId]
            );
        }
        for (const status of [
            null, 'open', 'partial', 'closed', 'payment_failed', 'payment_pending',
            'refund_failed', 'refund_pending', 'payment_dispute'
        ]) {
            await connection.execute(
                'UPDATE rental_orders SET return_case_status = ? WHERE id = ?', [status, orderId]
            );
        }
        await expectConstraintFailure(
            connection.execute("UPDATE rental_orders SET status = 'unknown' WHERE id = ?", [orderId])
        );

        const [item] = await connection.execute(
            `INSERT INTO rental_order_items
             (order_id, product_id, rental_start, rental_end, price_per_day, deposit)
             VALUES (?, ?, '2027-01-01', '2027-01-02', 1, 1)`,
            [orderId, productId]
        );
        itemId = item.insertId;
        for (const status of [
            'active', 'picked_up', 'cancelled', 'expired', 'returned_ok',
            'returned_damaged', 'returned_late', 'returned_late_damaged'
        ]) {
            await connection.execute(
                'UPDATE rental_order_items SET item_status = ? WHERE id = ?', [status, itemId]
            );
        }
        for (const decision of [null, 'no_refund', 'full_refund', 'partial_refund']) {
            await connection.execute(
                'UPDATE rental_order_items SET deposit_decision = ? WHERE id = ?', [decision, itemId]
            );
        }
        for (const status of [
            null, 'pending', 'not_required', 'returned_ok', 'returned_damaged',
            'returned_late', 'returned_late_damaged'
        ]) {
            await connection.execute(
                'UPDATE rental_order_items SET return_status = ? WHERE id = ?', [status, itemId]
            );
        }
        await expectConstraintFailure(
            connection.execute(
                "UPDATE rental_order_items SET item_status = 'unknown' WHERE id = ?", [itemId]
            )
        );

        const [payment] = await connection.execute(
            `INSERT INTO rental_order_payments
             (order_id, payment_type, payment_method, payment_status, amount)
             VALUES (?, 'initial_payment', 'cash', 'pending', 1)`,
            [orderId]
        );
        paymentId = payment.insertId;
        for (const type of [
            'initial_payment', 'rental', 'deposit', 'rental_adjustment',
            'return_additional_charge', 'deposit_refund', 'order_cancellation_refund',
            'duplicate_payment_refund', 'chargeback', 'refund_record'
        ]) {
            await connection.execute(
                'UPDATE rental_order_payments SET payment_type = ? WHERE id = ?', [type, paymentId]
            );
        }
        for (const status of [
            'pending', 'open', 'authorized', 'paid', 'failed', 'cancelled', 'expired',
            'charged_back', 'offset', 'replaced', 'refunded'
        ]) {
            await connection.execute(
                'UPDATE rental_order_payments SET payment_status = ? WHERE id = ?', [status, paymentId]
            );
        }
        await expectConstraintFailure(
            connection.execute(
                "UPDATE rental_order_payments SET payment_status = 'unknown' WHERE id = ?", [paymentId]
            )
        );
    } finally {
        if (paymentId) await connection.execute('DELETE FROM rental_order_payments WHERE id = ?', [paymentId]);
        if (orderId) await connection.execute('DELETE FROM rental_orders WHERE id = ?', [orderId]);
        if (cartId) await connection.execute('DELETE FROM rental_carts WHERE id = ?', [cartId]);
        if (productId) await connection.execute('DELETE FROM rental_products WHERE id = ?', [productId]);
        await connection.end();
    }
});

test('repariert ein unvollständiges Bestandsschema beim nächsten Start automatisch', async () => {
    await stopServer();

    const connection = await mysql.createConnection(dbConfig);

    try {
        await connection.query(
            'ALTER TABLE rental_orders DROP CHECK chk_rental_orders_lifecycle'
        );
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
                '20260813_02_harden_return_lifecycle',
                '20260813_03_schema_invariants_and_opening_hours'
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
                '20260813_02_harden_return_lifecycle',
                '20260813_03_schema_invariants_and_opening_hours',
                '20260813_04_business_data_concurrency',
                '20260813_05_external_effects_outbox',
                '20260813_06_user_auth_version'
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
