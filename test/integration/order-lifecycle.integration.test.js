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
    TEST_PRODUCT
} = require('../support/order-lifecycle-database');

const PORT = Number(process.env.LIFECYCLE_TEST_PORT || 3103);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_MOLLIE_API_KEY = 'test_abcdefghijklmnopqrstuvwxyz1234';
let serverProcess;
let serverOutput = '';

class SessionClient {
    constructor() {
        this.cookie = '';
    }

    async request(pathname, options = {}) {
        const headers = new Headers(options.headers || {});

        if (this.cookie) {
            headers.set('cookie', this.cookie);
        }

        const response = await fetch(`${BASE_URL}${pathname}`, {
            ...options,
            headers
        });

        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
            this.cookie = setCookie.split(';', 1)[0];
        }

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
                { name: 'Signature', value: 'data:image/png;base64,dGVzdA==' }
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

async function login(client, account) {
    const response = await client.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username: account.email,
            password: account.password
        })
    });

    assert.equal(response.status, 200, await response.text());
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
    assert.equal(response.status, 200, JSON.stringify(body));

    return body;
}

before(async () => {
    await resetOrderLifecycleDatabase();

    serverProcess = spawn(process.execPath, ['segnitz_rental.js'], {
        cwd: path.resolve(__dirname, '../..'),
        env: {
            ...process.env,
            PORT: String(PORT),
            BASE_URL,
            NODE_ENV: 'test',
            DISABLE_PERIODIC_CLEANUP: '1',
            DISABLE_EMAILS: '1',
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

test('schließt eine Barzahlungs-Bestellung ab und persistiert Miete sowie Kaution', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);

    const rentalStart = futureDate(10);
    const rentalEnd = futureDate(12);
    const order = await createOrder(customer, 'cash', rentalStart, rentalEnd);

    assert.equal(order.message, 'Bestellung erfolgreich reserviert.');
    assert.ok(order.orderId > 0);
    assert.match(order.orderNo, /^R\d{9}$/);

    const [storedOrder] = await queryRows(
        `SELECT status, payment_method, payment_status, total_amount
         FROM rental_orders
         WHERE id = ?`,
        [order.orderId]
    );

    assert.equal(storedOrder.status, 'reserved');
    assert.equal(storedOrder.payment_method, 'cash');
    assert.equal(storedOrder.payment_status, 'pending');
    assert.equal(Number(storedOrder.total_amount), 540);

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

test('verarbeitet Online-Zahlung, Mollie-Webhook und vollständigen Storno-Refund idempotent', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);

    const order = await createOrder(
        customer,
        'online',
        futureDate(20),
        futureDate(21)
    );

    assert.equal(order.message, 'Online-Zahlung wurde vorbereitet.');
    assert.match(order.checkoutUrl, /^https:\/\/checkout\.test\.mollie\.local\//);

    const [pendingOrder] = await queryRows(
        `SELECT payment_method, payment_status, mollie_payment_id
         FROM rental_orders WHERE id = ?`,
        [order.orderId]
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

    const [refund] = await queryRows(
        `SELECT payment_status, amount, mollie_payment_id, mollie_refund_id
         FROM rental_order_payments
         WHERE order_id = ? AND payment_type = 'order_cancellation_refund'`,
        [order.orderId]
    );

    assert.equal(refund.payment_status, 'paid');
    assert.equal(Number(refund.amount), -460);
    assert.equal(refund.mollie_payment_id, paidPaymentId);
    assert.match(refund.mollie_refund_id, /^re_test_paid_/);
});

test('kassiert Barzahlung, blockiert vorzeitige Abholung und verarbeitet Rückgabe mit Kautionsauszahlung', async () => {
    const customer = new SessionClient();
    await login(customer, TEST_CUSTOMER);

    const rentalStart = futureDate(30);
    const rentalEnd = futureDate(31);
    const order = await createOrder(customer, 'cash', rentalStart, rentalEnd);

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
            note: 'Automatischer CI-Barzahlungstest'
        })
    });
    assert.equal(paymentResponse.status, 200, await paymentResponse.text());

    const pickupResponse = await admin.request(`/admin/order-items/${item.id}/pickup`, {
        method: 'PUT'
    });
    assert.equal(pickupResponse.status, 200, await pickupResponse.text());

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

    const [returnedOrder] = await queryRows(
        `SELECT status, return_status, return_case_status, payment_status
         FROM rental_orders WHERE id = ?`,
        [order.orderId]
    );
    assert.equal(returnedOrder.status, 'returned');
    assert.equal(returnedOrder.return_status, 'returned_ok');
    assert.equal(returnedOrder.return_case_status, 'closed');
    assert.equal(returnedOrder.payment_status, 'paid');

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
});
