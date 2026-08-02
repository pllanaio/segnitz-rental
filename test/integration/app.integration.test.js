'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { after, before, test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const path = require('node:path');
const { resetTestDatabase, TEST_PRODUCT, TEST_USER } = require('../support/test-database');

const PORT = Number(process.env.TEST_PORT || 3101);
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

before(async () => {
    await resetTestDatabase();

    serverProcess = spawn(process.execPath, ['segnitz_rental.js'], {
        cwd: path.resolve(__dirname, '../..'),
        env: {
            ...process.env,
            PORT: String(PORT),
            NODE_ENV: 'test',
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
    const client = new SessionClient();

    const productsResponse = await client.request('/products');
    assert.equal(productsResponse.status, 200);

    const products = await productsResponse.json();
    assert.equal(products.length, 1);
    assert.equal(products[0].id, TEST_PRODUCT.id);
    assert.equal(products[0].title, TEST_PRODUCT.title);
    assert.deepEqual(products[0].categories, [
        { id: 1, name: 'Baumaschinen', slug: 'baumaschinen' }
    ]);

    const categoriesResponse = await client.request('/categories');
    assert.equal(categoriesResponse.status, 200);
    assert.deepEqual(await categoriesResponse.json(), [
        { id: 1, name: 'Baumaschinen', slug: 'baumaschinen' }
    ]);
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

test('übernimmt den Gast-Warenkorb nach erfolgreichem Kundenlogin', async () => {
    const client = new SessionClient();
    const rentalStart = futureDate(20);
    const rentalEnd = futureDate(21);

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

    const loginResponse = await client.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username: TEST_USER.email,
            password: TEST_USER.password
        })
    });

    assert.equal(loginResponse.status, 200);
    assert.deepEqual(await loginResponse.json(), {
        message: 'Login erfolgreich!',
        redirectTo: '/index.html'
    });

    const authResponse = await client.request('/auth-status');
    assert.deepEqual(await authResponse.json(), {
        loggedIn: true,
        user: TEST_USER.email,
        role: TEST_USER.role
    });

    const cartResponse = await client.request('/cart');
    const cart = await cartResponse.json();
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].title, TEST_PRODUCT.title);
});
