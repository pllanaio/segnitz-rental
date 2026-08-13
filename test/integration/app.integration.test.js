'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const { after, before, test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const path = require('node:path');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { createOperationKey } = require('../../services/externalEffectsOutbox');
const { ORDER_ACCESS_COOKIE, hashOrderAccessToken } = require('../../services/orderAccessService');
const { RETURN_IMAGE_DIRECTORY } = require('../../utils/uploads');
const {
    resetTestDatabase,
    TEST_ADMIN,
    TEST_PRODUCT,
    TEST_USER
} = require('../support/test-database');

const PORT = Number(process.env.TEST_PORT || 3101);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_MOLLIE_API_KEY = 'test_abcdefghijklmnopqrstuvwxyz1234';
let serverProcess;
let serverOutput = '';

function readSessionCookie(response) {
    const values = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);

    for (const value of values) {
        const match = String(value).match(/(?:^|,\s*)(segnitz\.sid=[^;]+)/);
        if (match) return match[1];
    }

    return null;
}

class SessionClient {
    constructor() {
        this.cookie = '';
        this.csrfToken = '';
    }

    async request(pathname, options = {}) {
        const headers = new Headers(options.headers || {});
        const method = String(options.method || 'GET').toUpperCase();

        if (this.csrfToken === '' && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
            const csrfHeaders = this.cookie ? { cookie: this.cookie } : {};
            const csrfResponse = await fetch(`${BASE_URL}/csrf-token`, {
                headers: csrfHeaders
            });
            const csrfCookie = readSessionCookie(csrfResponse);
            if (csrfCookie) this.cookie = csrfCookie.split(';', 1)[0];

            const csrfResult = await csrfResponse.json();
            assert.equal(csrfResponse.status, 200, JSON.stringify(csrfResult));
            this.csrfToken = String(csrfResult.csrfToken || '');
        }

        if (this.cookie) {
            headers.set('cookie', this.cookie);
        }

        if (this.csrfToken && !['GET', 'HEAD'].includes(method)) {
            headers.set('x-csrf-token', this.csrfToken);
        }

        const response = await fetch(`${BASE_URL}${pathname}`, {
            ...options,
            headers
        });

        const setCookie = readSessionCookie(response);
        if (setCookie) {
            this.cookie = setCookie.split(';', 1)[0];
        }

        const responseCsrfToken = response.headers.get('x-csrf-token');
        if (responseCsrfToken) this.csrfToken = responseCsrfToken;

        return response;
    }
}

function futureDate(offsetDays) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return date.toISOString().slice(0, 10);
}

async function waitForServer() {
    let lastError;

    for (let attempt = 0; attempt < 60; attempt += 1) {
        if (serverProcess.exitCode !== null) {
            throw new Error(`Server wurde vorzeitig beendet.\n${serverOutput}`);
        }

        try {
            const response = await fetch(`${BASE_URL}/auth-status`);
            if (response.ok) return;
        } catch (error) {
            lastError = error;
        }

        await delay(250);
    }

    throw new Error(`Server wurde nicht rechtzeitig bereit: ${lastError?.message || 'unbekannter Fehler'}\n${serverOutput}`);
}

async function waitForProductLockWait(connection) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const [processes] = await connection.query('SHOW FULL PROCESSLIST');
        // Die State-Bezeichnung eines Row-Lock-Waits ist zwischen MySQL-Versionen
        // nicht stabil. Da diese Verbindung den Produktdatensatz bereits exklusiv
        // sperrt, kann eine zweite passende SELECT-Abfrage erst nach dem Commit
        // fortfahren; ihre sichtbare Query reicht daher als deterministisches Signal.
        const waiting = processes.some(process =>
            /FROM rental_products/i.test(String(process.Info || ''))
        );
        if (waiting) return;
        await delay(20);
    }

    throw new Error('Checkout hat den erwarteten Produkt-Lock nicht erreicht.');
}

before(async () => {
    await resetTestDatabase();

    serverProcess = spawn(process.execPath, ['server.js'], {
        cwd: path.resolve(__dirname, '../..'),
        env: {
            ...process.env,
            PORT: String(PORT),
            NODE_ENV: 'test',
            DISABLE_PERIODIC_CLEANUP: '1',
            MOLLIE_API_KEY: process.env.MOLLIE_API_KEY || TEST_MOLLIE_API_KEY,
            MOLLIE_TEST_MODE: '1',
            BASE_URL
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
});

after(async () => {
    if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill('SIGTERM');
        await Promise.race([
            new Promise(resolve => serverProcess.once('exit', resolve)),
            delay(3000)
        ]);
    }
});

test('liefert den öffentlichen Produktkatalog mit Kategorien aus', async () => {
    const connection = await mysql.createConnection(dbConfig);

    try {
        await connection.execute(
            `INSERT INTO rental_products
             (id, product_key, title, description, price_per_day, deposit, is_active)
             VALUES (2, 'TEST-INAKTIV', 'Internes Testprodukt', 'Nicht öffentlich', 1, 0, 0)`
        );
    } finally {
        await connection.end();
    }

    const client = new SessionClient();

    const productsResponse = await client.request('/products');
    assert.equal(productsResponse.status, 200);
    assert.match(productsResponse.headers.get('cache-control') || '', /private/);
    assert.match(productsResponse.headers.get('cache-control') || '', /no-store/);
    assert.match(productsResponse.headers.get('vary') || '', /Cookie/i);

    const products = await productsResponse.json();
    assert.equal(products.length, 1);
    assert.equal(products[0].id, TEST_PRODUCT.id);
    assert.equal(products[0].title, TEST_PRODUCT.title);
    assert.equal(products.some(product => product.product_key === 'TEST-INAKTIV'), false);
    assert.deepEqual(products[0].categories, [
        { id: 1, name: 'Baumaschinen', slug: 'baumaschinen' }
    ]);

    const categoriesResponse = await client.request('/categories');
    assert.equal(categoriesResponse.status, 200);
    assert.deepEqual(await categoriesResponse.json(), [
        { id: 1, name: 'Baumaschinen', slug: 'baumaschinen' }
    ]);

    const admin = new SessionClient();
    const loginResponse = await admin.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username: TEST_ADMIN.email,
            password: TEST_ADMIN.password
        })
    });
    assert.equal(loginResponse.status, 200, await loginResponse.text());

    const adminProductsResponse = await admin.request('/products');
    assert.equal(adminProductsResponse.status, 200);
    assert.match(adminProductsResponse.headers.get('cache-control') || '', /private/);
    assert.match(adminProductsResponse.headers.get('cache-control') || '', /no-store/);
    assert.match(adminProductsResponse.headers.get('vary') || '', /Cookie/i);
    const adminProducts = await adminProductsResponse.json();
    assert.equal(adminProducts.length, 2);
    assert.equal(
        adminProducts.find(product => product.product_key === 'TEST-INAKTIV')?.is_active,
        0
    );
});

