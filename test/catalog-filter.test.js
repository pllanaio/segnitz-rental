'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
test('Produktsuche mit Kategorie startet wieder bei der ersten Serverseite', () => {
    const source = fs.readFileSync('public/js/frontend_config.js', 'utf8');
    const start = source.indexOf('function applyProductFilters()');
    const end = source.indexOf('\nfunction ', start + 1);
    const requestedPages = [];
    const context = { selectedCategory: 'Werkzeuge', currentProductPage: 3, catalogFilterTimer: null, clearTimeout() {}, loadRentalProducts: page => requestedPages.push(page), updateProductSectionTitle() {}, renderBestsellers() {} };
    context.window = context;
    if (fs.existsSync('public/js/catalog-state.js')) vm.runInNewContext(fs.readFileSync('public/js/catalog-state.js', 'utf8'), context);
    vm.runInNewContext(source.slice(start, end) + '\napplyProductFilters();', context);
    assert.equal(context.currentProductPage, 1);
    assert.deepEqual(requestedPages, [1]);
    assert.equal(context.selectedCategory, 'Werkzeuge');
});
