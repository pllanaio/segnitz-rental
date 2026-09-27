'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { after, before, test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const path = require('node:path');
const {
    execute,
    queryRows,
    resetOrderLifecycleDatabase,
    TEST_ADMIN,
    TEST_CUSTOMER,
    TEST_OTHER_CUSTOMER,
    TEST_UNVERIFIED_CUSTOMER,
    TEST_PRODUCT
} = require('../support/order-lifecycle-database');

const PORT = Number(process.env.LIFECYCLE_TEST_PORT || 3103);
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

        if (this.cookie) {
            headers.set('cookie', this.cookie);
        }

        if (
            this.csrfToken &&
            !['GET', 'HEAD'].includes(method)
        ) {
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

function orderForm(email) {
    return [
        {
            name: 'customer',
            elements: [
                { name: 'CustomerEmail', value: email },
                { name: 'email', value: email },
                { name: 'FirstName', value: 'Lifecycle' },
                { name: 'LastName', value: 'Kunde' },
                { name: 'CustomerCompany', value: 'Lifecycle GmbH' },
                { name: 'CustomerPhone', value: '0123456789' },
                { name: 'CustomerAddress', value: 'Testweg 1' },
                { name: 'CustomerZip', value: '97070' },
                { name: 'CustomerCity', value: 'Wuerzburg' },
                { name: 'Signature', value: 'data:image/png;base64,dGVzdA==' },
                { name: 'agbs', value: 'on', checked: true },
                { name: 'dsgvo', value: 'on', checked: true }
            ]
        }
    ];
}

async function waitForServer() {
    let lastError;

    for (let attempt = 0; attempt < 80; attempt += 1) {
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

async function waitForDatabaseRow(query, params, predicate, description, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    let lastRow = null;

    while (Date.now() < deadline) {
        const rows = await queryRows(query, params);
        lastRow = rows[0] || null;
        if (lastRow && predicate(lastRow)) return lastRow;
        await delay(100);
    }

    throw new Error(
        `${description} wurde nicht rechtzeitig erreicht. Letzter Stand: ${JSON.stringify(lastRow)}`
    );
}

async function login(client, account) {
    await prepareCsrf(client);

    const response = await client.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username: account.email,
            password: account.password
        })
    });

    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);

    const result = JSON.parse(responseText);
    client.csrfToken = String(result.csrfToken || '');
}

async function prepareCsrf(client) {
    const csrfResponse = await client.request('/csrf-token');
    const csrfResult = await csrfResponse.json();
    assert.equal(csrfResponse.status, 200, JSON.stringify(csrfResult));
    client.csrfToken = String(csrfResult.csrfToken || '');
}

async function completeEmailVerification(client, token) {
    const inspectResponse = await client.request(
        `/verify-email?token=${token}`,
        { redirect: 'manual' }
    );
    assert.equal(inspectResponse.status, 302, await inspectResponse.text());
    assert.equal(
        inspectResponse.headers.get('location'),
        `/verify-email.html#token=${token}`
    );

    const completeResponse = await client.request('/verify-email/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token })
    });
    assert.equal(completeResponse.status, 200, await completeResponse.text());
}

async function addCartItem(client, rentalStart, rentalEnd) {
    const response = await client.request('/cart/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            productId: TEST_PRODUCT.id,
            rentalStart,
            rentalEnd
        })
    });

    assert.equal(response.status, 201, await response.text());
}

async function createOrder(client, paymentMethod, rentalStart, rentalEnd) {
    await addCartItem(client, rentalStart, rentalEnd);

    const response = await client.request('/data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            paymentMethod,
            form: orderForm(TEST_CUSTOMER.email)
        })
    });

    const body = await response.json();
    if (response.status === 202 && paymentMethod === 'online') {
        assert.equal(body.paymentPending, true);
        const payment = await waitForDatabaseRow(
            "SELECT checkout_url FROM rental_order_payments WHERE order_id = ? AND payment_type = 'initial_payment' ORDER BY id DESC LIMIT 1",
            [body.orderId], row => Boolean(row.checkout_url), 'asynchrone Checkout-Erstellung'
        );
        body.checkoutUrl = payment.checkout_url;
    } else assert.equal(response.status, 200, JSON.stringify(body));

    return body;
}

async function createTestCoupon(admin, code, percent, extra = {}) {
    const response = await admin.request('/admin/coupons', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, percent, active: true, validFrom: null, validUntil: null, ...extra }) });
    const result = await response.json(); assert.equal(response.status, 201, JSON.stringify(result)); return result.id;
}
async function previewTestCoupon(customer, code) {
    const response = await customer.request('/cart/coupon-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
}
async function submitCouponOrder(customer, quote, paymentMethod = 'cash') {
    return customer.request('/data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentMethod, form: orderForm(TEST_CUSTOMER.email), coupon: { code: quote.coupon.code, revision: quote.coupon.revision, totalCents: Math.round(quote.totals.grandTotalBeforeDepositReturn * 100) } }) });
}

async function signHandoverBeforePickup(admin, itemId) {
    const [item] = await queryRows('SELECT order_id FROM rental_order_items WHERE id = ?', [itemId]);
    const endpoint = `/admin/orders/${item.order_id}/handover`;
    const current = await (await admin.request(endpoint)).json();
    if (current.status === 'signed') return;
    const png = await require('sharp')(Buffer.from('<svg width="400" height="120"><rect width="400" height="120" fill="white"/><path d="M20 80 L80 30 L140 90 L220 35 L350 70" fill="none" stroke="black" stroke-width="5"/></svg>')).png().toBuffer();
    const form = new FormData();
    form.append('payload', JSON.stringify({ revision: current.revision, noDamage: true, entries: [], finalize: true, confirmed: true, signer: 'Testkunde (Testunterschrift)', signature: `data:image/png;base64,${png.toString('base64')}` }));
    const response = await admin.request(endpoint, { method: 'POST', body: form });
    assert.equal(response.status, 200, await response.text());
}

before(async () => {
    await resetOrderLifecycleDatabase();

    serverProcess = spawn(process.execPath, ['--require', './test/support/payment-race-preload.js', 'server.js'], {
        cwd: path.resolve(__dirname, '../..'),
        env: {
            ...process.env,
            PORT: String(PORT),
            BASE_URL,
            NODE_ENV: 'test',
            DISABLE_PERIODIC_CLEANUP: '1',
            // Leave mails pending for snapshot assertions. Empty credentials
            // guarantee that the real Graph transport cannot be called.
            DISABLE_EMAILS: '0',
            MS_TENANT_ID: '',
            MS_CLIENT_ID: '',
            MS_CLIENT_SECRET: '',
            GRAPH_MAIL_USER: '',
            MOLLIE_TEST_MODE: '1',
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

async function receiptMails(orderId) {
    const [order] = await queryRows('SELECT order_no FROM rental_orders WHERE id = ?', [orderId]);
    const rows = await queryRows(
        `SELECT payload_json FROM external_effects_outbox WHERE effect_type = 'mail.send'
         AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.message.receipt.orderNo')) = ? ORDER BY id`,
        [order.order_no]
    );
    return rows.map(row => (typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json).message);
}

test('schließt eine Bestellung mit Zahlung bei Abholung ab und persistiert Miete sowie Kaution', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);

    const rentalStart = futureDate(10);
    const rentalEnd = futureDate(12);
    const order = await createOrder(customer, 'cash', rentalStart, rentalEnd);

    assert.equal(order.message, 'Bestellung bestätigt. Miete und Kaution sind bei Abholung zu zahlen.');
    assert.ok(order.orderId > 0);
    assert.match(order.orderNo, /^R\d{9}$/);

    const [storedOrder] = await queryRows(
        `SELECT status, payment_method, payment_status, total_amount, reserved_until
         FROM rental_orders
         WHERE id = ?`,
        [order.orderId]
    );

    assert.equal(storedOrder.status, 'confirmed');
    assert.equal(storedOrder.payment_method, 'cash');
    assert.equal(storedOrder.payment_status, 'pending');
    assert.equal(Number(storedOrder.total_amount), 540);
    assert.equal(storedOrder.reserved_until, null);

    const payments = await queryRows(
        `SELECT payment_type, payment_method, payment_status, amount
         FROM rental_order_payments
         WHERE order_id = ?
         ORDER BY payment_type`,
        [order.orderId]
    );

    assert.deepEqual(
        payments.map(payment => ({
            type: payment.payment_type,
            method: payment.payment_method,
            status: payment.payment_status,
            amount: Number(payment.amount)
        })),
        [
            { type: 'deposit', method: 'cash', status: 'pending', amount: 300 },
            { type: 'rental', method: 'cash', status: 'pending', amount: 240 }
        ]
    );

    const activeCarts = await queryRows(
        `SELECT id FROM rental_carts WHERE user_email = ? AND status = 'active'`,
        [TEST_CUSTOMER.email]
    );
    assert.equal(activeCarts.length, 0);
});

test('filtert Kunden- und Adminbestellungen nach konkretem Jahr und Monat', async () => {
    const customer = new SessionClient();
    const admin = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    await login(admin, TEST_ADMIN);

    const januaryOrder = await createOrder(
        customer,
        'cash',
        futureDate(130),
        futureDate(131)
    );
    const novemberOrder = await createOrder(
        customer,
        'cash',
        futureDate(133),
        futureDate(134)
    );

    await execute(
        `UPDATE rental_orders
         SET created_at = CASE id
             WHEN ? THEN '2024-01-15 10:00:00'
             WHEN ? THEN '2025-11-20 10:00:00'
         END
         WHERE id IN (?, ?)`,
        [januaryOrder.orderId, novemberOrder.orderId, januaryOrder.orderId, novemberOrder.orderId]
    );

    const customerResponse = await customer.request('/my-orders?year=2024&month=01');
    assert.equal(
        customerResponse.status,
        200,
        `${await customerResponse.clone().text()}\n\nServerausgabe:\n${serverOutput}`
    );
    const customerResult = await customerResponse.json();

    assert.deepEqual(customerResult.items.map(order => order.id), [januaryOrder.orderId]);
    assert.ok(customerResult.filterOptions.years.includes('2024'));
    assert.ok(customerResult.filterOptions.years.includes('2025'));
    assert.ok(customerResult.filterOptions.months.includes('01'));
    assert.ok(customerResult.filterOptions.months.includes('11'));

    const adminResponse = await admin.request('/admin/orders?year=2025&month=11');
    assert.equal(
        adminResponse.status,
        200,
        `${await adminResponse.clone().text()}\n\nServerausgabe:\n${serverOutput}`
    );
    const adminResult = await adminResponse.json();

    assert.deepEqual(adminResult.items.map(order => order.id), [novemberOrder.orderId]);
    assert.ok(adminResult.filterOptions.years.includes('2024'));
    assert.ok(adminResult.filterOptions.years.includes('2025'));

    for (const invalidYear of ['0000', '9999']) {
        const invalidResponse = await admin.request(`/admin/orders?year=${invalidYear}`);
        const invalidBody = await invalidResponse.json();
        assert.equal(invalidResponse.status, 400, JSON.stringify(invalidBody));
        assert.deepEqual(invalidBody, { error: 'Ungültiges Filterjahr.' });
    }
});

test('blockiert sämtliche angemeldeten Mutationen ohne gültiges CSRF-Token', async () => {
    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);

    const validCsrfToken = admin.csrfToken;
    assert.match(validCsrfToken, /^[a-f0-9]{64}$/);

    admin.csrfToken = '';

    const protectedRequests = [
        ['/admin/orders/0/cancel', 'PUT'],
        ['/admin/opening-hours', 'PUT'],
        ['/admin/order-payments/manual', 'POST'],
        ['/admin/order-items/0/cancel', 'PUT'],
        ['/admin/order-items/0/return-images', 'POST'],
        ['/admin/order-items/0/return', 'PUT'],
        ['/admin/order-payments/0/retry-refund', 'POST'],
        ['/admin/order-payments/manual-refund', 'POST'],
        ['/orders/1/payment-status/sync', 'POST'],
        ['/logout', 'POST']
    ];

    for (const [pathname, method] of protectedRequests) {
        const response = await admin.request(pathname, { method });
        assert.equal(response.status, 403, `${method} ${pathname}: ${await response.text()}`);
    }

    admin.csrfToken = '0'.repeat(64);
    const invalidTokenResponse = await admin.request('/admin/order-items/0/return', {
        method: 'PUT'
    });
    assert.equal(invalidTokenResponse.status, 403, await invalidTokenResponse.text());

    admin.csrfToken = validCsrfToken;
});

test('validiert Öffnungszeiten vollständig, bevor eine Teilmenge gespeichert wird', async () => {
    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);

    const beforeRows = await queryRows(
        `SELECT weekday, is_open, TIME_FORMAT(open_time, '%H:%i') AS open_time,
                TIME_FORMAT(close_time, '%H:%i') AS close_time
         FROM opening_hours
         WHERE weekday IN (0, 1)
         ORDER BY weekday`
    );

    const response = await admin.request('/admin/opening-hours', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            openingHours: [
                { weekday: 0, is_open: true, open_time: '08:00', close_time: '17:00' },
                { weekday: 1, is_open: true, open_time: '18:00', close_time: '09:00' }
            ]
        })
    });
    assert.equal(response.status, 400, await response.text());

    const afterRows = await queryRows(
        `SELECT weekday, is_open, TIME_FORMAT(open_time, '%H:%i') AS open_time,
                TIME_FORMAT(close_time, '%H:%i') AS close_time
         FROM opening_hours
         WHERE weekday IN (0, 1)
         ORDER BY weekday`
    );
    assert.deepEqual(afterRows, beforeRows);
});