test('blockiert laufende Zahlungsreservierungen in der öffentlichen Verfügbarkeit', async () => {
    const connection = await mysql.createConnection(dbConfig);
    const expectedPeriods = [
        {
            status: 'pending_payment',
            paymentStatus: 'pending',
            rentalStart: '2099-01-03',
            rentalEnd: '2099-01-05'
        },
        {
            status: 'payment_failed',
            paymentStatus: 'failed',
            rentalStart: '2099-02-03',
            rentalEnd: '2099-02-05'
        }
    ];

    try {
        for (const [index, period] of expectedPeriods.entries()) {
            const [orderResult] = await connection.execute(
                `INSERT INTO rental_orders
                 (order_no, status, reserved_until, payment_status)
                 VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR), ?)`,
                [`R-AVAILABILITY-${index}`, period.status, period.paymentStatus]
            );

            await connection.execute(
                `INSERT INTO rental_order_items
                 (order_id, product_id, rental_start, rental_end, price_per_day, deposit, item_status)
                 VALUES (?, ?, ?, ?, 49.90, 150, 'active')`,
                [orderResult.insertId, TEST_PRODUCT.id, period.rentalStart, period.rentalEnd]
            );
        }
    } finally {
        await connection.end();
    }

    const response = await new SessionClient().request(`/products/${TEST_PRODUCT.id}/availability`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expectedPeriods.map(({ rentalStart, rentalEnd }) => ({
        rentalStart,
        rentalEnd
    })));
});

