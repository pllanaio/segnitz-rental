'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/frontend_config.js'), 'utf8');
const context = { getProductCategoryNames: product => product.categories || [] };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function normalizeProductSearch('), source.indexOf('function applyProductFilters(')), context);
test('Artikelsuche kombiniert Merkmale, deutsche Zahlen und Umlautschreibweisen', () => {
    const product = { title: 'Bagger', manufacturer: 'Liebherr', model: 'T282', color: 'grün', power_value: 3500, power_unit: 'PS', operating_hours: 1000, mileage_km: 0, categories: ['Baumaschinen'] };
    for (const query of ['Liebherr grün', 'gruen T282', '3.500 PS', '1000 Betriebsstunden', '0 km', 'Baumaschinen']) {
        assert.equal(context.productMatchesSearch(product, query), true, query);
    }
    assert.equal(context.productMatchesSearch(product, 'Liebherr rot'), false);
    assert.equal(context.productMatchesSearch({}, 'undefined'), false);
});