test('schützt Zahlungsstatus vor IDOR und trennt lesendes GET von der Synchronisierung', async () => {
    const customer = new SessionClient();
    const otherCustomer = new SessionClient();
    const anonymous = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    await login(otherCustomer, TEST_OTHER_CUSTOMER);
    await prepareCsrf(anonymous);

    const order = await createOrder(
        customer,
        'online',
        futureDate(200),
        futureDate(201)
    );
    const paidPaymentId = `tr_test_paid_idor_${order.orderId}`;

    await execute(
        'UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?',
        [paidPaymentId, order.orderId]
    );
    await execute(
        'UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?',
        [paidPaymentId, order.orderId]
    );

    const readOnlyResponse = await customer.request(`/orders/${order.orderId}/payment-status`);
    const readOnlyStatus = await readOnlyResponse.json();
    assert.equal(readOnlyResponse.status, 200, JSON.stringify(readOnlyStatus));
    assert.equal(readOnlyStatus.payment_status, 'pending');

    const [beforeUnauthorizedRequests] = await queryRows(
        'SELECT status, payment_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.deepEqual(beforeUnauthorizedRequests, {
        status: 'reserved',
        payment_status: 'pending'
    });

    for (const client of [otherCustomer, anonymous]) {
        const foreignGet = await client.request(`/orders/${order.orderId}/payment-status`);
        assert.equal(foreignGet.status, 403, await foreignGet.text());

        const foreignSync = await client.request(`/orders/${order.orderId}/payment-status/sync`, {
            method: 'POST'
        });
        assert.equal(foreignSync.status, 403, await foreignSync.text());
    }

    const [afterUnauthorizedRequests] = await queryRows(
        'SELECT status, payment_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.deepEqual(afterUnauthorizedRequests, beforeUnauthorizedRequests);

    const ownerSync = await customer.request(`/orders/${order.orderId}/payment-status/sync`, {
        method: 'POST'
    });
    assert.equal(ownerSync.status, 200, await ownerSync.text());

    const [afterOwnerSync] = await queryRows(
        'SELECT status, payment_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.deepEqual(afterOwnerSync, {
        status: 'confirmed',
        payment_status: 'paid'
    });
});

test('bindet Gastbestellungen dauerhaft an die erzeugende Session, auch nachdem der Cart gelöscht wurde', async () => {
    const guest = new SessionClient();
    const foreignGuest = new SessionClient();
    await prepareCsrf(guest);
    await prepareCsrf(foreignGuest);

    const rentalStart = futureDate(205);
    const rentalEnd = futureDate(206);
    await addCartItem(guest, rentalStart, rentalEnd);

    const submitOrder = () => guest.request('/data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            paymentMethod: 'online',
            form: orderForm('bound.guest@example.com')
        })
    });

    const unverifiedResponse = await submitOrder();
    const unverifiedBody = await unverifiedResponse.json();
    assert.equal(unverifiedResponse.status, 403, JSON.stringify(unverifiedBody));
    assert.equal(unverifiedBody.verificationRequired, true);

    const [challenge] = await queryRows(
        `SELECT verification_token
         FROM guest_verifications
         WHERE email = ?
         ORDER BY id DESC
         LIMIT 1`,
        ['bound.guest@example.com']
    );
    await completeEmailVerification(guest, challenge.verification_token);

    const createResponse = await submitOrder();
    const order = await createResponse.json();
    assert.equal(createResponse.status, 200, JSON.stringify(order));

    const paidPaymentId = `tr_test_paid_guest_binding_${order.orderId}`;
    await execute(
        'UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?',
        [paidPaymentId, order.orderId]
    );
    await execute(
        'UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?',
        [paidPaymentId, order.orderId]
    );

    const syncResponse = await guest.request(`/orders/${order.orderId}/payment-status/sync`, {
        method: 'POST'
    });
    assert.equal(syncResponse.status, 200, await syncResponse.text());

    const [storedOrder] = await queryRows(
        'SELECT cart_id, payment_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.equal(storedOrder.cart_id, null);
    assert.equal(storedOrder.payment_status, 'paid');

    const ownerGet = await guest.request(`/orders/${order.orderId}/payment-status`);
    assert.equal(ownerGet.status, 200, await ownerGet.text());

    const foreignGet = await foreignGuest.request(`/orders/${order.orderId}/payment-status`);
    assert.equal(foreignGet.status, 403, await foreignGet.text());

    await addCartItem(guest, futureDate(207), futureDate(208));
    const reusedVerification = await submitOrder();
    const reusedBody = await reusedVerification.json();
    assert.equal(reusedVerification.status, 403, JSON.stringify(reusedBody));
    assert.equal(reusedBody.verificationRequired, true);
});

test('bestätigt Gast-Barbestellungen einmalig und sessiongebunden mit kurzer TTL', async () => {
    const guest = new SessionClient();
    const guestEmail = 'cash.verification.guest@example.com';
    await prepareCsrf(guest);
    await addCartItem(guest, futureDate(210), futureDate(211));

    const submitCashOrder = () => guest.request('/data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            paymentMethod: 'cash',
            form: orderForm(guestEmail)
        })
    });

    const firstAttempt = await submitCashOrder();
    const firstResult = await firstAttempt.json();
    assert.equal(firstAttempt.status, 403, JSON.stringify(firstResult));
    assert.equal(firstResult.verificationRequired, true);
    assert.equal(firstResult.verificationEmailSent, true);

    const [firstChallenge] = await queryRows(
        `SELECT verification_token
         FROM guest_verifications
         WHERE email = ?
         ORDER BY id DESC
         LIMIT 1`,
        [guestEmail]
    );
    assert.match(firstChallenge.verification_token, /^[a-f0-9]{64}$/);

    await completeEmailVerification(guest, firstChallenge.verification_token);

    await execute(
        `UPDATE user_sessions
         SET data = JSON_SET(data, '$.verifiedGuestAt', 0)
         WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.verifiedGuestEmail')) = ?`,
        [guestEmail]
    );

    const expiredAttempt = await submitCashOrder();
    const expiredResult = await expiredAttempt.json();
    assert.equal(expiredAttempt.status, 403, JSON.stringify(expiredResult));
    assert.equal(expiredResult.verificationRequired, true);

    const [secondChallenge] = await queryRows(
        `SELECT verification_token
         FROM guest_verifications
         WHERE email = ?
         ORDER BY id DESC
         LIMIT 1`,
        [guestEmail]
    );
    await completeEmailVerification(guest, secondChallenge.verification_token);

    const confirmedAttempt = await submitCashOrder();
    const confirmedOrder = await confirmedAttempt.json();
    assert.equal(confirmedAttempt.status, 200, JSON.stringify(confirmedOrder));

    const [storedOrder] = await queryRows(
        'SELECT status, reserved_until FROM rental_orders WHERE id = ?',
        [confirmedOrder.orderId]
    );
    assert.equal(storedOrder.status, 'confirmed');
    assert.equal(storedOrder.reserved_until, null);

    await addCartItem(guest, futureDate(215), futureDate(216));
    const reuseAttempt = await submitCashOrder();
    const reuseResult = await reuseAttempt.json();
    assert.equal(reuseAttempt.status, 403, JSON.stringify(reuseResult));
    assert.equal(reuseResult.verificationRequired, true);
});

test('verarbeitet Online-Zahlung, Mollie-Webhook und vollständigen Storno-Refund idempotent', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);

    const order = await createOrder(
        customer,
        'online',
        futureDate(20),
        futureDate(21)
    );

    if (order.paymentPending) {
        assert.match(order.message, /Online-Zahlung wird vorbereitet/);
    } else {
        assert.match(order.checkoutUrl, /^https:\/\/checkout\.test\.mollie\.local\//);
    }
    const pendingOrder = await waitForDatabaseRow(
        `SELECT payment_method, payment_status, mollie_payment_id
         FROM rental_orders WHERE id = ?`,
        [order.orderId], row => Boolean(row.mollie_payment_id), 'Online-Zahlung vorbereitet'
    );

    assert.equal(pendingOrder.payment_method, 'online');
    assert.equal(pendingOrder.payment_status, 'pending');
    assert.match(pendingOrder.mollie_payment_id, /^tr_test_open_/);

    const paidPaymentId = `tr_test_paid_order_${order.orderId}`;
    await execute(
        `UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?`,
        [paidPaymentId, order.orderId]
    );
    await execute(
        `UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?`,
        [paidPaymentId, order.orderId]
    );
    const pendingRefundResult = await execute(
        `INSERT INTO rental_order_payments
         (order_id, payment_type, payment_method, payment_status, amount, mollie_payment_id, note)
         VALUES (?, 'duplicate_payment_refund', 'online', 'pending', -1, ?,
                 'Regression: Refund-Ledger darf nicht als Source-Zahlung aktualisiert werden')`,
        [order.orderId, paidPaymentId]
    );

    try {
        const webhookResponse = await customer.request('/webhooks/mollie', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: paidPaymentId })
        });
        assert.equal(webhookResponse.status, 200);

        const duplicateWebhookResponse = await customer.request('/webhooks/mollie', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: paidPaymentId })
        });
        assert.equal(duplicateWebhookResponse.status, 200);

        const sourceAndRefundLedger = await queryRows(
            `SELECT id, payment_type, payment_status
             FROM rental_order_payments
             WHERE order_id = ? AND mollie_payment_id = ?
             ORDER BY id`,
            [order.orderId, paidPaymentId]
        );
        assert.deepEqual(
            sourceAndRefundLedger
                .filter(row => ['initial_payment', 'rental', 'deposit'].includes(row.payment_type))
                .map(row => ({ type: row.payment_type, status: row.payment_status }))
                .sort((left, right) => left.type.localeCompare(right.type)),
            [
                { type: 'deposit', status: 'paid' },
                { type: 'initial_payment', status: 'paid' },
                { type: 'rental', status: 'paid' }
            ]
        );
        assert.deepEqual(
            sourceAndRefundLedger.find(row => Number(row.id) === Number(pendingRefundResult.insertId)),
            {
                id: pendingRefundResult.insertId,
                payment_type: 'duplicate_payment_refund',
                payment_status: 'pending'
            }
        );
    } finally {
        await execute(
            'DELETE FROM rental_order_payments WHERE id = ?',
            [pendingRefundResult.insertId]
        );
    }

    const [paidOrder] = await queryRows(
        `SELECT status, payment_status, mollie_payment_status, mollie_payment_method
         FROM rental_orders WHERE id = ?`,
        [order.orderId]
    );
    assert.deepEqual(paidOrder, {
        status: 'confirmed',
        payment_status: 'paid',
        mollie_payment_status: 'paid',
        mollie_payment_method: 'ideal'
    });

    const [eventCount] = await queryRows(
        `SELECT COUNT(*) AS count FROM mollie_webhook_events WHERE mollie_payment_id = ?`,
        [paidPaymentId]
    );
    assert.equal(Number(eventCount.count), 1);

    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);

    const cancelResponse = await admin.request(`/admin/orders/${order.orderId}/cancel`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
    });
    assert.equal(cancelResponse.status, 200, await cancelResponse.text());

    const [cancelledOrder] = await queryRows(
        `SELECT status FROM rental_orders WHERE id = ?`,
        [order.orderId]
    );
    assert.equal(cancelledOrder.status, 'cancelled');

    const refund = await waitForDatabaseRow(
        `SELECT payment_status, amount, mollie_payment_id, mollie_refund_id
         FROM rental_order_payments
         WHERE order_id = ? AND payment_type = 'order_cancellation_refund'`,
        [order.orderId],
        row => row.payment_status === 'paid' && Boolean(row.mollie_refund_id),
        'Online-Stornoerstattung'
    );

    assert.equal(refund.payment_status, 'paid');
    assert.equal(Number(refund.amount), -460);
    assert.equal(refund.mollie_payment_id, paidPaymentId);
    assert.match(refund.mollie_refund_id, /^re_test_paid_/);
});

test('Recheckout reaktiviert kein zwischenzeitlich deaktiviertes Produkt', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const order = await createOrder(
        customer,
        'online',
        futureDate(217),
        futureDate(218)
    );

    await execute(
        `UPDATE rental_orders
         SET status = 'expired', payment_status = 'expired'
         WHERE id = ?`,
        [order.orderId]
    );
    await execute(
        `UPDATE rental_order_items
         SET item_status = 'expired'
         WHERE order_id = ?`,
        [order.orderId]
    );
    await execute(
        'UPDATE rental_products SET is_active = 0 WHERE id = ?',
        [TEST_PRODUCT.id]
    );

    try {
        const response = await customer.request(`/orders/${order.orderId}/mollie-checkout`, {
            method: 'POST'
        });
        const responseBody = await response.json();
        assert.equal(response.status, 409, JSON.stringify(responseBody));
        assert.deepEqual(responseBody, {
            error: 'Mindestens ein Produkt dieser Bestellung ist nicht mehr aktiv.'
        });

        const [storedOrder] = await queryRows(
            'SELECT status, payment_status FROM rental_orders WHERE id = ?',
            [order.orderId]
        );
        assert.deepEqual(storedOrder, {
            status: 'expired',
            payment_status: 'expired'
        });
    } finally {
        await execute(
            'UPDATE rental_products SET is_active = 1 WHERE id = ?',
            [TEST_PRODUCT.id]
        );
    }
});

