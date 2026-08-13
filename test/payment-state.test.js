'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    calculateReturnSettlement,
    deriveOrderStatusFromInitialPayment,
    isDuplicateKeyError,
    isStrictIsoDate,
    mapMolliePaymentStatus,
    mapMollieRefundStatus
} = require('../services/paymentStateService');
const { buildOrderSummary, getFormValue } = require('../services/orderService');

test('normalisiert Mollie-Zahlungs- und Refund-Status getrennt', () => {
    assert.equal(mapMolliePaymentStatus('paid'), 'paid');
    assert.equal(mapMolliePaymentStatus('canceled'), 'cancelled');
    assert.equal(mapMolliePaymentStatus('open'), 'pending');
    assert.equal(mapMollieRefundStatus('refunded'), 'paid');
    assert.equal(mapMollieRefundStatus('processing'), 'pending');
    assert.equal(mapMollieRefundStatus('failed'), 'failed');
    assert.equal(mapMollieRefundStatus('canceled'), 'cancelled');
});

test('ein später Initialzahlungs-Webhook reaktiviert keinen terminalen Mietauftrag', () => {
    assert.equal(deriveOrderStatusFromInitialPayment('reserved', 'paid'), 'confirmed');
    assert.equal(deriveOrderStatusFromInitialPayment('payment_failed', 'paid'), 'confirmed');
    assert.equal(deriveOrderStatusFromInitialPayment('reserved', 'canceled'), 'payment_failed');
    assert.equal(deriveOrderStatusFromInitialPayment('reserved', 'expired'), 'payment_failed');
    assert.equal(deriveOrderStatusFromInitialPayment('cancelled', 'paid'), 'cancelled');
    assert.equal(deriveOrderStatusFromInitialPayment('expired', 'paid'), 'expired');
    assert.equal(deriveOrderStatusFromInitialPayment('picked_up', 'paid'), 'picked_up');
    assert.equal(deriveOrderStatusFromInitialPayment('returned', 'paid'), 'returned');
    assert.equal(deriveOrderStatusFromInitialPayment('returned', 'charged_back'), 'payment_dispute');
});

test('verrechnet Schäden, Verlängerung und Verspätung gemeinsam mit der Kaution', () => {
    assert.deepEqual(
        calculateReturnSettlement({
            deposit: 300,
            additionalChargeAmount: 100,
            openRentalAdjustmentAmount: 40,
            lateFee: 80
        }),
        {
            totalObligations: 220,
            depositDeductionAmount: 220,
            depositRefundAmount: 80,
            customerAdditionalDue: 0,
            depositDecision: 'partial_refund',
            depositDeductionPercent: 73.33
        }
    );

    assert.equal(calculateReturnSettlement({
        deposit: 100,
        additionalChargeAmount: 150,
        openRentalAdjustmentAmount: 20,
        lateFee: 30
    }).customerAdditionalDue, 100);
});

test('validiert echte ISO-Kalendertage und erkennt nur echte Duplicate Keys', () => {
    assert.equal(isStrictIsoDate('2026-02-28'), true);
    assert.equal(isStrictIsoDate('2026-02-30'), false);
    assert.equal(isStrictIsoDate('28.02.2026'), false);
    assert.equal(isDuplicateKeyError({ code: 'ER_DUP_ENTRY' }), true);
    assert.equal(isDuplicateKeyError({ code: 'ER_BAD_FIELD_ERROR' }), false);
});

test('erstellt für Bar- und Onlineauftrag dieselben belastbaren Summen mit passendem Status', () => {
    const items = [{
        productId: 1,
        productKey: 'bagger',
        title: 'Minibagger',
        rentalStart: '2026-09-01',
        rentalEnd: '2026-09-03',
        quantity: 1,
        pricePerDay: 80,
        deposit: 300
    }];

    const cashSummary = buildOrderSummary('R202600001', items, 'confirmed');
    const onlineSummary = buildOrderSummary('R202600002', items, 'reserved');

    assert.equal(cashSummary.status, 'confirmed');
    assert.equal(onlineSummary.status, 'reserved');
    assert.deepEqual(cashSummary.totals, {
        rentalTotal: 240,
        depositTotal: 300,
        grandTotalBeforeDepositReturn: 540
    });
    assert.deepEqual(onlineSummary.totals, cashSummary.totals);
});

test('liest auch teilweise beschädigte Checkout-Formulare ohne Ausnahme', () => {
    const form = [
        null,
        { elements: 'ungültig' },
        { elements: [{ name: 'CustomerEmail', value: 'kunde@example.com' }] }
    ];

    assert.equal(getFormValue(form, 'CustomerEmail'), 'kunde@example.com');
    assert.equal(getFormValue(null, 'CustomerEmail'), null);
});