test('liefert öffentliche Bewertungen ohne Kunden-E-Mail und Bestellbezug aus', async () => {
    const connection = await mysql.createConnection(dbConfig);
    const reviewText = '<button data-backend-action="mark-item-picked-up">Nicht ausführen</button>';
    let orderId;

    try {
        const [users] = await connection.execute(
            'SELECT id FROM users WHERE username = ? LIMIT 1',
            [TEST_USER.email]
        );
        const [orderResult] = await connection.execute(
            `INSERT INTO rental_orders
             (order_no, user_id, customer_email, customer_first_name, customer_last_name, status)
             VALUES ('R-REVIEW-PRIVACY', ?, ?, 'Test', 'Kunde', 'returned')`,
            [users[0].id, TEST_USER.email]
        );
        orderId = orderResult.insertId;

        await connection.execute(
            `INSERT INTO rental_order_items
             (order_id, product_id, rental_start, rental_end, price_per_day, deposit,
              item_status, return_status, returned_at)
             VALUES (?, ?, '2026-01-01', '2026-01-02', 49.90, 150,
                     'returned_ok', 'returned_ok', NOW())`,
            [orderId, TEST_PRODUCT.id]
        );
    } finally {
        await connection.end();
    }

    const client = new SessionClient();
    const loginResponse = await client.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username: TEST_USER.email,
            password: TEST_USER.password
        })
    });
    assert.equal(loginResponse.status, 200);

    const createResponse = await client.request(`/products/${TEST_PRODUCT.id}/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId, rating: 5, reviewText })
    });
    assert.equal(createResponse.status, 200, JSON.stringify(await createResponse.json()));

    const response = await client.request(`/products/${TEST_PRODUCT.id}/reviews`);
    assert.equal(response.status, 200);

    const reviews = await response.json();
    assert.equal(reviews.length, 1);
    assert.deepEqual(Object.keys(reviews[0]).sort(), [
        'createdAt',
        'displayName',
        'rating',
        'reviewText'
    ]);
    assert.equal(reviews[0].reviewText, reviewText);
    assert.equal(reviews[0].displayName, 'Test K.');
    assert.equal('firstName' in reviews[0], false);
    assert.equal('lastName' in reviews[0], false);
});

test('weist Review-Texte mit falschem Typ oder mehr als 2000 Zeichen ab', async () => {
    const client = new SessionClient();
    const loginResponse = await client.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username: TEST_USER.email,
            password: TEST_USER.password
        })
    });
    assert.equal(loginResponse.status, 200);

    for (const reviewText of [{ html: '<button>kein String</button>' }, 'x'.repeat(2001)]) {
        const response = await client.request(`/products/${TEST_PRODUCT.id}/reviews`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orderId: 999999, rating: 5, reviewText })
        });

        assert.equal(response.status, 400);
    }
});

test('liefert Rückgabefotos nur an Bestellinhaber und Admin ohne Cache aus', async t => {
    const filename = 'return_item_1_2099010100000_00000000-0000-4000-8000-000000000001.png';
    const imagePath = `img/returns/${filename}`;
    const absoluteImagePath = path.join(RETURN_IMAGE_DIRECTORY, filename);
    const strangerEmail = 'return-image-stranger@example.com';
    const strangerPassword = 'StrangerPassword123!';
    const orderNo = 'R-PRIVATE-RETURN-IMAGE';
    const connection = await mysql.createConnection(dbConfig);

    t.after(async () => {
        await fs.rm(absoluteImagePath, { force: true });
        const cleanupConnection = await mysql.createConnection(dbConfig);
        try {
            await cleanupConnection.execute('DELETE FROM rental_orders WHERE order_no = ?', [orderNo]);
            await cleanupConnection.execute('DELETE FROM users WHERE username = ?', [strangerEmail]);
        } finally {
            await cleanupConnection.end();
        }
    });

    try {
        const [ownerRows] = await connection.execute(
            'SELECT id FROM users WHERE username = ? LIMIT 1',
            [TEST_USER.email]
        );
        const strangerHash = await bcrypt.hash(strangerPassword, 4);
        await connection.execute(
            `INSERT INTO users
             (username, password, role, first_name, last_name, customer_no, email_verified)
             VALUES (?, ?, 'customer', 'Fremde', 'Person', 'TEST-RETURN-STRANGER', 1)`,
            [strangerEmail, strangerHash]
        );
        const [orderResult] = await connection.execute(
            `INSERT INTO rental_orders
             (order_no, user_id, customer_email, customer_first_name, customer_last_name,
              status, return_status, return_case_status)
             VALUES (?, ?, ?, 'Test', 'Kunde',
                     'returned', 'returned_ok', 'closed')`,
            [orderNo, ownerRows[0].id, TEST_USER.email]
        );
        const [itemResult] = await connection.execute(
            `INSERT INTO rental_order_items
             (order_id, product_id, rental_start, rental_end, price_per_day, deposit,
              item_status, return_status, returned_at)
             VALUES (?, ?, '2026-01-01', '2026-01-02', 49.90, 150,
                     'returned_ok', 'returned_ok', NOW())`,
            [orderResult.insertId, TEST_PRODUCT.id]
        );
        await connection.execute(
            `INSERT INTO rental_order_return_images
             (order_id, order_item_id, image_path, uploaded_by_user_id)
             VALUES (?, ?, ?, ?)`,
            [orderResult.insertId, itemResult.insertId, imagePath, ownerRows[0].id]
        );
    } finally {
        await connection.end();
    }

    await fs.mkdir(RETURN_IMAGE_DIRECTORY, { recursive: true });
    await fs.writeFile(
        absoluteImagePath,
        Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=', 'base64')
    );

    const anonymousResponse = await new SessionClient().request(`/${imagePath}`);
    assert.equal(anonymousResponse.status, 404);

    const stranger = new SessionClient();
    assert.equal((await stranger.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: strangerEmail, password: strangerPassword })
    })).status, 200);
    assert.equal((await stranger.request(`/${imagePath}`)).status, 404);

    for (const credentials of [TEST_USER, TEST_ADMIN]) {
        const client = new SessionClient();
        assert.equal((await client.request('/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                username: credentials.email,
                password: credentials.password
            })
        })).status, 200);

        const response = await client.request(`/${imagePath}`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control') || '', /private/);
        assert.match(response.headers.get('cache-control') || '', /no-store/);
        const etag = response.headers.get('etag');
        await response.arrayBuffer();

        if (etag) {
            const conditionalResponse = await client.request(`/${imagePath}`, {
                headers: { 'if-none-match': etag }
            });
            assert.equal(conditionalResponse.status, 200);
        }
    }
});

test('legt einen Gast-Warenkorb an, verhindert Doppelungen und leert ihn wieder', async () => {
    const client = new SessionClient();
    const rentalStart = futureDate(10);
    const rentalEnd = futureDate(12);

    const addResponse = await client.request('/cart/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            productId: TEST_PRODUCT.id,
            rentalStart,
            rentalEnd
        })
    });

    assert.equal(addResponse.status, 201);
    assert.ok(client.cookie.startsWith('segnitz.sid='));

    const cartResponse = await client.request('/cart');
    assert.equal(cartResponse.status, 200);

    const cart = await cartResponse.json();
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].title, TEST_PRODUCT.title);
    assert.equal(cart.items[0].rentalStart, rentalStart);
    assert.equal(cart.items[0].rentalEnd, rentalEnd);

    const duplicateResponse = await client.request('/cart/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            productId: TEST_PRODUCT.id,
            rentalStart,
            rentalEnd
        })
    });
    assert.equal(duplicateResponse.status, 409);

    const clearResponse = await client.request('/cart', { method: 'DELETE' });
    assert.equal(clearResponse.status, 200);

    const emptyCartResponse = await client.request('/cart');
    assert.deepEqual(await emptyCartResponse.json(), {
        cartId: null,
        items: []
    });
});

test('serialisiert parallele identische Cart-Inserts auf genau eine Position', async () => {
    const client = new SessionClient();
    const csrfResponse = await client.request('/csrf-token');
    const csrfBody = await csrfResponse.json();
    client.csrfToken = csrfBody.csrfToken;
    const payload = JSON.stringify({
        productId: TEST_PRODUCT.id,
        rentalStart: futureDate(40),
        rentalEnd: futureDate(42)
    });

    const responses = await Promise.all([
        client.request('/cart/items', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: payload
        }),
        client.request('/cart/items', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: payload
        })
    ]);

    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);

    const cartResponse = await client.request('/cart');
    const cart = await cartResponse.json();
    assert.equal(cart.items.length, 1);

    const connection = await mysql.createConnection(dbConfig);
    try {
        const [activeCarts] = await connection.execute(
            `SELECT COUNT(*) AS count
             FROM rental_carts
             WHERE status = 'active' AND session_id IS NOT NULL AND user_email IS NULL`
        );
        assert.equal(Number(activeCarts[0].count), 1);
    } finally {
        await connection.end();
    }

    assert.equal((await client.request('/cart', { method: 'DELETE' })).status, 200);
});

test('Checkout-Lock verhindert Positionsverlust bei parallelem Cart-Add', async () => {
    const client = new SessionClient();
    try {
        const csrfResponse = await client.request('/csrf-token');
        client.csrfToken = (await csrfResponse.json()).csrfToken;
        const checkoutStart = futureDate(60);
        const checkoutEnd = futureDate(61);
        const laterStart = futureDate(65);
        const laterEnd = futureDate(66);

        const initialAdd = await client.request('/cart/items', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                productId: TEST_PRODUCT.id,
                rentalStart: checkoutStart,
                rentalEnd: checkoutEnd
            })
        });
        assert.equal(initialAdd.status, 201);

        const verificationToken = 'c'.repeat(64);
        const guestVerificationConnection = await mysql.createConnection(dbConfig);
        try {
            await guestVerificationConnection.execute(
                `INSERT INTO guest_verifications (email, verification_token, expires_at)
                 VALUES ('cart-lock-guest@example.com', ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
                [verificationToken]
            );
        } finally {
            await guestVerificationConnection.end();
        }

        const verificationResponse = await client.request('/verify-email/complete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: verificationToken })
        });
        assert.equal(verificationResponse.status, 200, await verificationResponse.text());

        const form = [{
            elements: [
                { name: 'CustomerEmail', value: 'cart-lock-guest@example.com' },
                { name: 'FirstName', value: 'Cart' },
                { name: 'LastName', value: 'Lock' },
                { name: 'CustomerCompany', value: '' },
                { name: 'CustomerPhone', value: '0123456789' },
                { name: 'CustomerAddress', value: 'Teststrasse 1' },
                { name: 'CustomerZip', value: '97070' },
                { name: 'CustomerCity', value: 'Wuerzburg' },
                { name: 'Signature', value: 'data:image/png;base64,dGVzdA==' },
                { name: 'agbs', checked: true },
                { name: 'dsgvo', checked: true }
            ]
        }];

        const lockConnection = await mysql.createConnection(dbConfig);
        let lockReleased = false;
        let orderPromise;
        let addPromise;

        try {
            await lockConnection.beginTransaction();
            await lockConnection.execute(
                'SELECT id FROM rental_products WHERE id = ? FOR UPDATE',
                [TEST_PRODUCT.id]
            );

            orderPromise = client.request('/data', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ form, paymentMethod: 'online' })
            });

            // Sobald diese Abfrage wartet, hält /data bereits den Cart-Lock.
            await waitForProductLockWait(lockConnection);

            let addSettled = false;
            addPromise = client.request('/cart/items', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    productId: TEST_PRODUCT.id,
                    rentalStart: laterStart,
                    rentalEnd: laterEnd
                })
            }).finally(() => {
                addSettled = true;
            });

            await delay(75);
            assert.equal(addSettled, false, 'Cart-Add darf den Checkout-Cart-Lock nicht umgehen.');

            await lockConnection.commit();
            lockReleased = true;

            const [orderResponse, addResponse] = await Promise.all([orderPromise, addPromise]);
            assert.equal(orderResponse.status, 200);
            const orderResult = await orderResponse.json();
            assert.ok(Number.isInteger(Number(orderResult.orderId)));
            const setCookies = typeof orderResponse.headers.getSetCookie === 'function'
                ? orderResponse.headers.getSetCookie()
                : [orderResponse.headers.get('set-cookie')].filter(Boolean);
            const accessCookie = setCookies.find(cookie => cookie.startsWith(`${ORDER_ACCESS_COOKIE}=`));
            assert.ok(accessCookie, 'Gastbestellung muss ein bestellspezifisches Access-Cookie setzen.');
            assert.match(accessCookie, /; HttpOnly/i);
            assert.match(accessCookie, new RegExp(`; Path=/orders/${orderResult.orderId}(?:;|$)`, 'i'));
            const durableAccessResponse = await fetch(
                `${BASE_URL}/orders/${orderResult.orderId}/payment-status`,
                { headers: { cookie: accessCookie.split(';', 1)[0] } }
            );
            assert.equal(durableAccessResponse.status, 200, await durableAccessResponse.text());
            assert.equal(addResponse.status, 201, await addResponse.text());
        } finally {
            if (!lockReleased) {
                await lockConnection.rollback();
                await Promise.allSettled([orderPromise, addPromise].filter(Boolean));
            }
            await lockConnection.end();
        }

        const cartResponse = await client.request('/cart');
        const cart = await cartResponse.json();
        assert.equal(cart.items.length, 1);
        assert.equal(cart.items[0].rentalStart, laterStart);
        assert.equal(cart.items[0].rentalEnd, laterEnd);

        const verificationConnection = await mysql.createConnection(dbConfig);
        try {
            const [orders] = await verificationConnection.execute(
                `SELECT id FROM rental_orders
                 WHERE customer_email = 'cart-lock-guest@example.com'
                 ORDER BY id DESC LIMIT 1`
            );
            assert.equal(orders.length, 1);
            const [orderedItems] = await verificationConnection.execute(
                `SELECT DATE_FORMAT(rental_start, '%Y-%m-%d') AS rentalStart,
                        DATE_FORMAT(rental_end, '%Y-%m-%d') AS rentalEnd
                 FROM rental_order_items WHERE order_id = ?`,
                [orders[0].id]
            );
            assert.equal(orderedItems.length, 1);
            assert.equal(orderedItems[0].rentalStart, checkoutStart);
            assert.equal(orderedItems[0].rentalEnd, checkoutEnd);
        } finally {
            await verificationConnection.end();
        }

    } finally {
        const cleanupResponse = await client.request('/cart', { method: 'DELETE' });
        assert.equal(cleanupResponse.status, 200, await cleanupResponse.text());
    }
});