test('kassiert Zahlung vor Ort, blockiert vorzeitige Abholung und verarbeitet Rückgabe mit Kautionsauszahlung', async t => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);

    const rentalStart = futureDate(30);
    const rentalEnd = futureDate(31);
    const order = await createOrder(customer, 'cash', rentalStart, rentalEnd);

    const initialMails = await receiptMails(order.orderId);
    assert.equal(initialMails.filter(mail => mail.receipt.kind === 'order').length, 1);
    assert.equal(initialMails[0].receipt.signature, 'data:image/png;base64,dGVzdA==');

    const [item] = await queryRows(
        `SELECT id FROM rental_order_items WHERE order_id = ? LIMIT 1`,
        [order.orderId]
    );

    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);

    const blockedPickup = await admin.request(`/admin/order-items/${item.id}/pickup`, {
        method: 'PUT'
    });
    assert.equal(blockedPickup.status, 409);

    const paymentResponse = await admin.request('/admin/order-payments/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            paymentType: 'initial_payment',
            amount: 460,
            note: 'Automatischer CI-Zahlung vor Ortstest'
        })
    });
    assert.equal(paymentResponse.status, 200, await paymentResponse.text());

    await signHandoverBeforePickup(admin, item.id);
    const pickupResponse = await admin.request(`/admin/order-items/${item.id}/pickup`, {
        method: 'PUT'
    });
    assert.equal(pickupResponse.status, 200, await pickupResponse.text());

    const photoForm = new FormData();
    const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64');
    photoForm.append('images', new Blob([imageBytes], { type: 'image/png' }), 'behalten.png');
    photoForm.append('images', new Blob([imageBytes], { type: 'image/png' }), 'entfernen.png');
    const photoUpload = await admin.request(`/admin/order-items/${item.id}/return-images`, { method: 'POST', body: photoForm });
    assert.equal(photoUpload.status, 200);
    const uploaded = (await photoUpload.json()).images;
    assert.equal(uploaded.length, 2);
    const { RETURN_IMAGE_DIRECTORY } = require('../../utils/uploads');
    t.after(async () => {
        for (const image of uploaded) await require('node:fs/promises').rm(path.join(RETURN_IMAGE_DIRECTORY, path.basename(image.imagePath)), { force: true });
    });
    const removedPhoto = await admin.request(`/admin/return-images/${uploaded[1].id}`, { method: 'DELETE' });
    assert.equal(removedPhoto.status, 200, await removedPhoto.text());

    const returnResponse = await admin.request(`/admin/order-items/${item.id}/return`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            actualReturnDate: rentalEnd,
            additionalChargePaymentMethod: 'cash',
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: rentalEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay,
            returnStatus: 'returned_ok',
            isDamaged: false,
            damageDescription: '',
            isLate: false,
            lateDescription: '',
            depositDecision: 'full_refund',
            depositDeductionPercent: 0,
            depositDeductionReason: '',
            additionalChargeReason: '',
            additionalChargeAmount: 0,
            returnNotes: 'Automatische unbeschädigte Rückgabe'
        })
    });
    assert.equal(returnResponse.status, 200, await returnResponse.text());
    const protectedPhoto = await admin.request(`/admin/return-images/${uploaded[0].id}`, { method: 'DELETE' });
    assert.equal(protectedPhoto.status, 409);

    const [returnedOrder] = await queryRows(
        `SELECT status, return_status, return_case_status, payment_status,
                return_processed_by_user_id
         FROM rental_orders WHERE id = ?`,
        [order.orderId]
    );
    assert.equal(returnedOrder.status, 'returned');
    assert.equal(returnedOrder.return_status, 'returned_ok');
    assert.equal(returnedOrder.return_case_status, 'refund_pending');
    assert.equal(returnedOrder.payment_status, 'paid');
    assert.ok(returnedOrder.return_processed_by_user_id > 0);

    const [returnedItem] = await queryRows(
        `SELECT item_status, return_status, deposit_decision,
                deposit_deduction_amount, deposit_refund_amount
         FROM rental_order_items WHERE id = ?`,
        [item.id]
    );
    assert.equal(returnedItem.item_status, 'returned_ok');
    assert.equal(returnedItem.return_status, 'returned_ok');
    assert.equal(returnedItem.deposit_decision, 'full_refund');
    assert.equal(Number(returnedItem.deposit_deduction_amount), 0);
    assert.equal(Number(returnedItem.deposit_refund_amount), 300);

    const [depositRefund] = await queryRows(
        `SELECT payment_method, payment_status, amount
         FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ? AND payment_type = 'deposit_refund'`,
        [order.orderId, item.id]
    );
    assert.deepEqual(
        {
            method: depositRefund.payment_method,
            status: depositRefund.payment_status,
            amount: Number(depositRefund.amount)
        },
        { method: 'cash', status: 'pending', amount: -300 }
    );

    const beforeRefundMails = await receiptMails(order.orderId);
    assert.equal(beforeRefundMails.filter(mail => mail.receipt.kind === 'return').length, 1);
    const returnPhotos = beforeRefundMails.find(mail => mail.receipt.kind === 'return').receipt.photos;
    assert.deepEqual(returnPhotos.map(photo => photo.id), [uploaded[0].id]);
    assert.ok(Buffer.from(returnPhotos[0].contentBase64, 'base64').length > 0);
    assert.equal(beforeRefundMails.filter(mail => mail.receipt.kind === 'completed').length, 0);
    assert.doesNotMatch(JSON.stringify(beforeRefundMails), /Automatische unbeschädigte Rückgabe/);

    const settleRefund = await admin.request('/admin/order-payments/manual-refund', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            orderItemId: item.id,
            paymentType: 'deposit_refund',
            amount: 300,
            note: 'Kaution im CI-Test bar ausgezahlt'
        })
    });
    assert.equal(settleRefund.status, 200, await settleRefund.text());

    const [closedOrder] = await queryRows(
        `SELECT return_case_status FROM rental_orders WHERE id = ?`,
        [order.orderId]
    );
    assert.equal(closedOrder.return_case_status, 'closed');
    const completedMails = (await receiptMails(order.orderId)).filter(mail => mail.receipt.kind === 'completed');
    assert.equal(completedMails.length, 1);
    assert.equal(completedMails[0].receipt.payments.find(p => p.type === 'deposit_refund').status, 'paid');
    assert.equal((await receiptMails(order.orderId)).find(mail => mail.receipt.kind === 'return').receipt.payments.find(p => p.type === 'deposit_refund').status, 'pending');
});

test('validiert Schäden und nutzt für Rückgabe-Nachzahlungen den gewählten Mollie-Zahlungslink', async () => {
    const customer = new SessionClient();
    const admin = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    await login(admin, TEST_ADMIN);

    const rentalStart = futureDate(34);
    const rentalEnd = futureDate(35);
    const order = await createOrder(customer, 'cash', rentalStart, rentalEnd);
    const [item] = await queryRows(
        'SELECT id FROM rental_order_items WHERE order_id = ? LIMIT 1',
        [order.orderId]
    );

    const payment = await admin.request('/admin/order-payments/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            paymentType: 'initial_payment',
            amount: 460
        })
    });
    assert.equal(payment.status, 200, await payment.text());

    await signHandoverBeforePickup(admin, item.id);
    const pickup = await admin.request(`/admin/order-items/${item.id}/pickup`, {
        method: 'PUT'
    });
    assert.equal(pickup.status, 200, await pickup.text());

    const invalidReturn = await admin.request(`/admin/order-items/${item.id}/return`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            actualReturnDate: rentalEnd,
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: rentalEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay,
            isDamaged: true,
            damageDescription: '',
            additionalChargeReason: 'Reparatur nach Rückgabe',
            additionalChargeAmount: 400,
            additionalChargePaymentMethod: 'online'
        })
    });
    assert.equal(invalidReturn.status, 400, await invalidReturn.text());

    const invalidReasonReturn = await admin.request(`/admin/order-items/${item.id}/return`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            actualReturnDate: rentalEnd,
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: rentalEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay,
            isDamaged: true,
            damageDescription: 'Hydraulikleitung gerissen',
            additionalChargeReason: '',
            additionalChargeAmount: 400,
            additionalChargePaymentMethod: 'online'
        })
    });
    assert.equal(invalidReasonReturn.status, 400, await invalidReasonReturn.text());

    const invalidPaymentMethodReturn = await admin.request(`/admin/order-items/${item.id}/return`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            actualReturnDate: rentalEnd,
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: rentalEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay,
            isDamaged: true,
            damageDescription: 'Hydraulikleitung gerissen',
            additionalChargeReason: 'Reparatur der Hydraulikleitung',
            additionalChargeAmount: 400,
            additionalChargePaymentMethod: 'invoice'
        })
    });
    assert.equal(
        invalidPaymentMethodReturn.status,
        400,
        await invalidPaymentMethodReturn.text()
    );

    const [unchangedItem] = await queryRows(
        'SELECT item_status FROM rental_order_items WHERE id = ?',
        [item.id]
    );
    assert.equal(unchangedItem.item_status, 'picked_up');

    const returnResponse = await admin.request(`/admin/order-items/${item.id}/return`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            actualReturnDate: rentalEnd,
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: rentalEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay,
            isDamaged: true,
            damageDescription: 'Hydraulikleitung gerissen',
            additionalChargeReason: 'Reparatur der Hydraulikleitung',
            additionalChargeAmount: 400,
            additionalChargePaymentMethod: 'online',
            returnNotes: 'Nachforderung per Mollie-Link'
        })
    });
    assert.equal(returnResponse.status, 200, await returnResponse.text());

    const [returnCharge] = await queryRows(
        `SELECT id, payment_method, payment_status, amount, mollie_payment_id, checkout_url
         FROM rental_order_payments
         WHERE order_id = ?
         AND order_item_id = ?
         AND payment_type = 'return_additional_charge'`,
        [order.orderId, item.id]
    );
    assert.equal(returnCharge.payment_method, 'online');
    assert.equal(returnCharge.payment_status, 'pending');
    assert.equal(Number(returnCharge.amount), 100);
    assert.match(returnCharge.mollie_payment_id, /^tr_test_open_/);
    assert.match(returnCharge.checkout_url, /^https:\/\/checkout\.test\.mollie\.local\//);

    const customerDetailResponse = await customer.request(`/my-orders/${order.orderId}`);
    const customerDetail = await customerDetailResponse.json();
    assert.equal(customerDetailResponse.status, 200, JSON.stringify(customerDetail));
    const customerReturnCharge = customerDetail.payments.find(
        paymentRow => paymentRow.paymentType === 'return_additional_charge'
    );
    assert.equal(customerReturnCharge.checkoutUrl, returnCharge.checkout_url);

    const adminDetailResponse = await admin.request(`/admin/orders/${order.orderId}`);
    const adminDetail = await adminDetailResponse.json();
    assert.equal(adminDetailResponse.status, 200, JSON.stringify(adminDetail));
    const adminReturnCharge = adminDetail.payments.find(
        paymentRow => paymentRow.paymentType === 'return_additional_charge'
    );
    assert.equal(adminReturnCharge.checkoutUrl, returnCharge.checkout_url);

    const [pendingOrder] = await queryRows(
        `SELECT status, return_status, return_case_status
         FROM rental_orders WHERE id = ?`,
        [order.orderId]
    );
    assert.deepEqual(pendingOrder, {
        status: 'returned',
        return_status: 'returned_damaged',
        return_case_status: 'payment_pending'
    });

    const paidReturnChargeId = `tr_test_paid_return_charge_${order.orderId}`;
    await execute(
        'UPDATE rental_order_payments SET mollie_payment_id = ? WHERE id = ?',
        [paidReturnChargeId, returnCharge.id]
    );
    const webhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: paidReturnChargeId })
    });
    assert.equal(webhook.status, 200, await webhook.text());

    const [settledOrder] = await queryRows(
        'SELECT return_case_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.equal(settledOrder.return_case_status, 'closed');
});

test('erfasst eine ausdrücklich bar gewählte Rückgabe-Nachzahlung auch bei Onlineauftrag bar', async () => {
    const customer = new SessionClient();
    const admin = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    await login(admin, TEST_ADMIN);

    const rentalStart = futureDate(42);
    const rentalEnd = futureDate(43);
    const order = await createOrder(customer, 'online', rentalStart, rentalEnd);
    const [item] = await queryRows(
        'SELECT id FROM rental_order_items WHERE order_id = ? LIMIT 1',
        [order.orderId]
    );
    const paidInitialId = `tr_test_paid_cash_return_${order.orderId}`;
    await execute(
        'UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?',
        [paidInitialId, order.orderId]
    );
    await execute(
        'UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?',
        [paidInitialId, order.orderId]
    );
    const paidWebhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: paidInitialId })
    });
    assert.equal(paidWebhook.status, 200, await paidWebhook.text());

    await signHandoverBeforePickup(admin, item.id);
    const pickup = await admin.request(`/admin/order-items/${item.id}/pickup`, {
        method: 'PUT'
    });
    assert.equal(pickup.status, 200, await pickup.text());

    const returnResponse = await admin.request(`/admin/order-items/${item.id}/return`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            actualReturnDate: rentalEnd,
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: rentalEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay,
            isDamaged: true,
            damageDescription: 'Gehäuse beschädigt',
            additionalChargeReason: 'Gehäusereparatur',
            additionalChargeAmount: 400,
            additionalChargePaymentMethod: 'cash'
        })
    });
    assert.equal(returnResponse.status, 200, await returnResponse.text());

    const [charge] = await queryRows(
        `SELECT payment_method, payment_status, amount
         FROM rental_order_payments
         WHERE order_id = ?
         AND order_item_id = ?
         AND payment_type = 'return_additional_charge'`,
        [order.orderId, item.id]
    );
    assert.deepEqual(
        {
            method: charge.payment_method,
            status: charge.payment_status,
            amount: Number(charge.amount)
        },
        { method: 'cash', status: 'pending', amount: 100 }
    );

    const settleCharge = await admin.request('/admin/order-payments/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            orderItemId: item.id,
            paymentType: 'return_additional_charge',
            amount: 100
        })
    });
    assert.equal(settleCharge.status, 200, await settleCharge.text());

    const [closedOrder] = await queryRows(
        'SELECT return_case_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.equal(closedOrder.return_case_status, 'closed');
});

