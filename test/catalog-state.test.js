'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { requestCache } = require('../public/js/catalog-state');
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
