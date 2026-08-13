'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    CUSTOMER_FIELD_LIMITS,
    hasValidCustomerFieldLengths,
    isValidEmail,
    isValidPassword,
    isValidSignatureDataUrl,
    normalizeEmail
} = require('../utils/inputValidation');

function validCustomer(overrides = {}) {
    return {
        firstName: 'Erika',
        lastName: 'Mustermann',
        company: '',
        phone: '0123456789',
        address: 'Testweg 1',
        zip: '97070',
        city: 'Wuerzburg',
        ...overrides
    };
}

test('validiert E-Mail-Adressen vor der Musterprüfung mit festen Längengrenzen', () => {
    assert.equal(normalizeEmail('  KUNDE@Example.COM '), 'kunde@example.com');
    assert.equal(isValidEmail('kunde@example.com'), true);
    assert.equal(isValidEmail(`a@${'b'.repeat(250)}.de`), false);
    assert.equal(isValidEmail(`${'a'.repeat(1000000)}@example.com`), false);
    assert.equal(isValidEmail('zwei@@example.com'), false);
    assert.equal(isValidEmail('kunde@example'), false);
});

test('begrenzt sämtliche Kundendaten passend zu den Schema-Spalten', () => {
    assert.equal(hasValidCustomerFieldLengths(validCustomer()), true);

    for (const [field, maxLength] of Object.entries(CUSTOMER_FIELD_LIMITS)) {
        assert.equal(
            hasValidCustomerFieldLengths(validCustomer({ [field]: 'x'.repeat(maxLength + 1) })),
            false,
            `${field} muss bei ${maxLength + 1} Zeichen abgelehnt werden`
        );
    }
});

test('begrenzt Passwörter auf die von bcrypt vollständig verarbeiteten 72 Bytes', () => {
    assert.equal(isValidPassword('SicheresPasswort1!'), true);
    assert.equal(isValidPassword('ohneSonderzeichen1'), false);
    assert.equal(isValidPassword('ohnezahl!'), false);
    assert.equal(isValidPassword(`A1!${'x'.repeat(70)}`), false);
    assert.equal(isValidPassword(`A1!${'ä'.repeat(35)}`), false);
});

test('begrenzt Signaturdaten vor der Base64-Prüfung', () => {
    assert.equal(isValidSignatureDataUrl('data:image/png;base64,dGVzdA=='), true);
    assert.equal(isValidSignatureDataUrl('data:image/svg+xml;base64,dGVzdA=='), false);
    assert.equal(isValidSignatureDataUrl(`data:image/png;base64,${'A'.repeat(800000)}`), false);
});