test('schließt einen gemischten Auftrag nach letzter Stornierung und wartet auf beide Auszahlung vor Orten', async () => {
    const customer = new SessionClient();
    const admin = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    await login(admin, TEST_ADMIN);

    const firstStart = futureDate(36);
    const firstEnd = futureDate(37);
    const secondStart = futureDate(38);
    const secondEnd = futureDate(39);

    await addCartItem(customer, firstStart, firstEnd);
    await addCartItem(customer, secondStart, secondEnd);
    const orderResponse = await customer.request('/data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            paymentMethod: 'cash',
            form: orderForm(TEST_CUSTOMER.email)
        })
    });
    const order = await orderResponse.json();
    assert.equal(orderResponse.status, 200, JSON.stringify(order));

    const items = await queryRows(
        'SELECT id FROM rental_order_items WHERE order_id = ? ORDER BY id ASC',
        [order.orderId]
    );
    assert.equal(items.length, 2);

    const payment = await admin.request('/admin/order-payments/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            paymentType: 'initial_payment',
            amount: 920
        })
    });
    assert.equal(payment.status, 200, await payment.text());

    await signHandoverBeforePickup(admin, items[0].id);
    const pickup = await admin.request(`/admin/order-items/${items[0].id}/pickup`, {
        method: 'PUT'
    });
    assert.equal(pickup.status, 200, await pickup.text());

    const firstReturn = await admin.request(`/admin/order-items/${items[0].id}/return`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            actualReturnDate: firstEnd,
            adjustedRentalStart: firstStart,
            adjustedRentalEnd: firstEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay,
            isDamaged: false,
            additionalChargeAmount: 0,
            additionalChargePaymentMethod: 'cash'
        })
    });
    assert.equal(firstReturn.status, 200, await firstReturn.text());

    const cancelSecond = await admin.request(`/admin/order-items/${items[1].id}/cancel`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
    });
    assert.equal(cancelSecond.status, 200, await cancelSecond.text());

    const [mixedOrder] = await queryRows(
        `SELECT status, return_status, return_case_status
         FROM rental_orders WHERE id = ?`,
        [order.orderId]
    );
    assert.deepEqual(mixedOrder, {
        status: 'returned',
        return_status: 'returned_ok',
        return_case_status: 'refund_pending'
    });

    const refunds = await queryRows(
        `SELECT order_item_id, payment_type, payment_status, amount
         FROM rental_order_payments
         WHERE order_id = ?
         AND payment_type IN ('deposit_refund', 'order_cancellation_refund')
         ORDER BY payment_type`,
        [order.orderId]
    );
    assert.deepEqual(
        refunds.map(refund => ({
            itemId: refund.order_item_id,
            type: refund.payment_type,
            status: refund.payment_status,
            amount: Number(refund.amount)
        })),
        [
            {
                itemId: items[0].id,
                type: 'deposit_refund',
                status: 'pending',
                amount: -300
            },
            {
                itemId: items[1].id,
                type: 'order_cancellation_refund',
                status: 'pending',
                amount: -460
            }
        ]
    );

    for (const refund of refunds) {
        const settle = await admin.request('/admin/order-payments/manual-refund', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                orderId: order.orderId,
                orderItemId: refund.order_item_id,
                paymentType: refund.payment_type,
                amount: Math.abs(Number(refund.amount))
            })
        });
        assert.equal(settle.status, 200, await settle.text());
    }

    const [closedOrder] = await queryRows(
        'SELECT return_case_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.equal(closedOrder.return_case_status, 'closed');
});

test('storniert eine offene Online-Miete, blockiert ihre Abholung und erstattet eine verspätet eingegangene Zahlung ohne Status-Reaktivierung', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);

    const order = await createOrder(customer, 'online', futureDate(40), futureDate(41));
    const [item] = await queryRows(
        'SELECT id FROM rental_order_items WHERE order_id = ? LIMIT 1',
        [order.orderId]
    );
    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);

    const blockedPickup = await admin.request(`/admin/order-items/${item.id}/pickup`, {
        method: 'PUT'
    });
    assert.equal(blockedPickup.status, 409);

    const cancelResponse = await admin.request(`/admin/orders/${order.orderId}/cancel`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Automatischer Test eines offenen Online-Stornos' })
    });
    assert.equal(cancelResponse.status, 200, await cancelResponse.text());

    const [cancelledBeforePayment] = await queryRows(
        'SELECT status, payment_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.deepEqual(cancelledBeforePayment, {
        status: 'cancelled',
        payment_status: 'cancelled'
    });

    const latePaidPaymentId = `tr_test_paid_late_${order.orderId}`;
    await execute('UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?', [latePaidPaymentId, order.orderId]);
    await execute('UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?', [latePaidPaymentId, order.orderId]);

    const webhookResponse = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: latePaidPaymentId })
    });
    assert.equal(webhookResponse.status, 200, await webhookResponse.text());

    const cancelledAfterPayment = await waitForDatabaseRow(
        'SELECT status, payment_status FROM rental_orders WHERE id = ?',
        [order.orderId],
        row => row.status === 'cancelled' && row.payment_status === 'refunded',
        'Abschluss der verspäteten Storno-Erstattung'
    );
    assert.deepEqual(cancelledAfterPayment, {
        status: 'cancelled',
        payment_status: 'refunded'
    });

    const [lateRefund] = await queryRows(
        `SELECT payment_status, amount
         FROM rental_order_payments
         WHERE order_id = ? AND payment_type = 'order_cancellation_refund'`,
        [order.orderId]
    );
    assert.equal(lateRefund.payment_status, 'paid');
    assert.equal(Number(lateRefund.amount), -460);

    const publicStatusResponse = await customer.request(`/orders/${order.orderId}/payment-status`);
    const publicStatus = await publicStatusResponse.json();
    assert.equal(publicStatusResponse.status, 200);
    assert.equal(publicStatus.status, 'cancelled');
    assert.equal(publicStatus.payment_status, 'refunded');
    assert.equal(Object.hasOwn(publicStatus, 'customer_email'), false);
    assert.equal(Object.hasOwn(publicStatus, 'confirmation_json'), false);
});

test('verlängert eine bezahlte Bar-Miete atomar und verrechnet offene Verlängerung, Schaden und Kaution bei der Rückgabe', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const rentalStart = futureDate(50);
    const rentalEnd = futureDate(51);
    const extendedEnd = futureDate(53);
    const order = await createOrder(customer, 'cash', rentalStart, rentalEnd);
    const [item] = await queryRows('SELECT id FROM rental_order_items WHERE order_id = ? LIMIT 1', [order.orderId]);

    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);

    const cashPayment = await admin.request('/admin/order-payments/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            paymentType: 'initial_payment',
            amount: 460
        })
    });
    assert.equal(cashPayment.status, 200, await cashPayment.text());

    await signHandoverBeforePickup(admin, item.id);
    const pickup = await admin.request(`/admin/order-items/${item.id}/pickup`, { method: 'PUT' });
    assert.equal(pickup.status, 200, await pickup.text());

    const extension = await admin.request(`/admin/order-items/${item.id}/rental-adjustment`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: extendedEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay
        })
    });
    assert.equal(extension.status, 200, await extension.text());
    const extensionMails = (await receiptMails(order.orderId)).filter(mail => mail.receipt.kind === 'extension');
    assert.equal(extensionMails.length, 1);
    assert.equal(extensionMails[0].receipt.items[0].end, extendedEnd);
    assert.equal(extensionMails[0].receipt.items[0].originalEnd, rentalEnd);
    assert.equal(extensionMails[0].receipt.payments.find(p => p.type === 'rental_adjustment').status, 'pending');

    const conflictingExtension = await admin.request(`/admin/order-items/${item.id}/rental-adjustment`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: futureDate(54),
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay
        })
    });
    assert.equal(conflictingExtension.status, 409);

    const [unchangedItem] = await queryRows(
        `SELECT DATE_FORMAT(adjusted_rental_end, '%Y-%m-%d') AS adjustedEnd
         FROM rental_order_items WHERE id = ?`,
        [item.id]
    );
    assert.equal(unchangedItem.adjustedEnd, extendedEnd);

    const returnResponse = await admin.request(`/admin/order-items/${item.id}/return`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            actualReturnDate: extendedEnd,
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: extendedEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay,
            isDamaged: true,
            damageDescription: 'Hydraulikschlauch beschädigt',
            additionalChargeReason: 'Reparatur Hydraulikschlauch',
            additionalChargeAmount: 100,
            depositDeductionReason: 'Dokumentierter Schaden',
            returnNotes: 'Automatischer Verrechnungstest'
        })
    });
    assert.equal(returnResponse.status, 200, await returnResponse.text());

    const [returnedItem] = await queryRows(
        `SELECT item_status, damage_description, deposit_decision,
                deposit_deduction_amount, deposit_refund_amount
         FROM rental_order_items WHERE id = ?`,
        [item.id]
    );
    assert.equal(returnedItem.item_status, 'returned_damaged');
    assert.equal(returnedItem.damage_description, 'Hydraulikschlauch beschädigt');
    assert.equal(returnedItem.deposit_decision, 'partial_refund');
    assert.equal(Number(returnedItem.deposit_deduction_amount), 260);
    assert.equal(Number(returnedItem.deposit_refund_amount), 40);

    const adjustmentRows = await queryRows(
        `SELECT payment_status, amount FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ? AND payment_type = 'rental_adjustment'`,
        [order.orderId, item.id]
    );
    assert.equal(adjustmentRows[0].payment_status, 'offset');
    assert.equal(Number(adjustmentRows[0].amount), 160);

    const [depositRefund] = await queryRows(
        `SELECT payment_status, amount FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ? AND payment_type = 'deposit_refund'`,
        [order.orderId, item.id]
    );
    assert.equal(depositRefund.payment_status, 'pending');
    assert.equal(Number(depositRefund.amount), -40);
    const persistedExtension = (await receiptMails(order.orderId)).find(mail => mail.receipt.kind === 'extension');
    assert.deepEqual(persistedExtension, extensionMails[0], 'spätere Verrechnung darf den Verlängerungsbeleg nicht verändern');
});

test('erstattet eine Online-Kaution auch mit historischer Zahlung nur am Auftrag', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const rentalStart = futureDate(60);
    const rentalEnd = futureDate(61);
    const extendedEnd = futureDate(62);
    const order = await createOrder(customer, 'online', rentalStart, rentalEnd);
    const [item] = await queryRows('SELECT id FROM rental_order_items WHERE order_id = ? LIMIT 1', [order.orderId]);

    const paidInitialId = `tr_test_paid_initial_${order.orderId}`;
    await execute('UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?', [paidInitialId, order.orderId]);
    await execute('UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?', [paidInitialId, order.orderId]);
    const initialWebhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: paidInitialId })
    });
    assert.equal(initialWebhook.status, 200, await initialWebhook.text());

    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);
    await signHandoverBeforePickup(admin, item.id);
    const pickup = await admin.request(`/admin/order-items/${item.id}/pickup`, { method: 'PUT' });
    assert.equal(pickup.status, 200, await pickup.text());

    const extension = await admin.request(`/admin/order-items/${item.id}/rental-adjustment`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: extendedEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay
        })
    });
    assert.equal(extension.status, 200, await extension.text());

    const onlineReceipts = await receiptMails(order.orderId);
    assert.ok(onlineReceipts.some(mail => mail.receipt.kind === 'order' && mail.receipt.paymentStatus === 'pending'));
    assert.equal(onlineReceipts.filter(mail => mail.receipt.kind === 'extension').length, 1);

    const [extensionPayment] = await queryRows(
        `SELECT id, mollie_payment_id FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ? AND payment_type = 'rental_adjustment'`,
        [order.orderId, item.id]
    );
    const paidExtensionId = `tr_test_paid_extension_${order.orderId}`;
    await execute('UPDATE rental_order_payments SET mollie_payment_id = ? WHERE id = ?', [paidExtensionId, extensionPayment.id]);
    const extensionWebhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: paidExtensionId })
    });
    assert.equal(extensionWebhook.status, 200, await extensionWebhook.text());

    const detailResponse = await customer.request(`/my-orders/${order.orderId}`);
    const customerDetail = await detailResponse.json();
    assert.equal(detailResponse.status, 200, JSON.stringify(customerDetail));
    assert.ok(Array.isArray(customerDetail.payments));
    assert.ok(customerDetail.payments.some(payment =>
        payment.paymentType === 'rental_adjustment' && payment.paymentStatus === 'paid'
    ));
    assert.ok(customerDetail.items[0].pickedUpAt);

    await execute(
        `DELETE FROM rental_order_payments
         WHERE order_id = ?
         AND payment_type IN ('initial_payment', 'rental', 'deposit')`,
        [order.orderId]
    );

    const returnResponse = await admin.request(`/admin/order-items/${item.id}/return`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            actualReturnDate: extendedEnd,
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: extendedEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay,
            isDamaged: false,
            damageDescription: '',
            additionalChargeAmount: 0,
            returnNotes: 'Ordnungsgemäße Online-Rückgabe'
        })
    });
    assert.equal(returnResponse.status, 200, await returnResponse.text());

    const refund = await waitForDatabaseRow(
        `SELECT payment_method, payment_status, amount, mollie_payment_id, mollie_refund_id
         FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ? AND payment_type = 'deposit_refund'`,
        [order.orderId, item.id],
        row => row.payment_status === 'paid' && Boolean(row.mollie_refund_id),
        'Online-Kautionsrückerstattung'
    );
    assert.equal(refund.payment_method, 'online');
    assert.equal(refund.payment_status, 'paid');
    assert.equal(Number(refund.amount), -300);
    assert.equal(refund.mollie_payment_id, paidInitialId);
    assert.match(refund.mollie_refund_id, /^re_test_paid_/);

    const [closedOrder] = await queryRows(
        'SELECT return_case_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.equal(closedOrder.return_case_status, 'closed');
    const finalMails = await receiptMails(order.orderId);
    assert.equal(finalMails.filter(mail => mail.receipt.kind === 'completed').length, 1, 'Refund-Worker erstellt den Abschlussbeleg');
    assert.equal(finalMails.filter(mail => mail.receipt.kind === 'return').length, 1);
    const [mailAttempts] = await queryRows("SELECT SUM(attempt_count) AS count FROM external_effects_outbox WHERE effect_type = 'mail.send'");
    assert.equal(Number(mailAttempts.count), 0, 'fehlende Mailkonfiguration verbraucht keine Versandversuche');
});