test('deaktiviert Produkte statt Bestellhistorie und Referenzen hart zu löschen', async () => {
    const productId = 90;
    const connection = await mysql.createConnection(dbConfig);
    try {
        await connection.execute(
            `INSERT INTO rental_products
             (id, product_key, title, price_per_day, deposit, is_active)
             VALUES (?, 'SOFT-DELETE-TEST', 'Soft-Delete-Test', 10, 20, 1)`,
            [productId]
        );
    } finally {
        await connection.end();
    }

    const admin = new SessionClient();
    const loginResponse = await admin.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: TEST_ADMIN.email, password: TEST_ADMIN.password })
    });
    assert.equal(loginResponse.status, 200);

    const deleteResponse = await admin.request(`/products/${productId}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 200, await deleteResponse.text());
    assert.equal(
        (await admin.request(`/products/${productId}`, { method: 'DELETE' })).status,
        409
    );

    const verificationConnection = await mysql.createConnection(dbConfig);
    try {
        const [products] = await verificationConnection.execute(
            'SELECT is_active FROM rental_products WHERE id = ?',
            [productId]
        );
        assert.equal(products.length, 1);
        assert.equal(Number(products[0].is_active), 0);
    } finally {
        await verificationConnection.end();
    }
});

test('zählt Bestseller ausschließlich aus erfolgreichen Bestellungen', async () => {
    const productId = 91;
    const connection = await mysql.createConnection(dbConfig);

    try {
        await connection.execute(
            `INSERT INTO rental_products
             (id, product_key, title, price_per_day, deposit, is_active, times_ordered)
             VALUES (?, 'BESTSELLER-TEST', 'Bestseller-Test', 10, 20, 1, 999)`,
            [productId]
        );

        for (const [index, status] of ['reserved', 'payment_failed', 'confirmed'].entries()) {
            const [order] = await connection.execute(
                `INSERT INTO rental_orders (order_no, status, reserved_until, payment_status)
                 VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR), ?)`,
                [`R-BESTSELLER-${index}`, status, status === 'confirmed' ? 'paid' : 'pending']
            );
            await connection.execute(
                `INSERT INTO rental_order_items
                 (order_id, product_id, rental_start, rental_end, price_per_day, deposit, item_status)
                 VALUES (?, ?, '2098-01-01', '2098-01-02', 10, 20, 'active')`,
                [order.insertId, productId]
            );
        }
    } finally {
        await connection.end();
    }

    const response = await new SessionClient().request('/products/bestsellers');
    assert.equal(response.status, 200);
    const products = await response.json();
    const bestseller = products.find(product => product.id === productId);
    assert.ok(bestseller);
    assert.equal(Number(bestseller.times_ordered), 1);
});

test('erlaubt Gastzugriff nach Sessionverlust nur mit gültigem gehashtem Order-Cookie', async () => {
    const rawToken = 'a'.repeat(43);
    const connection = await mysql.createConnection(dbConfig);
    let orderId;

    try {
        const [order] = await connection.execute(
            `INSERT INTO rental_orders
             (order_no, customer_email, status, payment_method, payment_status,
              guest_access_token_hash, guest_access_token_expires_at)
             VALUES ('R-DURABLE-GUEST', 'durable-guest@example.com', 'confirmed', 'cash', 'pending',
                     ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
            [hashOrderAccessToken(rawToken)]
        );
        orderId = order.insertId;

        const [stored] = await connection.execute(
            'SELECT guest_access_token_hash FROM rental_orders WHERE id = ?',
            [orderId]
        );
        assert.notEqual(stored[0].guest_access_token_hash, rawToken);
        assert.equal(stored[0].guest_access_token_hash, hashOrderAccessToken(rawToken));
    } finally {
        await connection.end();
    }

    const validResponse = await fetch(`${BASE_URL}/orders/${orderId}/payment-status`, {
        headers: { cookie: `${ORDER_ACCESS_COOKIE}=${rawToken}` }
    });
    assert.equal(validResponse.status, 200, await validResponse.text());

    const invalidResponse = await fetch(`${BASE_URL}/orders/${orderId}/payment-status`, {
        headers: { cookie: `${ORDER_ACCESS_COOKIE}=ungueltig` }
    });
    assert.equal(invalidResponse.status, 403);
});

