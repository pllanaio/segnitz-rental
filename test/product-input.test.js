'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    PRODUCT_INPUT_LIMITS,
    validateProductInput
} = require('../utils/productInput');

test('normalisiert gültige Produkttexte und Kategorien', () => {
    const result = validateProductInput({
        productKey: '  bagger-1  ',
        title: '  Minibagger  ',
        description: 'Beschreibung',
        imagePath: 'img/products/bagger.webp',
        categories: ['  Baumaschinen   kompakt ', 'Werkzeug']
    }, { requireProductKey: true });

    assert.deepEqual(result, {
        value: {
            productKey: 'bagger-1',
            title: 'Minibagger',
            description: 'Beschreibung',
            imagePath: 'img/products/bagger.webp',
            categories: ['Baumaschinen kompakt', 'Werkzeug']
        }
    });
});

test('weist Produktfelder vor einem Datenbankfehler mit 400-tauglicher Meldung ab', () => {
    const tooLongKey = validateProductInput({
        productKey: 'k'.repeat(PRODUCT_INPUT_LIMITS.productKey + 1),
        title: 'Produkt'
    }, { requireProductKey: true });
    const tooLongTitle = validateProductInput({
        title: 't'.repeat(PRODUCT_INPUT_LIMITS.title + 1)
    });
    const tooLongCategory = validateProductInput({
        title: 'Produkt',
        categories: ['c'.repeat(PRODUCT_INPUT_LIMITS.category + 1)]
    });

    assert.match(tooLongKey.error, /Produkt-Key/u);
    assert.match(tooLongTitle.error, /Titel/u);
    assert.match(tooLongCategory.error, /Kategorien/u);
});

test('begrenzt Beschreibungen nach MySQL-Bytes statt nur Zeichen', () => {
    const result = validateProductInput({
        title: 'Produkt',
        description: '🚀'.repeat(Math.ceil(PRODUCT_INPUT_LIMITS.descriptionBytes / 4))
    });

    assert.match(result.error, /beschreibung/ui);
});

test('unterscheidet einen ausgelassenen Bildpfad vom expliziten Leeren', () => {
    assert.equal(validateProductInput({ title: 'Produkt' }).value.imagePath, undefined);
    assert.equal(validateProductInput({ title: 'Produkt', imagePath: '' }).value.imagePath, '');
});

test('Produktupdates bewahren ausgelassene Legacy-Bildpfade', () => {
    const routes = fs.readFileSync(
        path.resolve(__dirname, '../routes/productRoutes.js'),
        'utf8'
    );

    assert.match(routes, /image_path\s*=\s*COALESCE\(\?,\s*image_path\)/u);
    assert.match(routes, /imagePath\s*\?\?\s*null/u);
});