test('erstattet eine verspätete Online-Verlängerungszahlung, wenn sie bei Rückgabe bereits mit der Kaution verrechnet wurde', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const rentalStart = futureDate(65);
    const rentalEnd = futureDate(66);
    const extendedEnd = futureDate(68);
    const order = await createOrder(customer, 'online', rentalStart, rentalEnd);

    const paidInitialId = `tr_test_paid_offset_initial_${order.orderId}`;
    await execute('UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?', [paidInitialId, order.orderId]);
    await execute('UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?', [paidInitialId, order.orderId]);
    const initialWebhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: paidInitialId })
    });
    assert.equal(initialWebhook.status, 200, await initialWebhook.text());

    const [item] = await queryRows(
        'SELECT id FROM rental_order_items WHERE order_id = ? LIMIT 1',
        [order.orderId]
    );
    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);
    await signHandoverBeforePickup(admin, item.id);
    const pickup = await admin.request(`/admin/order-items/${item.id}/pickup`, { method: 'PUT' });
    assert.equal(pickup.status, 200, await pickup.text());

    const extension = await admin.request(`/admin/order-items/${item.id}/rental-adjustment`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: extendedEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay
        })
    });
    assert.equal(extension.status, 200, await extension.text());

    const [extensionPayment] = await queryRows(
        `SELECT id FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ?
         AND payment_type = 'rental_adjustment'`,
        [order.orderId, item.id]
    );

    const returnResponse = await admin.request(`/admin/order-items/${item.id}/return`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            actualReturnDate: extendedEnd,
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: extendedEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay,
            isDamaged: false,
            additionalChargeAmount: 0,
            returnNotes: 'Online-Verlängerung mit Kaution verrechnet'
        })
    });
    assert.equal(returnResponse.status, 200, await returnResponse.text());

    const [offsetAdjustment] = await queryRows(
        'SELECT payment_status FROM rental_order_payments WHERE id = ?',
        [extensionPayment.id]
    );
    assert.equal(offsetAdjustment.payment_status, 'offset');

    const latePaidExtensionId = `tr_test_paid_offset_extension_${order.orderId}`;
    await execute(
        'UPDATE rental_order_payments SET mollie_payment_id = ? WHERE id = ?',
        [latePaidExtensionId, extensionPayment.id]
    );
    const lateWebhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: latePaidExtensionId })
    });
    assert.equal(lateWebhook.status, 200, await lateWebhook.text());

    const duplicateRefund = await waitForDatabaseRow(
        `SELECT payment_status, amount FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ?
         AND payment_type = 'duplicate_payment_refund'
         AND mollie_payment_id = ?`,
        [order.orderId, item.id, latePaidExtensionId],
        row => row.payment_status === 'paid',
        'Erstattung der verspäteten, bereits verrechneten Verlängerungszahlung'
    );
    assert.equal(duplicateRefund.payment_status, 'paid');
    assert.equal(Number(duplicateRefund.amount), -160);

    const redirectResponse = await customer.request(
        `/orders/${order.orderId}/payment-status/sync?paymentType=rental_adjustment&itemId=${item.id}`,
        { method: 'POST' }
    );
    const redirectStatus = await redirectResponse.json();
    assert.equal(redirectResponse.status, 200, JSON.stringify(redirectStatus));
    assert.equal(redirectStatus.settled_by_offset, true);
    assert.equal(redirectStatus.duplicate_refund_status, 'paid');
});

test('verhindert Doppelzahlung bei Bar-Fallback einer Online-Nachzahlung und informiert den Redirect korrekt', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const rentalStart = futureDate(70);
    const rentalEnd = futureDate(71);
    const extendedEnd = futureDate(73);
    const order = await createOrder(customer, 'online', rentalStart, rentalEnd);

    const paidInitialId = `tr_test_paid_cash_fallback_initial_${order.orderId}`;
    await execute('UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?', [paidInitialId, order.orderId]);
    await execute('UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?', [paidInitialId, order.orderId]);
    const initialWebhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: paidInitialId })
    });
    assert.equal(initialWebhook.status, 200, await initialWebhook.text());

    const [item] = await queryRows('SELECT id FROM rental_order_items WHERE order_id = ? LIMIT 1', [order.orderId]);
    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);
    await signHandoverBeforePickup(admin, item.id);
    const pickup = await admin.request(`/admin/order-items/${item.id}/pickup`, { method: 'PUT' });
    assert.equal(pickup.status, 200, await pickup.text());

    const extension = await admin.request(`/admin/order-items/${item.id}/rental-adjustment`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: extendedEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay
        })
    });
    assert.equal(extension.status, 200, await extension.text());

    const [onlineAdjustment] = await queryRows(
        `SELECT id, amount FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ? AND payment_type = 'rental_adjustment'
         AND payment_method = 'online'`,
        [order.orderId, item.id]
    );
    assert.equal(Number(onlineAdjustment.amount), 160);

    const cashFallback = await admin.request('/admin/order-payments/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            orderItemId: item.id,
            paymentType: 'rental_adjustment',
            amount: 160,
            note: 'Bar-Fallback im Integrationstest'
        })
    });
    assert.equal(cashFallback.status, 200, await cashFallback.text());

    const latePaidAdjustmentId = `tr_test_paid_cash_fallback_${order.orderId}`;
    await execute(
        'UPDATE rental_order_payments SET mollie_payment_id = ? WHERE id = ?',
        [latePaidAdjustmentId, onlineAdjustment.id]
    );

    const redirectStatusResponse = await customer.request(
        `/orders/${order.orderId}/payment-status/sync?paymentType=rental_adjustment&itemId=${item.id}`,
        { method: 'POST' }
    );
    const redirectStatus = await redirectStatusResponse.json();
    assert.equal(redirectStatusResponse.status, 200, JSON.stringify(redirectStatus));
    assert.equal(redirectStatus.payment_status, 'paid');
    assert.equal(redirectStatus.settled_by_cash, true);
    assert.equal(redirectStatus.duplicate_refund_status, 'pending');

    const duplicateRefund = await waitForDatabaseRow(
        `SELECT payment_status, amount FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ? AND payment_type = 'duplicate_payment_refund'`,
        [order.orderId, item.id],
        row => row.payment_status === 'paid',
        'Erstattung der verspäteten Onlinezahlung nach Bar-Fallback'
    );
    assert.equal(duplicateRefund.payment_status, 'paid');
    assert.equal(Number(duplicateRefund.amount), -160);
    // Duplicate deliveries must not create another refund or cash booking.
    for (let delivery = 0; delivery < 2; delivery += 1) {
        const duplicate = await customer.request('/webhooks/mollie', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: latePaidAdjustmentId })
        });
        assert.equal(duplicate.status, 200, await duplicate.text());
    }
    const refunds = await queryRows("SELECT amount FROM rental_order_payments WHERE order_id = ? AND order_item_id = ? AND payment_type = 'duplicate_payment_refund'", [order.orderId, item.id]);
    const cash = await queryRows("SELECT amount FROM rental_order_payments WHERE order_id = ? AND order_item_id = ? AND payment_type = 'rental_adjustment' AND payment_method = 'cash' AND payment_status = 'paid'", [order.orderId, item.id]);
    assert.equal(refunds.length, 1);
    assert.equal(Number(refunds[0].amount), -160);
    assert.equal(cash.length, 1);
    assert.equal(Number(cash[0].amount), 160);

});

test('erstattet eine zweite Initialzahlung nach Checkout-Retry, ohne den aktiven Auftrag zu verändern', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const order = await createOrder(customer, 'online', futureDate(80), futureDate(81));

    const canonicalPaymentId = `tr_test_paid_canonical_${order.orderId}`;
    await execute('UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?', [canonicalPaymentId, order.orderId]);
    await execute('UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?', [canonicalPaymentId, order.orderId]);
    const canonicalWebhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: canonicalPaymentId })
    });
    assert.equal(canonicalWebhook.status, 200, await canonicalWebhook.text());

    const duplicatePaymentId = `tr_test_paid_duplicate_initial_${order.orderId}`;
    await execute(
        `INSERT INTO rental_order_payments
         (order_id, payment_type, payment_method, payment_status, amount, mollie_payment_id, note)
         VALUES (?, 'initial_payment', 'online', 'pending', 460, ?, 'Simulierter Checkout-Retry')`,
        [order.orderId, duplicatePaymentId]
    );

    const duplicateWebhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: duplicatePaymentId })
    });
    assert.equal(duplicateWebhook.status, 200, await duplicateWebhook.text());

    const [storedOrder] = await queryRows(
        'SELECT status, payment_status, mollie_payment_id FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.deepEqual(storedOrder, {
        status: 'confirmed',
        payment_status: 'paid',
        mollie_payment_id: canonicalPaymentId
    });

    const duplicateRefund = await waitForDatabaseRow(
        `SELECT payment_status, amount, mollie_payment_id
         FROM rental_order_payments
         WHERE order_id = ? AND payment_type = 'duplicate_payment_refund'
         AND mollie_payment_id = ?`,
        [order.orderId, duplicatePaymentId],
        row => row.payment_status === 'paid',
        'Rückerstattung der zweiten Initialzahlung'
    );
    assert.equal(duplicateRefund.payment_status, 'paid');
    assert.equal(Number(duplicateRefund.amount), -460);
});

test('startet eine fehlgeschlagene Online-Erstattung kontrolliert und betragsbegrenzt erneut', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const order = await createOrder(customer, 'online', futureDate(90), futureDate(91));
    const paidPaymentId = `tr_test_paid_refund_retry_${order.orderId}`;
    await execute('UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?', [paidPaymentId, order.orderId]);
    await execute('UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?', [paidPaymentId, order.orderId]);
    const paymentWebhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: paidPaymentId })
    });
    assert.equal(paymentWebhook.status, 200, await paymentWebhook.text());

    const failedRefundResult = await execute(
        `INSERT INTO rental_order_payments
         (order_id, payment_type, payment_method, payment_status, amount,
          mollie_payment_id, mollie_refund_id, note)
         VALUES (?, 'duplicate_payment_refund', 'online', 'failed', -25,
          ?, 're_test_failed_original', 'Simulierter fehlgeschlagener Refund')`,
        [order.orderId, paidPaymentId]
    );

    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);
    const retryResponse = await admin.request(
        `/admin/order-payments/${failedRefundResult.insertId}/retry-refund`,
        { method: 'POST' }
    );
    const retryBody = await retryResponse.json();
    assert.equal(retryResponse.status, 200, JSON.stringify(retryBody));
    assert.equal(retryBody.paymentStatus, 'paid');

    const retryRows = await queryRows(
        `SELECT payment_status, amount, mollie_refund_id
         FROM rental_order_payments
         WHERE order_id = ? AND payment_type = 'duplicate_payment_refund'
         ORDER BY id DESC`,
        [order.orderId]
    );
    assert.equal(retryRows[0].payment_status, 'paid');
    assert.equal(Number(retryRows[0].amount), -25);
    assert.match(retryRows[0].mollie_refund_id, /^re_test_paid_/);
});

test('dedupliziert einen bereits pending Refund-Retry vor der Kapazitätsberechnung', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const order = await createOrder(customer, 'online', futureDate(92), futureDate(93));
    const paidPaymentId = `tr_test_paid_pending_retry_${order.orderId}`;
    await execute(
        'UPDATE rental_order_payments SET mollie_payment_id = ?, payment_status = ? WHERE order_id = ?',
        [paidPaymentId, 'paid', order.orderId]
    );

    const failedRefundResult = await execute(
        `INSERT INTO rental_order_payments
         (order_id, payment_type, payment_method, payment_status, amount,
          mollie_payment_id, mollie_refund_id, note)
         VALUES (?, 'duplicate_payment_refund', 'online', 'failed', -25,
          ?, 're_test_failed_pending', 'Simulierter fehlgeschlagener Refund')`,
        [order.orderId, paidPaymentId]
    );
    const operationKey = `retry-refund-${failedRefundResult.insertId}-1`;
    const pendingRetryResult = await execute(
        `INSERT INTO rental_order_payments
         (order_id, payment_type, payment_method, payment_status, amount,
          mollie_payment_id, external_operation_key, note)
         VALUES (?, 'duplicate_payment_refund', 'online', 'pending', -25, ?, ?, ?)`,
        [order.orderId, paidPaymentId, operationKey, 'Pending Retry']
    );
    const payload = {
        refund: { paymentId: paidPaymentId, amount: 25 },
        application: {
            kind: 'refund_record',
            paymentRecordId: Number(pendingRetryResult.insertId)
        }
    };
    await execute(
        `INSERT INTO external_effects_outbox
         (operation_key, effect_type, payload_json, payload_hash, status, max_attempts)
         VALUES (?, 'mollie.refund.create', ?, SHA2(?, 256), 'processing', 8)`,
        [
            operationKey,
            JSON.stringify(payload),
            JSON.stringify(payload)
        ]
    );

    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);
    const response = await admin.request(
        `/admin/order-payments/${failedRefundResult.insertId}/retry-refund`,
        { method: 'POST' }
    );
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.paymentStatus, 'pending');
    assert.match(body.message, /bereits erneut/);
});

