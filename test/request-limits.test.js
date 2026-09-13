'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const express = require('express');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const { parseTrustProxy } = require('../config/proxy');
const { registerHealthRoutes } = require('../services/healthRoutes');

const { createRequestLimitOptions } = require('../middleware/requestLimits');

async function fixture(environment = {}) {
    const app = express();
    app.set('trust proxy', parseTrustProxy({ TRUST_PROXY: 'loopback', ...environment }));
    const counters = { sessionReads: 0, writes: 0, readiness: 0 };
    const closeHealth = registerHealthRoutes(app, { environment,
        installationState: () => 'ready', readiness: async () => { counters.readiness++; return { sessionTimeZone: '+00:00' }; } });
    const policy = createRequestLimitOptions({ HTTP_RATE_LIMIT_MAX: '3', HTTP_RATE_LIMIT_GLOBAL_MAX: '20', ...environment });
    app.use(rateLimit(policy.global), rateLimit(policy.client));
    const store = new session.MemoryStore();
    const get = store.get.bind(store);
    store.get = (key, callback) => { counters.sessionReads++; get(key, callback); };
    app.use(express.json());
    app.use(session({ secret: 'isolated-rate-limit-session-fixture', store, resave: false, saveUninitialized: false }));
    app.post('/fixture-session', (req, res) => { req.session.user = 'fixture'; res.json({ ok: true }); });
    const stricter = rateLimit({ windowMs: 60000, limit: 1, standardHeaders: true, legacyHeaders: false,
        message: { error: 'Zu viele Login-Versuche.' } });
    app.post('/login', stricter, (req, res) => res.status(401).json({ error: 'Ungültige Anmeldung.' }));
    app.use((req, res) => { counters.writes++; res.json({ ok: true }); });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    return { counters, policy,
        request: (pathname, options = {}) => fetch(base + pathname, options),
        close: async () => { await new Promise(resolve => server.close(resolve)); policy.shutdown(); closeHealth(); }
    };
}

test('business requests are rejected before persisted session reads, parsing or expensive route work', async () => {
    const app = await fixture();
    try {
        const identity = { 'x-forwarded-for': '203.0.113.8' };
        const created = await app.request('/fixture-session', { method: 'POST', headers: identity });
        const cookie = created.headers.get('set-cookie').split(';')[0]; await created.json();
        for (const pathname of ['/products', '/cart']) {
            const response = await app.request(pathname, { headers: { ...identity, cookie } });
            assert.equal(response.status, 200); await response.json();
        }
        assert.equal(app.counters.sessionReads, 2);
        for (const pathname of ['/my-profile', '/admin/products', '/webhooks/mollie', '/img/returns/private']) {
            const response = await app.request(pathname, { method: 'POST', headers: { ...identity, cookie, 'content-type': 'application/json' }, body: '{malformed' });
            assert.equal(response.status, 429);
            assert.match(response.headers.get('retry-after'), /^\d+$/);
            assert.equal((await response.json()).code, 'REQUEST_RATE_LIMITED');
        }
        assert.equal(app.counters.sessionReads, 2);
        assert.equal(app.counters.writes, 2);
    } finally { await app.close(); }
});

test('global budget caps rotating identities before they can allocate more per-client keys', async () => {
    const app = await fixture({ HTTP_RATE_LIMIT_GLOBAL_MAX: '4' });
    try {
        const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => app.request('/products', {
            headers: { 'x-forwarded-for': `203.0.113.${i + 1}` }
        })));
        assert.equal(responses.filter(response => response.status === 200).length, 4);
        assert.equal(responses.filter(response => response.status === 429).length, 16);
        await Promise.all(responses.map(response => response.json()));
        assert.equal(app.counters.writes, 4);
        assert.equal(app.policy.client.store.current.size + app.policy.client.store.previous.size, 4);
    } finally { await app.close(); }
});

test('untrusted forwarded identities and IPv6 address rotation cannot evade the client quota', async () => {
    for (const environment of [{ TRUST_PROXY: '192.0.2.0/24' }, { TRUST_PROXY: 'loopback' }]) {
        const app = await fixture(environment);
        try {
            for (let i = 0; i < 5; i++) {
                const response = await app.request('/cart', { headers: { 'x-forwarded-for': `2001:db8:1:2::${i + 1}` } });
                assert.equal(response.status, i < 3 ? 200 : 429); await response.json();
            }
        } finally { await app.close(); }
    }
});

test('live bypasses exhaustion; ready and health share a bounded 503 quota without session access', async () => {
    const app = await fixture({ HTTP_RATE_LIMIT_GLOBAL_MAX: '1', READINESS_RATE_LIMIT_MAX: '2' });
    try {
        for (let i = 0; i < 2; i++) await (await app.request('/products')).json();
        for (let i = 0; i < 5; i++) {
            const live = await app.request('/live', { headers: { cookie: 'fixture=irrelevant' } });
            assert.equal(live.status, 200); await live.json();
            const ready = await app.request(i % 2 ? '/health' : '/ready');
            assert.equal(ready.status, i < 2 ? 200 : 503);
            if (i >= 2) assert.match(ready.headers.get('retry-after'), /^\d+$/);
            await ready.json();
        }
        assert.equal(app.counters.readiness, 2);
        assert.equal(app.counters.sessionReads, 0);
    } finally { await app.close(); }
});

test('window expiry restores admission and a downstream stricter auth limit remains effective', async () => {
    const app = await fixture({ HTTP_RATE_LIMIT_MAX: '2', HTTP_RATE_LIMIT_WINDOW_MS: '1000' });
    try {
        const first = await app.request('/login', { method: 'POST' }); assert.equal(first.status, 401); await first.json();
        const second = await app.request('/login', { method: 'POST' }); assert.equal(second.status, 429);
        assert.equal((await second.json()).error, 'Zu viele Login-Versuche.');
        const limited = await app.request('/products'); assert.equal(limited.status, 429); await limited.json();
        await delay(1100);
        const recovered = await app.request('/products'); assert.equal(recovered.status, 200); await recovered.json();
    } finally { await app.close(); }
});