test('übernimmt den Gast-Warenkorb nach erfolgreichem Kundenlogin', async () => {
    const client = new SessionClient();
    const rentalStart = futureDate(20);
    const rentalEnd = futureDate(21);
    const existingStart = futureDate(24);
    const existingEnd = futureDate(25);

    const connection = await mysql.createConnection(dbConfig);
    try {
        const [existingCart] = await connection.execute(
            `INSERT INTO rental_carts (session_id, user_email, status)
             VALUES ('existing-user-cart', ?, 'active')`,
            [TEST_USER.email]
        );
        await connection.execute(
            `INSERT INTO rental_cart_items
             (cart_id, product_id, rental_start, rental_end, quantity)
             VALUES (?, ?, ?, ?, 1)`,
            [existingCart.insertId, TEST_PRODUCT.id, existingStart, existingEnd]
        );
    } finally {
        await connection.end();
    }

    const addResponse = await client.request('/cart/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            productId: TEST_PRODUCT.id,
            rentalStart,
            rentalEnd
        })
    });
    assert.equal(addResponse.status, 201);

    const guestCartResponse = await client.request('/cart');
    const guestCart = await guestCartResponse.json();
    assert.equal(guestCartResponse.status, 200, JSON.stringify(guestCart));
    assert.ok(Number.isInteger(Number(guestCart.cartId)));
    const guestCartId = Number(guestCart.cartId);

    const loginResponse = await client.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username: TEST_USER.email,
            password: TEST_USER.password
        })
    });

    assert.equal(loginResponse.status, 200);
    const loginResult = await loginResponse.json();
    assert.equal(loginResult.message, 'Login erfolgreich!');
    assert.equal(loginResult.redirectTo, '/index.html');
    assert.match(loginResult.csrfToken, /^[a-f0-9]{64}$/);

    const authResponse = await client.request('/auth-status');
    const authResult = await authResponse.json();
    assert.equal(authResult.loggedIn, true);
    assert.equal(authResult.user, TEST_USER.email);
    assert.equal(authResult.role, TEST_USER.role);
    assert.equal(authResult.csrfToken, loginResult.csrfToken);

    const cartResponse = await client.request('/cart');
    const cart = await cartResponse.json();
    assert.equal(cart.items.length, 2);
    assert.deepEqual(
        cart.items.map(item => item.rentalStart).sort(),
        [rentalStart, existingStart].sort()
    );

    const verificationConnection = await mysql.createConnection(dbConfig);
    try {
        const [userCarts] = await verificationConnection.execute(
            `SELECT COUNT(*) AS count
             FROM rental_carts WHERE status = 'active' AND user_email = ?`,
            [TEST_USER.email]
        );
        const [guestCarts] = await verificationConnection.execute(
            `SELECT COUNT(*) AS count
             FROM rental_carts WHERE id = ?`,
            [guestCartId]
        );
        assert.equal(Number(userCarts[0].count), 1);
        assert.equal(Number(guestCarts[0].count), 0);
    } finally {
        await verificationConnection.end();
    }
});