test('erstattet Teilstorno und anschließenden Reststorno einer bezahlten Online-Bestellung ohne Übererstattung', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const firstStart = futureDate(100);
    const firstEnd = futureDate(101);
    const secondStart = futureDate(103);
    const secondEnd = futureDate(104);

    await addCartItem(customer, firstStart, firstEnd);
    await addCartItem(customer, secondStart, secondEnd);
    const createResponse = await customer.request('/data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            paymentMethod: 'online',
            form: orderForm(TEST_CUSTOMER.email)
        })
    });
    const order = await createResponse.json();
    assert.equal(createResponse.status, 200, JSON.stringify(order));

    const paidPaymentId = `tr_test_paid_partial_cancel_${order.orderId}`;
    await execute('UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?', [paidPaymentId, order.orderId]);
    await execute('UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?', [paidPaymentId, order.orderId]);
    const paymentWebhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: paidPaymentId })
    });
    assert.equal(paymentWebhook.status, 200, await paymentWebhook.text());

    const items = await queryRows(
        `SELECT id FROM rental_order_items WHERE order_id = ? ORDER BY id`,
        [order.orderId]
    );
    assert.equal(items.length, 2);

    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);
    const openExtension = await admin.request(`/admin/order-items/${items[0].id}/rental-adjustment`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            adjustedRentalStart: firstStart,
            adjustedRentalEnd: futureDate(102),
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay
        })
    });
    assert.equal(openExtension.status, 200, await openExtension.text());

    const itemCancel = await admin.request(`/admin/order-items/${items[0].id}/cancel`, {
        method: 'PUT'
    });
    assert.equal(itemCancel.status, 200, await itemCancel.text());

    const [partiallyCancelledOrder] = await queryRows(
        `SELECT status, payment_status, return_case_status
         FROM rental_orders WHERE id = ?`,
        [order.orderId]
    );
    assert.deepEqual(partiallyCancelledOrder, {
        status: 'confirmed',
        payment_status: 'paid',
        return_case_status: null
    });

    const partialRefund = await waitForDatabaseRow(
        `SELECT payment_status, amount FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ?
         AND payment_type = 'order_cancellation_refund'`,
        [order.orderId, items[0].id],
        row => row.payment_status === 'paid',
        'Online-Teilstornoerstattung'
    );
    assert.equal(partialRefund.payment_status, 'paid');
    assert.equal(Number(partialRefund.amount), -460);

    const [cancelledExtension] = await queryRows(
        `SELECT id, payment_status FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ?
         AND payment_type = 'rental_adjustment'`,
        [order.orderId, items[0].id]
    );
    assert.equal(cancelledExtension.payment_status, 'cancelled');

    const latePaidExtensionId = `tr_test_paid_cancelled_extension_${order.orderId}`;
    await execute(
        'UPDATE rental_order_payments SET mollie_payment_id = ? WHERE id = ?',
        [latePaidExtensionId, cancelledExtension.id]
    );
    const lateExtensionWebhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: latePaidExtensionId })
    });
    assert.equal(lateExtensionWebhook.status, 200, await lateExtensionWebhook.text());

    const lateExtensionRefund = await waitForDatabaseRow(
        `SELECT payment_status, amount FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ?
         AND payment_type = 'order_cancellation_refund'
         AND mollie_payment_id = ?`,
        [order.orderId, items[0].id, latePaidExtensionId],
        row => row.payment_status === 'paid',
        'Erstattung der verspäteten Verlängerungszahlung nach Teilstorno'
    );
    assert.equal(lateExtensionRefund.payment_status, 'paid');
    assert.equal(Number(lateExtensionRefund.amount), -80);

    const fullCancel = await admin.request(`/admin/orders/${order.orderId}/cancel`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Reststorno nach Teilstorno' })
    });
    assert.equal(fullCancel.status, 200, await fullCancel.text());

    const fullyCancelledOrder = await waitForDatabaseRow(
        'SELECT status, payment_status FROM rental_orders WHERE id = ?',
        [order.orderId],
        row => row.status === 'cancelled' && row.payment_status === 'refunded',
        'Abschluss der Reststorno-Erstattung'
    );
    assert.deepEqual(fullyCancelledOrder, {
        status: 'cancelled',
        payment_status: 'refunded'
    });

    const [refundTotal] = await queryRows(
        `SELECT SUM(ABS(amount)) AS amount
         FROM rental_order_payments
         WHERE order_id = ? AND payment_type = 'order_cancellation_refund'
         AND payment_status = 'paid'`,
        [order.orderId]
    );
    assert.equal(Number(refundTotal.amount), 1000);
});

test('storniert eine Online-Miete mit bar ersetzter Verlängerung über beide Erstattungswege vollständig', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const rentalStart = futureDate(110);
    const rentalEnd = futureDate(111);
    const extendedEnd = futureDate(113);
    const order = await createOrder(customer, 'online', rentalStart, rentalEnd);

    const paidInitialId = `tr_test_paid_mixed_cancel_${order.orderId}`;
    await execute('UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?', [paidInitialId, order.orderId]);
    await execute('UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?', [paidInitialId, order.orderId]);
    const paymentWebhook = await customer.request('/webhooks/mollie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: paidInitialId })
    });
    assert.equal(paymentWebhook.status, 200, await paymentWebhook.text());

    const [item] = await queryRows(
        'SELECT id FROM rental_order_items WHERE order_id = ? LIMIT 1',
        [order.orderId]
    );
    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);

    const extension = await admin.request(`/admin/order-items/${item.id}/rental-adjustment`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            adjustedRentalStart: rentalStart,
            adjustedRentalEnd: extendedEnd,
            adjustedPricePerDay: TEST_PRODUCT.pricePerDay
        })
    });
    assert.equal(extension.status, 200, await extension.text());

    const cashFallback = await admin.request('/admin/order-payments/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            orderItemId: item.id,
            paymentType: 'rental_adjustment',
            amount: 160,
            note: 'Bar ersetzte Verlängerung vor Storno'
        })
    });
    assert.equal(cashFallback.status, 200, await cashFallback.text());

    const cancelResponse = await admin.request(`/admin/orders/${order.orderId}/cancel`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Gemischter Erstattungsweg im Integrationstest' })
    });
    assert.equal(cancelResponse.status, 200, await cancelResponse.text());

    const [cancelledOrder] = await queryRows(
        'SELECT status, payment_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.deepEqual(cancelledOrder, {
        status: 'cancelled',
        payment_status: 'refund_pending'
    });

    await waitForDatabaseRow(
        `SELECT payment_status
         FROM rental_order_payments
         WHERE order_id = ? AND payment_type = 'order_cancellation_refund'
         AND payment_method = 'online'`,
        [order.orderId],
        row => row.payment_status === 'paid',
        'Online-Anteil der gemischten Stornoerstattung'
    );
    const refunds = await queryRows(
        `SELECT payment_method, payment_status, amount
         FROM rental_order_payments
         WHERE order_id = ? AND payment_type = 'order_cancellation_refund'
         ORDER BY payment_method`,
        [order.orderId]
    );
    assert.deepEqual(
        refunds.map(refund => ({
            method: refund.payment_method,
            status: refund.payment_status,
            amount: Number(refund.amount)
        })),
        [
            { method: 'cash', status: 'pending', amount: -160 },
            { method: 'online', status: 'paid', amount: -460 }
        ]
    );

    const cashRefund = await admin.request('/admin/order-payments/manual-refund', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            paymentType: 'order_cancellation_refund',
            amount: 160,
            note: 'Verlängerung bar zurückgezahlt'
        })
    });
    assert.equal(cashRefund.status, 200, await cashRefund.text());

    const [settledOrder] = await queryRows(
        'SELECT payment_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.equal(settledOrder.payment_status, 'refunded');
});

test('reduziert eine noch unbezahlte Barbestellung nach Teilstorno auf den tatsächlich verbleibenden Betrag', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const firstStart = futureDate(115);
    const firstEnd = futureDate(116);
    const secondStart = futureDate(118);
    const secondEnd = futureDate(119);

    await addCartItem(customer, firstStart, firstEnd);
    await addCartItem(customer, secondStart, secondEnd);
    const createResponse = await customer.request('/data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            paymentMethod: 'cash',
            form: orderForm(TEST_CUSTOMER.email)
        })
    });
    const order = await createResponse.json();
    assert.equal(createResponse.status, 200, JSON.stringify(order));

    const items = await queryRows(
        'SELECT id FROM rental_order_items WHERE order_id = ? ORDER BY id',
        [order.orderId]
    );
    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);
    const itemCancel = await admin.request(`/admin/order-items/${items[0].id}/cancel`, {
        method: 'PUT'
    });
    assert.equal(itemCancel.status, 200, await itemCancel.text());

    const [reducedOrder] = await queryRows(
        'SELECT total_amount, payment_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.equal(Number(reducedOrder.total_amount), 460);
    assert.equal(reducedOrder.payment_status, 'pending');

    const openCashParts = await queryRows(
        `SELECT payment_type, payment_status, amount
         FROM rental_order_payments
         WHERE order_id = ? AND payment_method = 'cash'
         AND payment_type IN ('rental', 'deposit')
         ORDER BY payment_type`,
        [order.orderId]
    );
    assert.deepEqual(
        openCashParts.map(payment => ({
            type: payment.payment_type,
            status: payment.payment_status,
            amount: Number(payment.amount)
        })),
        [
            { type: 'deposit', status: 'pending', amount: 300 },
            { type: 'rental', status: 'pending', amount: 160 }
        ]
    );

    const wrongAmount = await admin.request('/admin/order-payments/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            paymentType: 'initial_payment',
            amount: 920
        })
    });
    assert.equal(wrongAmount.status, 400);

    const correctAmount = await admin.request('/admin/order-payments/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            paymentType: 'initial_payment',
            amount: 460
        })
    });
    assert.equal(correctAmount.status, 200, await correctAmount.text());
});

test('kassiert mehrere aufeinanderfolgende Bar-Verlängerungen und erstattet sie beim Storno exakt einmal', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const rentalStart = futureDate(120);
    const rentalEnd = futureDate(121);
    const firstExtendedEnd = futureDate(122);
    const secondExtendedEnd = futureDate(123);
    const order = await createOrder(customer, 'cash', rentalStart, rentalEnd);
    const [item] = await queryRows(
        'SELECT id FROM rental_order_items WHERE order_id = ? LIMIT 1',
        [order.orderId]
    );

    const admin = new SessionClient();
    await login(admin, TEST_ADMIN);
    const initialPayment = await admin.request('/admin/order-payments/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            paymentType: 'initial_payment',
            amount: 460
        })
    });
    assert.equal(initialPayment.status, 200, await initialPayment.text());

    for (const adjustedRentalEnd of [firstExtendedEnd, secondExtendedEnd]) {
        const extension = await admin.request(`/admin/order-items/${item.id}/rental-adjustment`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                adjustedRentalStart: rentalStart,
                adjustedRentalEnd,
                adjustedPricePerDay: TEST_PRODUCT.pricePerDay
            })
        });
        assert.equal(extension.status, 200, await extension.text());

        const extensionPayment = await admin.request('/admin/order-payments/manual', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                orderId: order.orderId,
                orderItemId: item.id,
                paymentType: 'rental_adjustment',
                amount: 80
            })
        });
        assert.equal(extensionPayment.status, 200, await extensionPayment.text());
    }

    const paidAdjustments = await queryRows(
        `SELECT payment_status, amount
         FROM rental_order_payments
         WHERE order_id = ? AND order_item_id = ?
         AND payment_type = 'rental_adjustment'
         ORDER BY id`,
        [order.orderId, item.id]
    );
    assert.deepEqual(
        paidAdjustments.map(payment => ({
            status: payment.payment_status,
            amount: Number(payment.amount)
        })),
        [
            { status: 'paid', amount: 80 },
            { status: 'paid', amount: 80 }
        ]
    );

    const cancelResponse = await admin.request(`/admin/orders/${order.orderId}/cancel`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Storno nach zwei bezahlten Bar-Verlängerungen' })
    });
    assert.equal(cancelResponse.status, 200, await cancelResponse.text());

    const [cashRefund] = await queryRows(
        `SELECT payment_status, amount
         FROM rental_order_payments
         WHERE order_id = ? AND payment_type = 'order_cancellation_refund'
         AND payment_method = 'cash'`,
        [order.orderId]
    );
    assert.equal(cashRefund.payment_status, 'pending');
    assert.equal(Number(cashRefund.amount), -620);

    const settleRefund = await admin.request('/admin/order-payments/manual-refund', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            orderId: order.orderId,
            paymentType: 'order_cancellation_refund',
            amount: 620
        })
    });
    assert.equal(settleRefund.status, 200, await settleRefund.text());

    const [settledOrder] = await queryRows(
        'SELECT status, payment_status FROM rental_orders WHERE id = ?',
        [order.orderId]
    );
    assert.deepEqual(settledOrder, {
        status: 'cancelled',
        payment_status: 'refunded'
    });
});

test('verweigert unverifizierte Logins und gibt Verbindungen auf allen Fehlpfaden frei', async () => {
    const [beforeRow] = await queryRows("SHOW STATUS LIKE 'Threads_connected'");
    const beforeConnections = Number(beforeRow.Value);

    const unverified = new SessionClient();
    await prepareCsrf(unverified);
    const unverifiedResponse = await unverified.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username: TEST_UNVERIFIED_CUSTOMER.email,
            password: TEST_UNVERIFIED_CUSTOMER.password
        })
    });
    const unverifiedResult = await unverifiedResponse.json();
    assert.equal(unverifiedResponse.status, 403, JSON.stringify(unverifiedResult));
    assert.match(unverifiedResult.error, /bestätigen/i);

    await execute(
        'UPDATE users SET email_verified = 0 WHERE username = ?',
        [TEST_ADMIN.email]
    );
    const legacyAdmin = new SessionClient();
    await login(legacyAdmin, TEST_ADMIN);

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const client = new SessionClient();
        await prepareCsrf(client);
        const response = await client.request('/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                username: TEST_CUSTOMER.email,
                password: `FalschesPasswort${attempt}!`
            })
        });
        assert.equal(response.status, 401, await response.text());
    }

    await delay(100);
    const [afterRow] = await queryRows("SHOW STATUS LIKE 'Threads_connected'");
    const afterConnections = Number(afterRow.Value);

    assert.ok(
        afterConnections <= beforeConnections + 1,
        `Fehlgeschlagene Logins erhöhten Threads_connected von ${beforeConnections} auf ${afterConnections}`
    );
});


