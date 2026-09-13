'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseCatalogQuery, readCatalogPage } = require('../services/catalogService');

test('catalog validates bounded page parameters and preserves normalized Unicode', () => {
    assert.deepEqual(parseCatalogQuery({ q: "  SA\u0308GE / O'Connor 100%_  ", category: ' Werkzeuge ' }), {
        page: 1, pageSize: 12, q: "säge / o'connor 100%_", category: 'werkzeuge'
    });
    assert.equal(parseCatalogQuery({ pageSize: '100' }).pageSize, 100);
    for (const query of [{ page: '0' }, { page: '1.5' }, { page: '10001' }, { pageSize: '101' }, { pageSize: '0' }, { q: ['a', 'b'] }, { category: {} }, { q: 'a\u0000b' }, { q: 'a'.repeat(121) }]) {
        assert.throws(() => parseCatalogQuery(query), { statusCode: 400 });
    }
});

test('catalog returns only one page and scopes image/category hydration to those IDs', async () => {
    const calls = [];
    const results = [
        [{ total: 25 }],
        [{ id: 4, title: 'Säge', image_path: '', category: '', is_active: 1 }],
        [{ product_id: 4, id: 8, image_path: 'img/products/one.webp' }],
        [{ product_id: 4, id: 7, name: 'Werkzeuge', slug: 'werkzeuge' }],
        [{ name: 'Werkzeuge', count: 25 }],
        [{ total: 25 }]
    ];
    const execute = async (sql, params = []) => { calls.push({ sql, params }); return [results.shift()]; };
    const page = await readCatalogPage({ execute }, parseCatalogQuery({ page: '2', pageSize: '12', q: "100%_' OR 1=1 --", category: 'Werkzeuge' }));
    assert.deepEqual(page.pagination, { page: 2, pageSize: 12, total: 25, totalPages: 3 });
    assert.equal(page.products.length, 1);
    assert.deepEqual(page.products[0].images, [{ id: 8, path: 'img/products/one.webp' }]);
    assert.equal(page.products[0].categories[0].name, 'Werkzeuge');
    assert.match(calls[1].sql, /LIMIT 12 OFFSET 12$/);
    assert.deepEqual(calls[1].params, calls[0].params);
    assert.deepEqual(calls[2].params, [4]);
    assert.deepEqual(calls[3].params, [4]);
    assert.ok(calls.every(call => !call.sql.includes("OR 1=1 --")));
    assert.ok(calls[0].params.some(value => value === "%100!%!_' or 1=1 --%"));
});

test('empty catalog pages never issue unscoped hydration queries', async () => {
    const queries = [];
    const results = [[{ total: 0 }], [], [], [{ total: 0 }]];
    const execute = async sql => { queries.push(sql); return [results.shift()]; };
    const page = await readCatalogPage({ execute }, parseCatalogQuery({ q: 'unbekannt' }));
    assert.equal(page.pagination.total, 0);
    assert.deepEqual(page.products, []);
    assert.ok(queries.every(sql => !sql.includes('FROM rental_product_images')));
    assert.equal(queries.length, 4);
});