test('weist einen Monatsfilter ohne Jahr ab statt die Bestelltabelle voll zu scannen', async () => {
    const client = new SessionClient();
    const loginResponse = await client.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: TEST_USER.email, password: TEST_USER.password })
    });
    assert.equal(loginResponse.status, 200);

    const response = await client.request('/my-orders?month=01');
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
        error: 'Ein Filtermonat erfordert ein Filterjahr.'
    });
});

test('vergibt parallelen Registrierungen atomar eindeutige Kundennummern', async () => {
    const registration = index => new SessionClient().request('/register-customer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            firstName: 'Parallel',
            lastName: `Kunde${index}`,
            company: '',
            email: `parallel-customer-${index}@example.com`,
            phone: '0123456789',
            address: 'Teststrasse 1',
            zip: '97070',
            city: 'Wuerzburg',
            password: 'ParallelPassword1!'
        })
    });

    const responses = await Promise.all([registration(1), registration(2)]);
    assert.deepEqual(responses.map(response => response.status), [201, 201]);
    const results = await Promise.all(responses.map(response => response.json()));
    const customerNumbers = results.map(result => result.customerNo);

    assert.equal(new Set(customerNumbers).size, 2);
    customerNumbers.forEach(customerNo => assert.match(customerNo, /^K\d{9}$/));
});

