'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { summarizeOrderFinance, itemFinancials, toCents } = require('../services/orderFinanceService');

const item = { id: 1, rentalStart: '2026-10-24', rentalEnd: '2026-10-25', pricePerDay: '50.00', deposit: '150.00', itemStatus: 'active' };
const payment = (paymentType, amount, paymentStatus = 'paid', extra = {}) => ({ paymentType, amount, paymentStatus, ...extra });
const summary = (payments = [], changes = {}) => summarizeOrderFinance({ items: [item], payments, ...changes });

test('100 EUR unbezahlte Miete und 150 EUR Kaution sind 250 EUR offen', () => {
    const actual = summary([payment('rental', 100, 'pending'), payment('deposit', 150, 'pending')]);
    assert.equal(actual.rentalDueCents, 10000);
    assert.equal(actual.depositDueCents, 15000);
    assert.equal(actual.customerDueCents, 25000);
    assert.equal(actual.status, 'payment_due');
});
test('Centarithmetik rundet kaufmännisch und zählt Kalendertage über DST', () => {
    assert.equal(toCents('1.005'), 101);
    assert.equal(toCents('-1.005'), -101);
    assert.equal(toCents('0.29'), 29);
    assert.throws(() => toCents('Infinity'));
    assert.throws(() => toCents('90071992547409.92'));
    assert.equal(itemFinancials(item).effectiveDays, 2);
});
test('teilbezahlte Miete bleibt offen; Kaution wird separat ausgewiesen', () => {
    const actual = summary([payment('rental', 40), payment('deposit', 150)]);
    assert.equal(actual.rentalDueCents, 6000);
    assert.equal(actual.depositHeldCents, 15000);
    assert.equal(actual.customerDueCents, 6000);
});
test('Initialzahlung und ihre Miet-/Kautionsanteile werden nicht doppelt gezählt', () => {
    const actual = summary([
        payment('initial_payment', 250, 'paid', { molliePaymentId: 'tr_1' }),
        payment('rental', 100, 'paid', { molliePaymentId: 'tr_1' }),
        payment('deposit', 150, 'paid', { molliePaymentId: 'tr_1' })
    ]);
    assert.equal(actual.receivedCents, 25000);
    assert.equal(actual.customerDueCents, 0);
    assert.equal(actual.status, 'deposit_held');
});
test('Initialzahlung ohne Legacy-Anteile wird nach Miete und Kaution aufgeteilt', () => {
    const actual = summary([payment('initial_payment', 250)]);
    assert.equal(actual.customerDueCents, 0);
    assert.equal(actual.depositHeldCents, 15000);
});
test('Nachforderung und Verrechnung werden getrennt', () => {
    const actual = summary([payment('rental', 100), payment('deposit', 150), payment('rental_adjustment', 20, 'offset'), payment('return_additional_charge', 30, 'pending')]);
    assert.equal(actual.additionalDueCents, 3000);
    assert.equal(actual.offsetCents, 2000);
});
for (const status of ['pending', 'failed', 'paid']) {
    test(`Rückgabeerstattung ${status} ist eine eigenständige Forderung`, () => {
        const actual = summary([payment('rental', 100), payment('deposit', 150), payment('deposit_refund', -120, status)], {
            items: [{ ...item, itemStatus: 'returned_damaged', depositRefundAmount: '120.00', depositDeductionAmount: '30.00' }]
        });
        assert.equal(actual.depositHeldCents, 0);
        assert.equal(actual.depositRetainedCents, 3000);
        assert.equal(actual.refundDueCents, status === 'paid' ? 0 : 12000);
        assert.equal(actual.refundedCents, status === 'paid' ? 12000 : 0);
        assert.equal(actual.refundFailedCents, status === 'failed' ? 12000 : 0);
    });
}
test('Vollstorno unbezahlt erzeugt keine fiktive Erstattung', () => {
    const actual = summary([payment('rental', 100, 'cancelled'), payment('deposit', 150, 'cancelled')], { items: [{ ...item, itemStatus: 'cancelled' }] });
    assert.equal(actual.customerDueCents, 0);
    assert.equal(actual.refundDueCents, 0);
});
test('Teil-/Vollstorno erhält explizite Rückerstattungsansprüche', () => {
    const actual = summary([payment('rental', 100), payment('deposit', 150), payment('order_cancellation_refund', -250, 'pending')], { items: [{ ...item, itemStatus: 'cancelled' }] });
    assert.equal(actual.customerDueCents, 0);
    assert.equal(actual.refundDueCents, 25000);
});
test('Chargeback und Reversal verändern nicht den physischen Mietstatus', () => {
    const activeItem = { ...item, itemStatus: 'picked_up' };
    const actual = summary([payment('rental', 100), payment('deposit', 150), payment('chargeback', -40, 'charged_back')], { items: [activeItem] });
    assert.equal(actual.disputedCents, 4000);
    assert.equal(actual.status, 'disputed');
    assert.equal(actual.depositHeldCents, 15000);
    assert.equal(activeItem.itemStatus, 'picked_up');
    assert.equal(summary([payment('chargeback', -40, 'cancelled')]).disputedCents, 0);
});
test('bereits zugelassene Nullpreise bleiben abwickelbar, auch mit Kaution', () => {
    assert.equal(itemFinancials({ ...item, adjustedPricePerDay: 0 }).pricePerDay, 0);
    assert.equal(summary([], { items: [{ ...item, pricePerDay: 0, deposit: 0 }] }).customerDueCents, 0);
    assert.equal(summary([], { items: [{ ...item, pricePerDay: 0 }] }).customerDueCents, 15000);
});
test('zwei genuine Teilerstattungen werden addiert; ein Erstattungsretry ersetzt nur seinen fehlgeschlagenen Vorgänger', () => {
    const partials = [
        payment('order_cancellation_refund', -30, 'paid', { id: 5, molliePaymentId: 'tr_1', mollieRefundId: 're_1', externalOperationKey: 'cancel-first' }),
        payment('order_cancellation_refund', -40, 'paid', { id: 6, molliePaymentId: 'tr_1', mollieRefundId: 're_2', externalOperationKey: 'cancel-second' })
    ];
    assert.equal(summary(partials).refundedCents, 7000);
    const retry = [
        payment('deposit_refund', -100, 'failed', { id: 10, molliePaymentId: 'tr_1', mollieRefundId: 're_failed', externalOperationKey: 'deposit-refund-1' }),
        payment('deposit_refund', -100, 'pending', { id: 11, molliePaymentId: 'tr_1', mollieRefundId: 're_retry', externalOperationKey: 'retry-refund-10-1' })
    ];
    assert.equal(summary(retry).refundDueCents, 10000);
    assert.equal(summary(retry).refundFailedCents, 0);
    const raw = retry.map(row => ({ id: row.id, amount: row.amount, payment_type: row.paymentType, payment_status: row.paymentStatus, mollie_payment_id: row.molliePaymentId, mollie_refund_id: row.mollieRefundId, external_operation_key: row.externalOperationKey }));
    assert.deepEqual(summary(raw), summary(retry));
});
