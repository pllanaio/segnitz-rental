'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { productMatchesSearch } = require('../frontend/lib/shop.js');

const categoryNames = product => product.categories || [];

test('Artikelsuche kombiniert Merkmale, deutsche Zahlen und Umlautschreibweisen', () => {
    const product = { title: 'Bagger', manufacturer: 'Liebherr', model: 'T282', color: 'grün', power_value: 3500, power_unit: 'PS', operating_hours: 1000, mileage_km: 0, categories: ['Baumaschinen'] };
    for (const query of ['Liebherr grün', 'gruen T282', '3.500 PS', '1000 Betriebsstunden', '0 km', 'Baumaschinen']) {
        assert.equal(productMatchesSearch(product, query, categoryNames), true, query);
    }
    assert.equal(productMatchesSearch(product, 'Liebherr rot', categoryNames), false);
    assert.equal(productMatchesSearch({}, 'undefined', categoryNames), false);
});