test('bindet die Kontoaktivierung an einen neuen Passwortabschluss aus der Mailbox', async () => {
    const email = 'verification-recovery@example.com';
    const attackerPassword = 'AttackerPassword1!';
    const victimPassword = 'VictimRegistration1!';
    const completedPassword = 'VictimCompleted1!';
    const attackerRegistration = {
        firstName: 'Angreifer',
        lastName: 'Profil',
        company: '',
        email,
        phone: '0123456789',
        address: 'Teststrasse 2',
        zip: '97070',
        city: 'Wuerzburg',
        password: attackerPassword
    };
    const victimRegistration = {
        ...attackerRegistration,
        firstName: 'Opfer',
        lastName: 'Profil',
        address: 'Sicherer Weg 3',
        password: victimPassword
    };
    const firstClient = new SessionClient();
    const firstResponse = await firstClient.request('/register-customer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(attackerRegistration)
    });
    assert.equal(firstResponse.status, 201, await firstResponse.text());

    const connection = await mysql.createConnection(dbConfig);
    let originalToken;
    let originalUserId;
    let originalOutboxId;
    try {
        const [users] = await connection.execute(
            'SELECT id, verification_token FROM users WHERE username = ?',
            [email]
        );
        originalUserId = Number(users[0].id);
        originalToken = users[0].verification_token;
        const originalOperationKey = createOperationKey('mail-verify', {
            email,
            token: originalToken
        });
        const [effects] = await connection.execute(
            `SELECT id FROM external_effects_outbox
             WHERE operation_key = ?
             LIMIT 1`,
            [originalOperationKey]
        );
        originalOutboxId = effects[0].id;
        await connection.execute(
            `UPDATE external_effects_outbox
             SET status = 'dead', attempt_count = max_attempts, completed_at = NOW()
             WHERE id = ?`,
            [originalOutboxId]
        );
    } finally {
        await connection.end();
    }

    const resendClient = new SessionClient();
    const resendResponse = await resendClient.request('/register-customer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(victimRegistration)
    });
    const resendBody = await resendResponse.json();
    assert.equal(resendResponse.status, 202, JSON.stringify(resendBody));
    assert.match(resendBody.message, /neue Bestätigungsmail/i);

    const verificationConnection = await mysql.createConnection(dbConfig);
    let victimVerificationToken;
    try {
        const [users] = await verificationConnection.execute(
            `SELECT verification_token, first_name, last_name, address
             FROM users WHERE username = ?`,
            [email]
        );
        victimVerificationToken = users[0].verification_token;
        assert.equal(users[0].verification_token, originalToken);
        assert.deepEqual({
            firstName: users[0].first_name,
            lastName: users[0].last_name,
            address: users[0].address
        }, {
            firstName: attackerRegistration.firstName,
            lastName: attackerRegistration.lastName,
            address: attackerRegistration.address
        });
        const [effects] = await verificationConnection.execute(
            `SELECT COUNT(*) AS count
             FROM external_effects_outbox
             WHERE operation_key = ? OR operation_key LIKE ?`,
            [
                createOperationKey('mail-verify', { email, token: originalToken }),
                `mail-verify-resend-${originalUserId}-%`
            ]
        );
        assert.equal(Number(effects[0].count), 2);
    } finally {
        await verificationConnection.end();
    }

    const attackerRaceResponse = await new SessionClient().request('/register-customer', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '198.51.100.30'
        },
        body: JSON.stringify(attackerRegistration)
    });
    assert.equal(attackerRaceResponse.status, 202, await attackerRaceResponse.text());
    const raceConnection = await mysql.createConnection(dbConfig);
    try {
        const [users] = await raceConnection.execute(
            'SELECT verification_token FROM users WHERE username = ?',
            [email]
        );
        assert.equal(users[0].verification_token, victimVerificationToken);
    } finally {
        await raceConnection.end();
    }

    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
        const verificationResponse = await resendClient.request(
            `/verify-email?token=${victimVerificationToken}`,
            { redirect: 'manual' }
        );
        assert.equal(verificationResponse.status, 302);
        assert.equal(
            verificationResponse.headers.get('location'),
            `/verify-email.html#token=${victimVerificationToken}`
        );

        const stateConnection = await mysql.createConnection(dbConfig);
        try {
            const [users] = await stateConnection.execute(
                `SELECT email_verified, verification_token
                 FROM users WHERE username = ?`,
                [email]
            );
            assert.equal(Number(users[0].email_verified), 0);
            assert.equal(users[0].verification_token, victimVerificationToken);
        } finally {
            await stateConnection.end();
        }
    }

    const confirmationPage = await resendClient.request('/verify-email.html');
    assert.equal(confirmationPage.status, 200);
    assert.match(confirmationPage.headers.get('cache-control') || '', /no-store/i);
    assert.equal(confirmationPage.headers.get('referrer-policy'), 'no-referrer');

    const csrfRejected = await fetch(`${BASE_URL}/verify-email/complete`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: resendClient.cookie
        },
        body: JSON.stringify({ token: victimVerificationToken })
    });
    assert.equal(csrfRejected.status, 403, await csrfRejected.text());

    const completeVerification = await resendClient.request('/verify-email/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: victimVerificationToken })
    });
    const completeVerificationBody = await completeVerification.json();
    assert.equal(completeVerification.status, 200, JSON.stringify(completeVerificationBody));
    assert.match(
        completeVerificationBody.redirectTo,
        /^\/login\.html#resetToken=[a-f0-9]{64}&registrationComplete=1$/
    );
    const completionToken = new URLSearchParams(
        new URL(completeVerificationBody.redirectTo, BASE_URL).hash.slice(1)
    ).get('resetToken');

    const reusedVerification = await resendClient.request('/verify-email/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: victimVerificationToken })
    });
    assert.equal(reusedVerification.status, 409, await reusedVerification.text());

    for (const password of [attackerPassword, victimPassword]) {
        const loginResponse = await new SessionClient().request('/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: email, password })
        });
        assert.equal(loginResponse.status, 401, `${password}: ${await loginResponse.text()}`);
    }

    const completionResponse = await new SessionClient().request('/password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: completionToken, password: completedPassword })
    });
    assert.equal(completionResponse.status, 200, await completionResponse.text());

    const loginResponse = await new SessionClient().request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: email, password: completedPassword })
    });
    assert.equal(loginResponse.status, 200, await loginResponse.text());
});