test('verbucht Teil-Chargebacks einmalig, wahrt den Mietstatus und verarbeitet Rücknahmen über mehrere Zahlungen', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const order = await createOrder(customer, 'cash', futureDate(400), futureDate(401));
    const paymentId = 'tr_test_paid_chargeback_' + order.orderId;
    await execute("UPDATE rental_orders SET status = 'returned', payment_status = 'paid', mollie_payment_id = ? WHERE id = ?", [paymentId, order.orderId]);
    await execute("UPDATE rental_order_payments SET payment_method = 'online', payment_status = 'paid', mollie_payment_id = ? WHERE order_id = ?", [paymentId, order.orderId]);
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection(require('../../config/db'));
    const { syncMollieChargebacks } = require('../../services/mollieChargebacks');
    const chargeback = { id: 'chb_partial_' + order.orderId, paymentId,
        amount: { currency: 'EUR', value: '20.00' } };
    const sync = async payment => {
        await connection.beginTransaction();
        try { const result = await syncMollieChargebacks(connection, payment); await connection.commit(); return result; }
        catch (error) { await connection.rollback(); throw error; }
    };
    try {
        for (let i = 0; i < 2; i++) {
            assert.equal((await sync({ id: paymentId, status: 'paid', chargebacks: [chargeback] })).active, true);
        }
        let rows = await queryRows("SELECT amount, payment_status FROM rental_order_payments WHERE order_id = ? AND payment_type = 'chargeback'", [order.orderId]);
        assert.equal(rows.length, 1);
        assert.equal(Number(rows[0].amount), -20);
        let [state] = await queryRows('SELECT status, payment_status, return_case_status FROM rental_orders WHERE id = ?', [order.orderId]);
        assert.equal(state.status, 'returned');
        assert.equal(state.payment_status, 'charged_back');
        assert.equal(state.return_case_status, 'payment_dispute');
        const secondId = paymentId + '_second';
        await execute("INSERT INTO rental_order_payments (order_id, payment_type, payment_method, payment_status, amount, mollie_payment_id) VALUES (?, 'rental_adjustment', 'online', 'paid', 30, ?)", [order.orderId, secondId]);
        await sync({ id: secondId, status: 'paid', chargebacks: [{ ...chargeback, id: chargeback.id + '_second', paymentId: secondId }] });
        assert.equal((await sync({ id: paymentId, status: 'paid', chargebacks: [{ ...chargeback, reversedAt: '2026-09-27T12:00:00Z' }] })).active, true);
        assert.equal((await sync({ id: secondId, status: 'paid', chargebacks: [{ ...chargeback, id: chargeback.id + '_second', paymentId: secondId, reversedAt: '2026-09-27T12:00:00Z' }] })).active, false);
        [state] = await queryRows('SELECT status, payment_status FROM rental_orders WHERE id = ?', [order.orderId]);
        assert.equal(state.status, 'returned');
        assert.equal(state.payment_status, 'paid');
        rows = await queryRows("SELECT payment_status FROM rental_order_payments WHERE order_id = ? AND payment_type = 'chargeback'", [order.orderId]);
        assert.ok(rows.every(row => row.payment_status === 'cancelled'));
    } finally { await connection.end(); }
});


test('gleicht Dashboard-Refunds und frühe Refund-Webhooks ohne doppelte Buchung ab', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);
    const order = await createOrder(customer, 'cash', futureDate(402), futureDate(403));
    const paymentId = 'tr_test_paid_refund_sync_' + order.orderId;
    await execute("UPDATE rental_order_payments SET payment_method = 'online', payment_status = 'paid', mollie_payment_id = ? WHERE order_id = ?", [paymentId, order.orderId]);
    const connection = await require('mysql2/promise').createConnection(require('../../config/db'));
    const { syncMollieRefundsForPayment } = require('../../services/mollieRefunds');
    const refund = { id: 're_dashboard_' + order.orderId, status: 'pending', amount: { currency: 'EUR', value: '12.30' } };
    try {
        await connection.beginTransaction();
        await syncMollieRefundsForPayment(connection, paymentId, [refund]);
        await syncMollieRefundsForPayment(connection, paymentId, [{ ...refund, status: 'refunded' }]);
        const operationKey = 'early-refund-' + order.orderId;
        await connection.execute("INSERT INTO rental_order_payments (order_id, payment_type, payment_method, payment_status, amount, mollie_payment_id, external_operation_key) VALUES (?, 'deposit_refund', 'online', 'pending', -5, ?, ?)", [order.orderId, paymentId, operationKey]);
        await syncMollieRefundsForPayment(connection, paymentId, [{ id: 're_early_' + order.orderId, status: 'refunded', amount: { currency: 'EUR', value: '5.00' }, metadata: { operationKey } }]);
        await connection.commit();
        const rows = await queryRows("SELECT payment_type, amount, payment_status FROM rental_order_payments WHERE order_id = ? AND mollie_refund_id IS NOT NULL ORDER BY id", [order.orderId]);
        assert.equal(rows.length, 2);
        assert.equal(rows[0].payment_type, 'refund_record');
        assert.equal(Number(rows[0].amount), -12.3);
        assert.equal(rows[1].payment_type, 'deposit_refund');
        assert.ok(rows.every(row => row.payment_status === 'paid'));
    } catch (error) { await connection.rollback(); throw error; }
    finally { await connection.end(); }
});


test('nimmt Widerrufe ohne Login und Fristsperre entgegen, bestätigt unverändert und schützt Adminzugriff', async () => {
    const guest = new SessionClient(); await prepareCsrf(guest);
    const data = { id: require('node:crypto').randomUUID(), kind: 'withdrawal', name: '<img src=x onerror=alert(1)>',
        email: 'withdrawal.test@example.invalid', contractReference: 'Älterer Vertrag ohne Bestellnummer', scope: 'Nur Rüttelplatte' };
    const submit = () => guest.request('/contract-declarations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const first = await submit(); assert.equal(first.status, 201, await first.clone().text());
    const result = await first.json();
    assert.match(result.receipt.declaration, /Hiermit widerrufe ich/);
    assert.match(result.receipt.declaration, /Nur Rüttelplatte/);
    const repeat = await submit(); assert.equal(repeat.status, 201);
    const replay = await repeat.json();
    assert.equal(new Date(replay.receipt.receivedAt).getTime(), new Date(result.receipt.receivedAt).getTime());
    const rows = await queryRows('SELECT * FROM contract_declarations WHERE id = ?', [data.id]);
    assert.equal(rows.length, 1); assert.equal(rows[0].order_id, null);
    const mails = await queryRows('SELECT payload_json FROM external_effects_outbox WHERE operation_key = ?', ['mail-declaration-' + data.id]);
    assert.equal(mails.length, 1);
    const payload = typeof mails[0].payload_json === 'string' ? JSON.parse(mails[0].payload_json) : mails[0].payload_json;
    assert.ok(payload.message.text.includes(result.receipt.receivedAt));
    assert.ok(payload.message.text.includes(result.receipt.declaration));
    assert.ok(!payload.message.html.includes('<img src=x'));
    const forbidden = await guest.request('/admin/contract-declarations'); assert.equal(forbidden.status, 401);
    const admin = new SessionClient(); await login(admin, TEST_ADMIN);
    const list = await admin.request('/admin/contract-declarations'); assert.equal(list.status, 200);
    assert.ok((await list.json()).items.some(item => item.id === data.id));
    const processed = await admin.request('/admin/contract-declarations/' + data.id + '/processed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: 'Zuordnung geklärt und Rückabwicklung veranlasst' }) });
    assert.equal(processed.status, 200);
    const [stored] = await queryRows('SELECT declaration_text, processing_status FROM contract_declarations WHERE id = ?', [data.id]);
    assert.equal(stored.declaration_text, result.receipt.declaration);
    assert.equal(stored.processing_status, 'processed');
});

test('Kunde storniert eigene bezahlte Bestellung kostenfrei und Erstattung wird nur einmal vorgemerkt', async () => {
    const customer = new SessionClient(); await login(customer, TEST_CUSTOMER);
    const stranger = new SessionClient(); await login(stranger, TEST_OTHER_CUSTOMER);
    const order = await createOrder(customer, 'cash', futureDate(450), futureDate(451));
    const admin = new SessionClient(); await login(admin, TEST_ADMIN);
    const paid = await admin.request('/admin/order-payments/manual', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: order.orderId, paymentType: 'initial_payment', amount: 460 })
    });
    assert.equal(paid.status, 200, await paid.text());
    const url = '/my-orders/' + order.orderId + '/cancel';
    assert.equal((await stranger.request(url, { method: 'POST' })).status, 404);
    for (let i = 0; i < 2; i++) {
        const response = await customer.request(url, { method: 'POST' });
        assert.equal(response.status, 200, await response.text());
    }
    const [cancelled] = await queryRows('SELECT status, payment_status FROM rental_orders WHERE id = ?', [order.orderId]);
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.payment_status, 'refund_pending');
    const refunds = await queryRows("SELECT amount FROM rental_order_payments WHERE order_id = ? AND payment_type = 'order_cancellation_refund'", [order.orderId]);
    assert.equal(refunds.length, 1); assert.ok(Number(refunds[0].amount) < 0);
    const items = await queryRows('SELECT item_status FROM rental_order_items WHERE order_id = ?', [order.orderId]);
    assert.ok(items.every(item => item.item_status === 'cancelled'));
    const mails = await queryRows('SELECT id FROM external_effects_outbox WHERE operation_key = ?', ['mail-order-cancelled-' + order.orderId]);
    assert.equal(mails.length, 1);
});

test('Widerruf nimmt keine Stornierungen an und bleibt nach Abholung unabhängig erreichbar', async () => {
    const customer = new SessionClient(); await login(customer, TEST_CUSTOMER);
    const order = await createOrder(customer, 'cash', futureDate(452), futureDate(453));
    const guest = new SessionClient(); await prepareCsrf(guest);
    const data = { id: require('node:crypto').randomUUID(), kind: 'cancellation', name: 'Test Kunde',
        email: TEST_CUSTOMER.email, contractReference: order.orderNo, scope: '' };
    const response = await guest.request('/contract-declarations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal(response.status, 400, await response.text());
    const [before] = await queryRows('SELECT status FROM rental_orders WHERE id = ?', [order.orderId]);
    assert.notEqual(before.status, 'cancelled');
    assert.equal((await queryRows('SELECT id FROM contract_declarations WHERE id = ?', [data.id])).length, 0);
    const picked = await createOrder(customer, 'cash', futureDate(454), futureDate(455));
    await execute("UPDATE rental_order_items SET item_status = 'picked_up', picked_up_at = NOW() WHERE order_id = ?", [picked.orderId]);
    const denied = await customer.request('/my-orders/' + picked.orderId + '/cancel', { method: 'POST' });
    assert.equal(denied.status, 409, await denied.text());
    const withdrawal = await guest.request('/contract-declarations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...data, id: require('node:crypto').randomUUID(), kind: 'withdrawal', contractReference: picked.orderNo }) });
    assert.equal(withdrawal.status, 201, await withdrawal.text());
});

for (const [scenario, expectedStatus] of [['publish', 200], ['paid', 409], ['amount', 400], ['churn', 409], ['double-cash', 200]]) {
    test(`Bar-Fallback verarbeitet konkurrierende Änderung sicher: ${scenario}`, async () => {
        const customer = new SessionClient();
        await login(customer, TEST_CUSTOMER);
        const offset = 500 + ['publish', 'paid', 'amount', 'churn', 'double-cash'].indexOf(scenario) * 10;
        const order = await createOrder(customer, 'online', futureDate(offset), futureDate(offset + 1));
        const paidId = `tr_test_paid_race_initial_${order.orderId}`;
        await execute('UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?', [paidId, order.orderId]);
        await execute('UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?', [paidId, order.orderId]);
        const paid = await customer.request('/webhooks/mollie', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: paidId }) });
        assert.equal(paid.status, 200);
        const [item] = await queryRows('SELECT id FROM rental_order_items WHERE order_id = ? LIMIT 1', [order.orderId]);
        const admin = new SessionClient();
        await login(admin, TEST_ADMIN);
        await signHandoverBeforePickup(admin, item.id);
        const pickup = await admin.request(`/admin/order-items/${item.id}/pickup`, { method: 'PUT' });
        assert.equal(pickup.status, 200);
        const extension = await admin.request(`/admin/order-items/${item.id}/rental-adjustment`, {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
                adjustedRentalStart: futureDate(offset), adjustedRentalEnd: futureDate(offset + 3), adjustedPricePerDay: TEST_PRODUCT.pricePerDay
            })
        });
        assert.equal(extension.status, 200, await extension.text());
        const payment = await waitForDatabaseRow(
            "SELECT id, mollie_payment_id FROM rental_order_payments WHERE order_id = ? AND payment_type = 'rental_adjustment' AND payment_method = 'online'",
            [order.orderId], row => Boolean(row.mollie_payment_id), 'Checkout für Race-Test'
        );
        if (scenario !== 'double-cash') {
            await execute('UPDATE rental_order_payments SET note = ?, mollie_payment_id = ? WHERE id = ?',
                [`audit-race:${scenario}`, scenario === 'publish' ? null : payment.mollie_payment_id, payment.id]);
        }
        const request = () => admin.request('/admin/order-payments/manual', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orderId: order.orderId, orderItemId: item.id, paymentType: 'rental_adjustment', amount: 160 }) });
        const responses = await Promise.all(scenario === 'double-cash' ? [request(), request()] : [request()]);
        if (scenario === 'double-cash') assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
        else assert.equal(responses[0].status, expectedStatus, await responses[0].text());
        const cash = await queryRows("SELECT amount FROM rental_order_payments WHERE order_id = ? AND payment_type = 'rental_adjustment' AND payment_method = 'cash' AND payment_status = 'paid'", [order.orderId]);
        assert.equal(cash.length, expectedStatus === 200 ? 1 : 0);
        if (cash.length) assert.equal(Number(cash[0].amount), 160);
        if (scenario === 'publish') {
            const [source] = await queryRows('SELECT payment_status, mollie_payment_id FROM rental_order_payments WHERE id = ?', [payment.id]);
            assert.equal(source.payment_status, 'replaced');
            assert.equal(source.mollie_payment_id, `tr_test_open_race_${payment.id}`);
        }
    });
}

