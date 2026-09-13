'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { parseTrustProxy } = require('../config/proxy');

const appSource = fs.readFileSync(path.resolve(__dirname, '../segnitz_rental.js'), 'utf8');
const fixtureSource = fs.readFileSync(path.resolve(__dirname, 'integration/app.integration.test.js'), 'utf8');

async function exerciseClients(trustProxy) {
    const limiterStart = appSource.indexOf('const accountMutationLimiter =');
    const limiterEnd = appSource.indexOf('const adminReturnMutationLimiter =', limiterStart);
    const limiter = vm.runInNewContext(`${appSource.slice(limiterStart, limiterEnd)}; accountMutationLimiter`, { rateLimit });
    const app = express();
    app.set('trust proxy', parseTrustProxy({ TRUST_PROXY: trustProxy }));
    app.get('/limited', limiter, (req, res) => res.json({ ip: req.ip }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const clientStart = fixtureSource.indexOf('class SessionClient {');
        const clientEnd = fixtureSource.indexOf('\nfunction futureDate(', clientStart);
        const SessionClient = vm.runInNewContext(`${fixtureSource.slice(clientStart, clientEnd)}; SessionClient`, {
            Headers, fetch, assert, nextClientAddress: 1, readSessionCookie: () => null,
            BASE_URL: `http://127.0.0.1:${server.address().port}`
        });
        const first = new SessionClient();
        for (let attempt = 0; attempt < 5; attempt++) {
            assert.equal((await first.request('/limited')).status, 200);
        }
        const limited = await first.request('/limited');
        assert.equal(limited.status, 429);
        assert.ok(Number(limited.headers.get('retry-after')) > 0);
        const second = new SessionClient();
        return (await second.request('/limited')).status;
    } finally { await new Promise(resolve => server.close(resolve)); }
}

test('isolated app clients retain the real five-attempt limit through the explicit local test proxy', async () => {
    assert.equal(await exerciseClients('127.0.0.1/32,::1/128'), 200);
    // Merely sending a new forwarded address cannot bypass a direct/untrusted deployment.
    assert.equal(await exerciseClients('203.0.113.0/24'), 429);
});
