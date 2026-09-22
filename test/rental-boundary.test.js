'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isActualReturnDay, isAgreedRentalPrice, isBookableRentalPeriod } = require('../utils/rentalBoundary');

test('Erstcheckout und Retry verwenden denselben Berliner Geschäftstag', () => {
    const midnight = new Date('2026-10-24T22:30:00.000Z');
    assert.equal(isBookableRentalPeriod('2026-10-24', '2026-10-26', midnight), false);
    assert.equal(isBookableRentalPeriod('2026-10-25', '2026-10-26', midnight), true);
    assert.equal(isBookableRentalPeriod('2026-10-26', '2026-10-25', midnight), false);
    assert.equal(isBookableRentalPeriod('2026-02-30', '2026-03-01', midnight), false);
});
test('tatsächliche Rückgabe darf nie in der Zukunft liegen', () => {
    const now = new Date('2026-03-28T23:30:00.000Z');
    assert.equal(isActualReturnDay('2026-03-29', now), true);
    assert.equal(isActualReturnDay('2026-03-30', now), false);
    assert.equal(isActualReturnDay('2026-02-30', now), false);
});
test('bestehende Nullpreise bleiben erlaubt; negative/ungültige Preise nicht', () => {
    assert.equal(isAgreedRentalPrice(0), true);
    assert.equal(isAgreedRentalPrice('0.00'), true);
    assert.equal(isAgreedRentalPrice('-0.01'), false);
    assert.equal(isAgreedRentalPrice('NaN'), false);
});
