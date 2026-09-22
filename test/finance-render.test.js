'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

// Execute the actual renderer. No source-pattern assertion: the regression is
// the statement shown for a real unpaid order, not a particular implementation.
function renderer(file, name) {
    const source = fs.readFileSync(file, 'utf8');
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\nfunction ', start + 1);
    const context = { window: {}, calculateOrderItemFinancials: () => ({ originalDays: 2, effectiveDays: 2, pricePerDay: 50, rentalTotal: 100, deposit: 150, depositRefund: 0, depositRetained: 0, additionalCharge: 0, customerAdditionalDue: 0, customerCredit: 0, originalRentalTotal: 100, rentalAdjustment: 0 }), escapeHtml: value => String(value || ''), getSafeCheckoutUrl: () => null };
    const shared = 'public/js/finance-summary.js';
    if (fs.existsSync(shared)) vm.runInNewContext(fs.readFileSync(shared, 'utf8'), context);
    vm.runInNewContext(source.slice(start, end < 0 ? undefined : end) + `\nthis.render = ${name};`, context);
    return context.render;
}
for (const [file, name] of [['public/js/profile_config.js', 'renderMyOrderFinancialSummary'], ['public/js/backend_config.js', 'renderOrderFinancialSummary']]) {
    test(`${name}: unbezahlte 250 EUR werden niemals als ausgeglichen dargestellt`, () => {
        const order = { items: [{ rentalStart: '2026-10-24', rentalEnd: '2026-10-25', pricePerDay: 50, deposit: 150 }], payments: [{ paymentType: 'rental', paymentStatus: 'pending', amount: 100 }, { paymentType: 'deposit', paymentStatus: 'pending', amount: 150 }], financialSummary: { version: 1, currency: 'EUR', rentalDueCents: 10000, depositDueCents: 15000, customerDueCents: 25000, status: 'payment_due', statusLabel: 'Zahlung offen' } };
        const html = renderer(file, name)(order);
        assert.doesNotMatch(html, /Bestellung vollständig ausgeglichen/);
        assert.match(html, /250,00/);
    });
}