test('Passwortwechsel widerruft alte Kunden- und Admin-Sessions über auth_version', async () => {
    async function assertSessionRevocation(account, nextPassword, protectedApi) {
        const changingClient = new SessionClient();
        const staleApiClient = new SessionClient();
        const staleHtmlClient = new SessionClient();

        try {
            for (const client of [changingClient, staleApiClient, staleHtmlClient]) {
                const loginResponse = await client.request('/login', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ username: account.email, password: account.password })
                });
                assert.equal(loginResponse.status, 200, await loginResponse.text());
            }

            const changeResponse = await changingClient.request('/my-profile/password', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    currentPassword: account.password,
                    newPassword: nextPassword,
                    newPasswordConfirm: nextPassword
                })
            });
            assert.equal(changeResponse.status, 200, await changeResponse.text());
            assert.equal((await changingClient.request('/my-profile')).status, 200);

            for (const assetPath of ['/css/style.css', '/img/logo.png']) {
                const publicAssetResponse = await staleApiClient.request(assetPath);
                assert.equal(publicAssetResponse.status, 200, await publicAssetResponse.text());
                assert.doesNotMatch(publicAssetResponse.headers.get('set-cookie') || '', /segnitz\.sid=;/i);
            }

            const staleApiResponse = await staleApiClient.request(protectedApi);
            assert.equal(staleApiResponse.status, 401, await staleApiResponse.text());
            const invalidationCookie = staleApiResponse.headers.get('set-cookie') || '';
            assert.match(invalidationCookie, /segnitz\.sid=;/i);
            assert.doesNotMatch(invalidationCookie, /Max-Age=1800/i);

            const staleHtmlResponse = await staleHtmlClient.request('/backend.html', {
                redirect: 'manual',
                headers: { accept: 'text/html' }
            });
            assert.equal(staleHtmlResponse.status, 302, await staleHtmlResponse.text());
            assert.match(staleHtmlResponse.headers.get('location'), /session_expired/);

            const oldPasswordResponse = await new SessionClient().request('/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: account.email, password: account.password })
            });
            assert.equal(oldPasswordResponse.status, 401, await oldPasswordResponse.text());

            const newPasswordResponse = await new SessionClient().request('/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: account.email, password: nextPassword })
            });
            assert.equal(newPasswordResponse.status, 200, await newPasswordResponse.text());
        } finally {
            const originalHash = await bcrypt.hash(account.password, 4);
            const connection = await mysql.createConnection(dbConfig);
            try {
                await connection.execute(
                    `UPDATE users
                     SET password = ?, auth_version = auth_version + 1
                     WHERE username = ?`,
                    [originalHash, account.email]
                );
            } finally {
                await connection.end();
            }
        }
    }

    await assertSessionRevocation(TEST_USER, 'ChangedCustomerPassword1!', '/my-profile');
    await assertSessionRevocation(TEST_ADMIN, 'ChangedAdminPassword1!', '/admin/orders');
});

test('Passwort-Reset-Token kann bei parallelen Requests nur einmal verbraucht werden', async () => {
    const token = 'a'.repeat(64);
    const staleClient = new SessionClient();
    const staleLogin = await staleClient.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: TEST_USER.email, password: TEST_USER.password })
    });
    assert.equal(staleLogin.status, 200, await staleLogin.text());
    const connection = await mysql.createConnection(dbConfig);
    try {
        await connection.execute(
            `UPDATE users
             SET reset_token = ?, reset_token_expires = DATE_ADD(NOW(), INTERVAL 30 MINUTE)
             WHERE username = ?`,
            [token, TEST_USER.email]
        );
    } finally {
        await connection.end();
    }

    const reset = (password, ip) => new SessionClient().request('/password-reset', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-forwarded-for': ip
        },
        body: JSON.stringify({ token, password })
    });
    try {
        const candidatePasswords = ['ConcurrentResetPassword1!', 'ConcurrentResetPassword2!'];
        const responses = await Promise.all([
            reset(candidatePasswords[0], '198.51.100.10'),
            reset(candidatePasswords[1], '198.51.100.11')
        ]);
        assert.deepEqual(
            responses.map(response => response.status).sort((a, b) => a - b),
            [200, 400]
        );

        const staleResponse = await staleClient.request('/my-profile');
        assert.equal(staleResponse.status, 401, await staleResponse.text());

        const loginStatuses = [];
        for (let index = 0; index < candidatePasswords.length; index += 1) {
            const response = await new SessionClient().request('/login', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-forwarded-for': `198.51.100.${20 + index}`
                },
                body: JSON.stringify({
                    username: TEST_USER.email,
                    password: candidatePasswords[index]
                })
            });
            loginStatuses.push(response.status);
        }
        assert.deepEqual(loginStatuses.sort((a, b) => a - b), [200, 401]);
    } finally {
        const originalHash = await bcrypt.hash(TEST_USER.password, 4);
        const restoreConnection = await mysql.createConnection(dbConfig);
        try {
            await restoreConnection.execute(
                `UPDATE users
                 SET password = ?, auth_version = auth_version + 1,
                     reset_token = NULL, reset_token_expires = NULL
                 WHERE username = ?`,
                [originalHash, TEST_USER.email]
            );
        } finally {
            await restoreConnection.end();
        }
    }
});

test('blockiert Bestell- und Artikelstornos für Kunden auch direkt an der API', async () => {
    const client = new SessionClient();
    const loginResponse = await client.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username: TEST_USER.email,
            password: TEST_USER.password
        })
    });

    assert.equal(loginResponse.status, 200);

    for (const pathname of ['/my-orders/1/cancel', '/my-orders/1/items/1/cancel']) {
        const response = await client.request(pathname, { method: 'POST' });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), {
            error: 'Stornierungen können nur durch einen Administrator durchgeführt werden.'
        });
    }
});

test('Logout entfernt das Session-Cookie ohne dessen Laufzeit erneut zu setzen', async () => {
    const client = new SessionClient();
    const loginResponse = await client.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username: TEST_USER.email,
            password: TEST_USER.password
        })
    });
    assert.equal(loginResponse.status, 200, await loginResponse.text());

    const logoutResponse = await client.request('/logout', { method: 'POST' });
    assert.equal(logoutResponse.status, 200, await logoutResponse.text());
    const clearCookie = logoutResponse.headers.get('set-cookie') || '';
    assert.match(clearCookie, /segnitz\.sid=;/i);
    assert.match(clearCookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i);
    assert.doesNotMatch(clearCookie, /Max-Age=1800/i);
});

test('behandelt unbekannte Verifikationstoken ohne Schemafehler', async () => {
    const client = new SessionClient();
    const response = await client.request(`/verify-email?token=${'b'.repeat(64)}`);

    assert.equal(response.status, 400);
    assert.match(await response.text(), /ungültig oder abgelaufen/i);
});
