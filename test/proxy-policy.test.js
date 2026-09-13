'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { parseTrustProxy } = require('../config/proxy');

test('production requires an explicit proxy policy and rejects blanket trust', () => {
    assert.throws(() => parseTrustProxy({ NODE_ENV: 'production' }), /TRUST_PROXY/);
    for (const value of ['true', '*', '99', '127.0.0.1/33', '::1/129', 'proxy.example', 'loopback,']) {
        assert.throws(() => parseTrustProxy({ TRUST_PROXY: value }), /TRUST_PROXY/);
    }
    assert.equal(parseTrustProxy({}), false);
    assert.equal(parseTrustProxy({ TRUST_PROXY: '0' }), false);
    assert.equal(parseTrustProxy({ TRUST_PROXY: '1' }), 1);
    assert.deepEqual(parseTrustProxy({ TRUST_PROXY: '127.0.0.1/32,::1/128' }), ['127.0.0.1/32', '::1/128']);
});

async function probe(policy) {
    const app = express();
    app.set('trust proxy', parseTrustProxy({ TRUST_PROXY: policy }));
    app.get('/', (req, res) => res.json({ ip: req.ip, secure: req.secure }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {
            headers: { 'x-forwarded-for': '203.0.113.20', 'x-forwarded-proto': 'https' }
        });
        return response.json();
    } finally { await new Promise(resolve => server.close(resolve)); }
}

test('forwarded IP and HTTPS are accepted only from a configured trusted peer', async () => {
    assert.deepEqual(await probe('0'), { ip: '127.0.0.1', secure: false });
    assert.deepEqual(await probe('192.0.2.0/24'), { ip: '127.0.0.1', secure: false });
    assert.deepEqual(await probe('loopback'), { ip: '203.0.113.20', secure: true });
});