test('Übergabeprotokoll: Entwurf, Fotos, Unterschrift, dauerhafter PDF-Beleg und einmaliger Versand', async () => {
    const admin = new SessionClient(), customer = new SessionClient();
    await login(admin, TEST_ADMIN); await login(customer, TEST_CUSTOMER);
    const order = await createOrder(customer, 'cash', futureDate(700), futureDate(701));
    const detail = await (await admin.request(`/admin/orders/${order.orderId}`)).json();
    const itemId = detail.items[0].id;
    const endpoint = `/admin/orders/${order.orderId}/handover`;
    await execute("UPDATE rental_orders SET payment_status = 'paid' WHERE id = ?", [order.orderId]);
    const missingPickup = await admin.request(`/admin/order-items/${itemId}/pickup`, { method: 'PUT' });
    assert.equal(missingPickup.status, 409); assert.match(await missingPickup.text(), /Übergabeprotokoll/);
    assert.equal((await queryRows('SELECT item_status FROM rental_order_items WHERE id = ?', [itemId]))[0].item_status, 'active');

    assert.equal((await customer.request(endpoint)).status, 403);
    assert.equal((await new SessionClient().request(endpoint)).status, 401);
    const sharp = require('sharp');
    const png = await sharp(Buffer.from('<svg width="400" height="120"><rect width="400" height="120" fill="white"/><path d="M20 80 L80 30 L140 90 L220 35 L350 70" fill="none" stroke="black" stroke-width="5"/></svg>')).png().toBuffer();
    const photo = `data:image/png;base64,${png.toString('base64')}`;
    const payload = { revision: 0, entries: [{ itemId, kind: 'scratch', text: 'Kratzer links am Gehäuse', photos: [photo, photo] }, { itemId, kind: 'note', text: 'Zubehör vollständig', photos: [] }], noDamage: false };
    const save = async body => { const form = new FormData(); form.append('payload', JSON.stringify(body)); return admin.request(endpoint, { method: 'POST', body: form }); };
    let response = await save(payload); assert.equal(response.status, 200, await response.clone().text());
    const draft = await (await admin.request(endpoint)).json();
    assert.equal(draft.revision, 1); assert.equal(draft.document.entries[0].photos.length, 2);
    assert.equal((await save(payload)).status, 409, 'veraltete Revision wird abgewiesen');
    assert.equal((await save({ ...payload, revision: 1, finalize: true })).status, 400, 'Unterschrift ist Pflicht');
    assert.equal((await save({ ...payload, revision: 1, entries: [{ ...payload.entries[0], itemId: 999999 }] })).status, 400);
    response = await admin.request(`/admin/order-items/${itemId}/pickup`, { method: 'PUT' });
    assert.equal(response.status, 409); assert.match(await response.text(), /Übergabeprotokoll/);
    // Removing a photo before signing is allowed and the signed PDF uses the final snapshot.
    const finalPayload = { ...payload, revision: 1, finalize: true, confirmed: true, signer: 'Testkunde (Testunterschrift)', signature: photo,
        entries: [{ ...payload.entries[0], photos: [photo] }, payload.entries[1]] };
    const responses = await Promise.all([save(finalPayload), save(finalPayload)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const report = await (await admin.request(endpoint)).json();
    assert.equal(report.status, 'signed'); assert.equal(report.document.entries[0].photos.length, 1);
    response = await admin.request(`${endpoint}/pdf`); assert.equal(response.status, 200);
    const pdf = Buffer.from(await response.arrayBuffer()); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await customer.request(`${endpoint}/pdf`)).status, 403);
    assert.equal((await save({ ...payload, revision: 2 })).status, 409);
    const mails = await execute('SELECT payload_json FROM external_effects_outbox WHERE operation_key = ?', [`mail-handover-${order.orderId}`]);
    assert.equal(mails.length, 1);
    const mail = typeof mails[0].payload_json === 'string' ? JSON.parse(mails[0].payload_json) : mails[0].payload_json;
    assert.equal(mail.message.to, TEST_CUSTOMER.email);
    assert.equal(mail.message.handoverPdf.contentBytes, pdf.toString('base64'));
    // The persisted PDF does not depend on later order edits or outbox retention.
    await execute('UPDATE rental_orders SET customer_first_name = ? WHERE id = ?', ['Später geändert', order.orderId]);
    const unchanged = Buffer.from(await (await admin.request(`${endpoint}/pdf`)).arrayBuffer());
    assert.deepEqual(unchanged, pdf);
    const signedDetails = await (await admin.request(`/admin/orders/${order.orderId}`)).json();
    assert.equal(signedDetails.handoverStatus, 'signed');
    const allowedPickup = await admin.request(`/admin/order-items/${itemId}/pickup`, { method: 'PUT' });
    assert.equal(allowedPickup.status, 200, await allowedPickup.text());
    assert.equal((await queryRows('SELECT item_status FROM rental_order_items WHERE id = ?', [itemId]))[0].item_status, 'picked_up');

});

test('Gutscheine: Adminrechte, Ablauf, deaktivierte Codes und veränderte Vorschau werden geprüft', async () => {
    const admin = new SessionClient(), customer = new SessionClient(); await login(admin, TEST_ADMIN); await login(customer, TEST_CUSTOMER);
    assert.equal((await customer.request('/admin/coupons')).status, 403);
    const id = await createTestCoupon(admin, 'VALIDATE10', 10);
    await createTestCoupon(admin, 'EXPIRED10', 10, { validUntil: '2020-01-01' });
    await createTestCoupon(admin, 'FUTURE10', 10, { validFrom: '2099-01-01' });
    await createTestCoupon(admin, 'DISABLED10', 10, { active: false });
    await addCartItem(customer, futureDate(900), futureDate(901));
    for (const code of ['EXPIRED10', 'FUTURE10', 'DISABLED10', 'UNKNOWN10']) {
        const response = await customer.request('/cart/coupon-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }); assert.equal(response.status, 400);
    }
    const quote = await previewTestCoupon(customer, ' validate10 '); assert.equal(quote.totals.discountAmount, 16); assert.equal(quote.totals.depositTotal, 300); assert.equal(quote.totals.grandTotalBeforeDepositReturn, 444);
    const update = await admin.request(`/admin/coupons/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'VALIDATE10', percent: 20, active: true, validFrom: null, validUntil: null, revision: 1 }) }); assert.equal(update.status, 200);
    assert.equal((await submitCouponOrder(customer, quote)).status, 409);
    const fresh = await previewTestCoupon(customer, 'VALIDATE10'); assert.equal(fresh.totals.grandTotalBeforeDepositReturn, 428);
    const response = await submitCouponOrder(customer, fresh); assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    const [order] = await queryRows('SELECT coupon_code, discount_amount, total_amount FROM rental_orders WHERE id = ?', [result.orderId]); assert.equal(Number(order.discount_amount), 32); assert.equal(Number(order.total_amount), 428);
});

test('Gutscheine: Zahlung vor Ort, Verlängerung und Rückgabe behalten die volle Kaution', async () => {
    const admin = new SessionClient(), customer = new SessionClient(); await login(admin, TEST_ADMIN); await login(customer, TEST_CUSTOMER);
    await createTestCoupon(admin, 'RENTAL10', 10);
    const start = futureDate(910), end = futureDate(911), extended = futureDate(912);
    await addCartItem(customer, start, end); const quote = await previewTestCoupon(customer, 'RENTAL10');
    const response = await submitCouponOrder(customer, quote); assert.equal(response.status, 200); const { orderId } = await response.json();
    let result = await admin.request('/admin/order-payments/manual', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId, paymentType: 'initial_payment', amount: 444 }) }); assert.equal(result.status, 200, await result.text());
    const [item] = await queryRows('SELECT * FROM rental_order_items WHERE order_id = ?', [orderId]); assert.equal(Number(item.discount_amount), 16); assert.equal(Number(item.deposit), 300);
    const receipts = await receiptMails(orderId); assert.equal(receipts[0].receipt.items[0].rental, 144); assert.equal(receipts[0].receipt.items[0].discountAmount, 16);
    await signHandoverBeforePickup(admin, item.id); result = await admin.request(`/admin/order-items/${item.id}/pickup`, { method: 'PUT' }); assert.equal(result.status, 200);
    result = await admin.request(`/admin/order-items/${item.id}/rental-adjustment`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adjustedRentalStart: start, adjustedRentalEnd: extended, adjustedPricePerDay: 80 }) }); assert.equal(result.status, 200, await result.text());
    const [adjustment] = await queryRows("SELECT amount FROM rental_order_payments WHERE order_id = ? AND payment_type = 'rental_adjustment'", [orderId]); assert.equal(Number(adjustment.amount), 80);
    result = await admin.request('/admin/order-payments/manual', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId, orderItemId: item.id, paymentType: 'rental_adjustment', amount: 80 }) }); assert.equal(result.status, 200, await result.text());
    result = await admin.request(`/admin/order-items/${item.id}/return`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actualReturnDate: extended, adjustedRentalStart: start, adjustedRentalEnd: extended, adjustedPricePerDay: 80, isDamaged: false, additionalChargeAmount: 0 }) }); assert.equal(result.status, 200, await result.text());
    const [returned] = await queryRows('SELECT deposit_refund_amount, adjusted_rental_total FROM rental_order_items WHERE id = ?', [item.id]); assert.equal(Number(returned.deposit_refund_amount), 300); assert.equal(Number(returned.adjusted_rental_total), 224);
});

test('Gutscheine: Online-Zahlungsbetrag, Mollie-Positionen und Teilstorno berücksichtigen gespeicherte Rabatte', async () => {
    const admin = new SessionClient(), customer = new SessionClient(); await login(admin, TEST_ADMIN); await login(customer, TEST_CUSTOMER);
    const couponId = await createTestCoupon(admin, 'ONLINE10', 10);
    await addCartItem(customer, futureDate(920), futureDate(921)); await addCartItem(customer, futureDate(925), futureDate(926));
    const quote = await previewTestCoupon(customer, 'ONLINE10'); assert.equal(quote.totals.grandTotalBeforeDepositReturn, 888);
    const response = await submitCouponOrder(customer, quote, 'online'); assert.ok([200, 202].includes(response.status)); const { orderId } = await response.json();
    await waitForDatabaseRow('SELECT mollie_payment_id FROM rental_orders WHERE id = ?', [orderId], row => Boolean(row.mollie_payment_id), 'Online-Gutscheinzahlung');
    const [payment] = await queryRows("SELECT amount FROM rental_order_payments WHERE order_id = ? AND payment_type = 'initial_payment'", [orderId]); assert.equal(Number(payment.amount), 888);
    const connection = await require('mysql2/promise').createConnection(require('../../config/db'));
    try { const details = await require('../../services/molliePaymentDetails').captureMolliePaymentDetails(connection, { id: orderId, type: 'order_payment', totalAmount: 888 }); assert.deepEqual(details.lines.map(line => Number(line.totalAmount.value)), [144, 300, 144, 300]); } finally { await connection.end(); }
    const paidId = `tr_test_paid_coupon_${orderId}`;
    await execute('UPDATE rental_orders SET mollie_payment_id = ? WHERE id = ?', [paidId, orderId]); await execute('UPDATE rental_order_payments SET mollie_payment_id = ? WHERE order_id = ?', [paidId, orderId]);
    await customer.request('/webhooks/mollie', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: paidId }) });
    await admin.request(`/admin/coupons/${couponId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'ONLINE10', percent: 99, active: false, validFrom: null, validUntil: null, revision: 1 }) });
    const items = await queryRows('SELECT id FROM rental_order_items WHERE order_id = ? ORDER BY id', [orderId]);
    const cancelled = await admin.request(`/admin/order-items/${items[0].id}/cancel`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Gutschein-Teilstornotest' }) }); assert.equal(cancelled.status, 200, await cancelled.text());
    const refund = await waitForDatabaseRow("SELECT amount, payment_status FROM rental_order_payments WHERE order_id = ? AND order_item_id = ? AND payment_type = 'order_cancellation_refund'", [orderId, items[0].id], row => row.payment_status === 'paid', 'rabattierte Teilerstattung'); assert.equal(Number(refund.amount), -444);
    const [remaining] = await queryRows('SELECT total_amount FROM rental_orders WHERE id = ?', [orderId]); assert.equal(Number(remaining.total_amount), 444);
});

test('Gutscheine: 100 Prozent ohne Kaution bestätigt eine Bestellung ohne Mollie-Zahlungsauftrag', async () => {
    const admin = new SessionClient(), customer = new SessionClient(); await login(admin, TEST_ADMIN); await login(customer, TEST_CUSTOMER);
    await createTestCoupon(admin, 'FREE100', 100);
    await execute('UPDATE rental_products SET deposit = 0 WHERE id = ?', [TEST_PRODUCT.id]);
    try {
        await addCartItem(customer, futureDate(940), futureDate(941)); const quote = await previewTestCoupon(customer, 'FREE100'); assert.equal(quote.totals.grandTotalBeforeDepositReturn, 0);
        const response = await submitCouponOrder(customer, quote, 'online'); assert.equal(response.status, 200, await response.clone().text()); const { orderId, amountDue } = await response.json(); assert.equal(amountDue, 0);
        const [order] = await queryRows('SELECT payment_status, mollie_payment_id FROM rental_orders WHERE id = ?', [orderId]); assert.equal(order.payment_status, 'paid'); assert.equal(order.mollie_payment_id, null);
        const requests = await queryRows('SELECT id FROM external_effects_outbox WHERE operation_key = ?', [`initial-order-payment-${orderId}`]); assert.equal(requests.length, 0);
        const mails = await receiptMails(orderId);
        assert.match(mails[0].html, /keine Zahlung erforderlich/);
        assert.doesNotMatch(mails[0].html, /Onlinezahlung steht noch aus/);
    } finally { await execute('UPDATE rental_products SET deposit = ? WHERE id = ?', [TEST_PRODUCT.deposit, TEST_PRODUCT.id]); }
});
