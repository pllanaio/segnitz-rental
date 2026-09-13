'use strict';
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { after, before, test } = require('node:test');
const express = require('express');
const mysql = require('mysql2/promise');
const router = require('../routes/productRoutes');
let server; let url; let calls = 0; let original;
before(async () => {
    original = mysql.createConnection;
    mysql.createConnection = async () => { calls++; throw Object.assign(new Error('SYNTHETIC_PRIVATE_DB_DETAILS'), { code: 'DB_ACQUIRE_TIMEOUT' }); };
    const app = express(); app.use(router);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { mysql.createConnection = original; await new Promise(resolve => server.close(resolve)); });

test('invalid catalog query is rejected as JSON before acquiring a database connection', async () => {
    const before = calls;
    for (const query of ['pageSize=101', 'page=-1', 'q[]=a&q[]=b']) {
        const response = await fetch(`${url}/catalog?${query}`);
        assert.equal(response.status, 400);
        assert.match(response.headers.get('content-type'), /application\/json/);
        assert.match((await response.json()).error, /Ungültige Katalogsuche/);
    }
    assert.equal(calls, before);
});

test('catalog database exhaustion returns bounded generic JSON 503 with private cache policy', async () => {
    const response = await fetch(`${url}/catalog?q=saege`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('vary'), /Cookie/);
    assert.deepEqual(await response.json(), { error: 'Produkte konnten nicht geladen werden.' });
});
