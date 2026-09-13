'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { summarizeOrderFinance } = require('../services/orderFinanceService');
const financeView = require('../public/js/finance-summary');

const item = { id: 1, rentalStart: '2026-10-24', rentalEnd: '2026-10-25',
    pricePerDay: '50.00', deposit: '150.00', itemStatus: 'active' };
const payment = (paymentType, amount, paymentStatus, extra = {}) =>
    ({ paymentType, amount, paymentStatus, paymentMethod: 'online', molliePaymentId: 'tr_fixture', ...extra });

test('a paid initial aggregate covers its partially projected rental and deposit components', () => {
    const result = summarizeOrderFinance({ items: [item], payments: [
        payment('initial_payment', '250.00', 'paid'),
        payment('rental', '100.00', 'paid'),
        payment('deposit', '150.00', 'pending')
    ] });
    assert.equal(result.receivedCents, 25000);
    assert.equal(result.rentalReceivedCents, 10000);
    assert.equal(result.depositReceivedCents, 15000);
    assert.equal(result.customerDueCents, 0);
    assert.equal(result.status, 'deposit_held');
});

test('cancellation preserves an aggregate-only receipt even when no active contract remains', () => {
    const result = summarizeOrderFinance({ items: [{ ...item, itemStatus: 'cancelled' }], payments: [
        payment('initial_payment', '250.00', 'paid'),
        payment('order_cancellation_refund', '-250.00', 'pending')
    ] });
    assert.equal(result.receivedCents, 25000);
    assert.equal(result.rentalReceivedCents, 10000);
    assert.equal(result.depositReceivedCents, 15000);
    assert.equal(result.customerDueCents, 0);
    assert.equal(result.refundDueCents, 25000);
});

test('cancelled or expired positions cannot retain unpaid extension claims', () => {
    for (const itemStatus of ['cancelled', 'expired']) {
        const result = summarizeOrderFinance({ items: [{ ...item, itemStatus }], payments: [
            payment('rental', '100.00', 'paid'), payment('deposit', '150.00', 'paid'),
            payment('rental_adjustment', '20.00', 'cancelled', { orderItemId: 1 })
        ] });
        assert.equal(result.additionalDueCents, 0);
        assert.equal(result.customerDueCents, 0);
        assert.doesNotMatch(financeView.render(result), /Zahlung offen/);
    }
});

test('genuine receipts from two initial provider payments stay visible beside the duplicate refund', () => {
    const result = summarizeOrderFinance({ items: [item], payments: [
        payment('initial_payment', '250.00', 'paid'),
        payment('initial_payment', '250.00', 'paid', { molliePaymentId: 'tr_duplicate' }),
        payment('duplicate_payment_refund', '-250.00', 'pending', { molliePaymentId: 'tr_duplicate' })
    ] });
    assert.equal(result.receivedCents, 50000);
    assert.equal(result.customerDueCents, 0);
    assert.equal(result.refundDueCents, 25000);
    assert.equal(result.depositHeldCents, 15000);
});

test('active failed extensions remain due and zero-total cash receipts stay settled', () => {
    const active = summarizeOrderFinance({ items: [item], payments: [
        payment('initial_payment', '250.00', 'paid'),
        payment('rental_adjustment', '20.00', 'failed', { orderItemId: 1 })
    ] });
    assert.equal(active.customerDueCents, 2000);
    const zero = summarizeOrderFinance({ items: [{ ...item, pricePerDay: 0, deposit: 0 }],
        payments: [payment('initial_payment', 0, 'paid', { paymentMethod: 'cash', molliePaymentId: null })] });
    assert.equal(zero.customerDueCents, 0);
    assert.equal(zero.receivedCents, 0);
    assert.equal(zero.status, 'settled');
});

test('one provider refund resource is counted once despite legacy ledger aliases', () => {
    const result = summarizeOrderFinance({ items: [{ ...item, itemStatus: 'returned_ok', depositRefundAmount: 150 }], payments: [
        payment('initial_payment', 250, 'paid'),
        payment('deposit_refund', -150, 'paid', { id: 5, mollieRefundId: 're_fixture', externalOperationKey: 'first-intent' }),
        payment('deposit_refund', -150, 'pending', { id: 6, mollieRefundId: 're_fixture', externalOperationKey: 'legacy-alias' })
    ] });
    assert.equal(result.refundedCents, 15000);
    assert.equal(result.refundDueCents, 0);
});
