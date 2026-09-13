'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isSafeAddress, isValidPhone, isValidPostalCode } = require('../utils/inputValidation');
test('gültige internationale Adressen bleiben unverändert akzeptiert', () => {
    for (const address of ["Jean-Paul-Str. 12/3", "Rue de l’Église 7", "O'Connell St. 4", 'улица Ленина 12', '東京都千代田区丸の内1-1']) assert.equal(isSafeAddress(address), true, address);
});
test('internationale Telefonnummern und Postcodes werden akzeptiert, Steuerzeichen abgelehnt', () => {
    for (const phone of ['+49 (0)931 123-456', '+44 20 7946 0958', '0041 44 668 18 00']) assert.equal(isValidPhone(phone), true);
    for (const phone of ['+49<script>', '+49\n12345', '1'.repeat(60)]) assert.equal(isValidPhone(phone), false);
    assert.equal(isValidPostalCode('SW1A 1AA'), true);
    assert.equal(isValidPostalCode('97070'), true);
    assert.equal(isSafeAddress('Testweg\u00001'), false);
    assert.equal(isSafeAddress('<script>alert(1)</script>'), false);
});
