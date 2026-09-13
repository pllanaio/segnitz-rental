'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
test('Produktsuche wird mit Kategorie kombiniert', () => {
    const source = fs.readFileSync('public/js/frontend_config.js', 'utf8');
    const start = source.indexOf('function applyProductFilters()');
    const end = source.indexOf('\nfunction ', start + 1);
    const context = { selectedCategory: 'Werkzeuge', rentalProducts: [{ id: 1, title: 'Bohrhammer', categories: ['Werkzeuge'] }, { id: 2, title: 'Säge', categories: ['Werkzeuge'] }, { id: 3, title: 'Bohrhammer', categories: ['Andere'] }], document: { getElementById: () => ({ value: 'BOHR' }) }, getProductCategoryNames: product => product.categories, renderCategoryFilters() {}, renderProductPage() {}, updateProductSectionTitle() {}, renderBestsellers() {} };
    context.window = context;
    if (fs.existsSync('public/js/catalog-state.js')) vm.runInNewContext(fs.readFileSync('public/js/catalog-state.js', 'utf8'), context);
    vm.runInNewContext(source.slice(start, end) + '\napplyProductFilters();', context);
    assert.equal(JSON.stringify(context.filteredRentalProducts.map(product => product.id)), '[1]');
});
