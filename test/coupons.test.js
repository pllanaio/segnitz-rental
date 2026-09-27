'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateCoupon, applyCouponToSummary } = require('../services/couponService');
test('Gutscheine: normalisierte Codes, unbegrenzte Gültigkeit und sichere Grenzen', () => {
    const body = { code: ' sommer10 ', percent: 10, active: true, validFrom: null, validUntil: null };
    assert.equal(validateCoupon(body).code, 'SOMMER10');
    for (const percent of [-1, 0, 100.01, Infinity, 1.001]) assert.throws(() => validateCoupon({ ...body, percent }));
    assert.throws(() => validateCoupon({ ...body, validUntil: '2026-02-30' }));
    assert.throws(() => validateCoupon({ ...body, validFrom: '2026-12-02', validUntil: '2026-12-01' }));
});
test('Gutscheine: Gesamtrabatt wird centgenau verteilt und Kaution bleibt unverändert', () => {
    const summary = applyCouponToSummary({ items: [{ rentalTotal: 0.01 }, { rentalTotal: 0.01 }, { rentalTotal: 0.01 }], totals: { depositTotal: 100 } }, { code: 'TEST', percent: 50, revision: 1 });
    assert.equal(summary.totals.discountAmount, 0.02);
    assert.deepEqual(summary.items.map(item => item.discountAmount), [0.01, 0.01, 0]);
    assert.equal(summary.totals.grandTotalBeforeDepositReturn, 100.01);
    assert.equal(summary.totals.depositTotal, 100);
});
test('Gutscheine: 100 Prozent reduziert ausschließlich die Miete auf null', () => {
    const summary = applyCouponToSummary({ items: [{ rentalTotal: 99.99 }], totals: { depositTotal: 150 } }, { code: 'FREE', percent: 100, revision: 1 });
    assert.equal(summary.totals.rentalTotal, 0); assert.equal(summary.totals.grandTotalBeforeDepositReturn, 150);
});
