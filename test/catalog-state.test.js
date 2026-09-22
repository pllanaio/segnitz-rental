'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { requestCache, latestRequest } = require('../public/js/catalog-state');
test('parallele und wiederholte Kartenanfragen werden bis zum TTL dedupliziert', async () => {
    let clock = 0; let calls = 0;
    const get = requestCache({ ttlMs: 100, now: () => clock });
    const fetcher = async () => { calls++; return { available: false }; };
    const results = await Promise.all([get('product-1', fetcher), get('product-1', fetcher)]);
    assert.deepEqual(results, [{ available: false }, { available: false }]);
    await get('product-1', fetcher);
    assert.equal(calls, 1);
    clock = 101;
    await get('product-1', fetcher);
    assert.equal(calls, 2);
});
test('fehlgeschlagene Verfügbarkeit wird nicht als frei gecacht und bleibt wiederholbar', async () => {
    const get = requestCache();
    await assert.rejects(get('p', async () => { throw new Error('503'); }));
    assert.deepEqual(await get('p', async () => ({ available: false })), { available: false });
});

test('new catalog search aborts old work and ignores out-of-order success or failure', async () => {
    const requests = latestRequest();
    let resolveOld; let oldSignal;
    const old = requests.run(signal => { oldSignal = signal; return new Promise(resolve => { resolveOld = resolve; }); });
    const current = requests.run(async () => ({ products: ['neue Suche'] }));
    assert.equal(oldSignal.aborted, true);
    assert.deepEqual(await current, { products: ['neue Suche'] });
    resolveOld({ products: ['veraltet'] });
    assert.equal(await old, null);
    let rejectOld;
    const failedOld = requests.run(() => new Promise((resolve, reject) => { rejectOld = reject; }));
    requests.cancel();
    rejectOld(new Error('verspäteter HTTP 503'));
    assert.equal(await failedOld, null);
    await assert.rejects(requests.run(async () => { throw new Error('aktueller HTTP 503'); }), /aktueller/);
});
