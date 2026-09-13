'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { jsonErrors } = require('../middleware/jsonErrors');

test('database saturation and deadlines produce bounded JSON 503 without error details', async () => {
    const app = express();
    app.get('/:code', (req, res, next) => next(Object.assign(new Error('internal-private-detail'), {
        code: req.params.code, sql: 'private SQL', status: 503
    })));
    app.use(jsonErrors);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        for (const code of ['DB_QUEUE_FULL', 'DB_ACQUIRE_TIMEOUT', 'DB_QUERY_TIMEOUT', 'DB_TRANSACTION_TIMEOUT', 'ECONNREFUSED']) {
            const response = await fetch(`http://127.0.0.1:${server.address().port}/${code}`);
            assert.equal(response.status, 503);
            assert.equal(response.headers.get('retry-after'), '2');
            const body = await response.json();
            assert.equal(JSON.stringify(body).includes('private'), false);
            assert.equal(body.code, 'SERVICE_UNAVAILABLE');
        }
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('catalog route preserves database capacity failure as JSON 503', async () => {
    const router = require('../routes/productRoutes');
    const mysql = require('mysql2/promise');
    const original = mysql.createConnection;
    mysql.createConnection = async () => { throw Object.assign(new Error('private capacity detail'), { code: 'DB_QUEUE_FULL' }); };
    const app = express();
    app.use(router);
    app.use(jsonErrors);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/categories`);
        assert.equal(response.status, 503);
        assert.equal(JSON.stringify(await response.json()).includes('private'), false);
    } finally {
        mysql.createConnection = original;
        await new Promise(resolve => server.close(resolve));
    }
});
