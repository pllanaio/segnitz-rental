'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const shop = require('../frontend/lib/shop.js');
const paymentReturn = require('../frontend/lib/paymentReturn.js');
const { buildItemActions, buildOrderPaymentActions, canCancelOrder } = require('../frontend/lib/adminPayments.js');
const { computeReturn, rentalPeriodPreview } = require('../frontend/lib/adminReturns.js');

test('Checkout sendet die bisherige schrittweise Formularstruktur an /data', () => {
    const customer = {
        FirstName: 'Max', LastName: 'Muster', CustomerCompany: '', CustomerEmail: 'max@example.invalid',
        CustomerPhone: '0123', CustomerAddress: 'Weg 1', CustomerZip: '97070', CustomerCity: 'Würzburg'
    };
    const form = shop.buildOrderForm({ customer, signature: 'data:image/png;base64,AAA', agbs: true, dsgvo: false, paymentMethod: 'cash' });

    assert.deepEqual(form.map(step => step.step), [1, 2, 3, 4]);
    assert.deepEqual(form[2].elements.map(element => element.name),
        ['FirstName', 'LastName', 'CustomerCompany', 'CustomerEmail', 'CustomerPhone', 'CustomerAddress', 'CustomerZip', 'CustomerCity']);
    assert.deepEqual(form[3].elements, [
        { name: 'Signature', value: 'data:image/png;base64,AAA' },
        { name: 'agbs', value: 'on', checked: true },
        { name: 'dsgvo', value: '', checked: false },
        { name: 'paymentMethod', value: 'cash', checked: true }
    ]);
});

test('Kundendaten-Prüfung meldet Pflichtfelder vor Formatfehlern in Formularreihenfolge', () => {
    const errors = shop.validateCustomerFields({
        FirstName: '', LastName: 'X', CustomerEmail: 'kein-mail', CustomerPhone: '12a', CustomerAddress: 'Weg 1!',
        CustomerZip: '97x', CustomerCity: 'Ort'
    });
    assert.equal(errors.FirstName, 'Dieses Pflichtfeld muss ausgefüllt werden.');
    assert.equal(errors.CustomerEmail, 'Bitte geben Sie eine gültige E-Mail-Adresse ein.');
    assert.equal(errors.CustomerPhone, 'Telefon darf nur Ziffern enthalten.');
    assert.equal(errors.CustomerZip, 'PLZ darf nur Ziffern enthalten.');
    assert.equal(errors.CustomerAddress, 'Adresse darf nur Buchstaben, Zahlen und Leerzeichen enthalten.');
    assert.equal(shop.firstInvalidCustomerField(errors), 'FirstName');
    delete errors.FirstName;
    assert.equal(shop.firstInvalidCustomerField(errors), 'CustomerEmail');
    assert.equal(shop.allowOnlyDigits('09 11-2'), '09112');
    assert.equal(shop.allowAddressChars('Hauptstr. 5a, Würzburg'), 'Hauptstr 5a Würzburg');
});

test('Warenkorbsummen und Mehrwertsteueraufteilung entsprechen der bisherigen Anzeige', () => {
    const totals = shop.calculateCartTotals([
        { rentalStart: '2029-03-01', rentalEnd: '2029-03-03', pricePerDay: 49.9, deposit: 150 },
        { rentalStart: '2029-03-05', rentalEnd: '2029-03-05', price_per_day: 10, deposit: 0 }
    ]);
    assert.equal(totals.rentalTotal.toFixed(2), '159.70');
    assert.equal(totals.depositTotal, 150);
    const split = shop.splitGrossRental(119);
    assert.equal(split.rentalNet.toFixed(2), '100.00');
    assert.equal(split.rentalVat.toFixed(2), '19.00');
    assert.equal(shop.formatCurrency(1234.5), '1234,50 €');
    assert.equal(shop.describeCartItemDuration({ rentalStart: '2029-03-01', rentalEnd: '2029-03-01' }), '1 Tag');
    assert.equal(shop.describeCartItemDuration({ rentalHours: 4, rentalStartTime: '09:00' }), '4 Stunden ab 09:00');
});

test('Mollie-Rückkehr unterscheidet Fehlschlag, Erstattung und Folgezahlungen wie bisher', () => {
    const failed = paymentReturn.describePaymentError('return', 'failed', { status: 'payment_failed' });
    assert.equal(failed.title, 'Zahlung fehlgeschlagen');
    assert.equal(failed.canRetryInitialPayment, true);
    assert.equal(failed.alertClass, 'alert-danger');

    const extension = paymentReturn.describePaymentError('extension', 'canceled', {});
    assert.equal(extension.status, 'cancelled');
    assert.equal(extension.canRetryInitialPayment, false);
    assert.match(extension.followUpText, /neuen Zahlungslink/);

    const closed = paymentReturn.describePaymentError('return', 'expired', { status: 'cancelled' });
    assert.equal(closed.canRetryInitialPayment, false);
    assert.equal(closed.followUpText, 'Für diese Bestellung ist keine weitere Zahlung erforderlich.');

    const cash = paymentReturn.describePaymentSuccess('extension', { settled_by_cash: true, duplicate_refund_status: 'paid' });
    assert.equal(cash.title, 'Nachzahlung bereits vor Ort beglichen');
    assert.match(cash.body, /doppelte Onlinezahlung wurde erstattet/);
    assert.equal(paymentReturn.describePaymentSuccess('return', {}).title, 'Mietvorgang erfolgreich bezahlt');
});

test('Artikelaktionen im Bestellblatt folgen den bisherigen Freigaberegeln', () => {
    const order = { id: 5, status: 'confirmed', payment_status: 'paid', handoverStatus: null, items: [{ id: 1, title: 'A', itemStatus: 'active' }] };
    assert.deepEqual(buildItemActions(order).map(action => [action.action, action.disabled]), [['mark-item-picked-up', true]]);
    order.handoverStatus = 'signed';
    assert.equal(buildItemActions(order)[0].disabled, false);
    order.items.push({ id: 2, title: 'B', itemStatus: 'picked_up' });
    assert.deepEqual(buildItemActions(order).map(action => action.label), [
        'Als abgeholt markieren · A', 'Artikel stornieren · A', 'Mietzeitraum verlängern · B', 'Rückgabe · B'
    ]);
    assert.equal(canCancelOrder(order), false);
    assert.equal(canCancelOrder({ status: 'confirmed', items: [{ itemStatus: 'active' }] }), true);
});

test('offene Barzahlung bietet Barzahlung, Kartenzahlung und Kauf auf Rechnung an', () => {
    const actions = buildOrderPaymentActions({ id: 9, status: 'confirmed', payment_method: 'cash', payment_status: 'pending', payments: [
        { id: 1, paymentType: 'rental', paymentMethod: 'cash', paymentStatus: 'pending', amount: 100 },
        { id: 2, paymentType: 'deposit', paymentMethod: 'cash', paymentStatus: 'pending', amount: 300 }
    ] });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].amount, 400);
    assert.deepEqual(actions[0].buttons.map(button => button.kind), ['manual-payment', 'pos', 'transfer']);
    assert.deepEqual(actions[0].matchers, [{ type: 'initial_payment', item: '' }, { type: 'initial_payment', item: '' }]);
});

test('Rückgabevorschau verrechnet Zusatzkosten mit der Kaution', () => {
    const item = { id: 3, rentalStart: '2029-03-01', rentalEnd: '2029-03-03', pricePerDay: 80, deposit: 300 };
    const result = computeReturn(item, [], { actualDate: '2029-03-04', actualTime: '10:00', isDamaged: true, additionalChargeAmount: '400' });
    assert.equal(result.returnStatus, 'returned_late_damaged');
    assert.equal(result.lateFee, 80);
    assert.equal(result.refundAmount, 0);
    assert.equal(result.customerAdditionalDue, 180);
    assert.equal(result.depositDecision, 'no_refund');
    assert.equal(result.depositDeductionPercent, '100.00');
    assert.equal(result.depositDeductionReason, 'Zusatzkosten mit Kaution verrechnet | Verspätungskosten mit Kaution verrechnet');

    const preview = rentalPeriodPreview(item, { start: '2029-03-01', end: '2029-03-05' });
    assert.equal(preview.extensionDays, 2);
    assert.equal(preview.difference, 160);
    assert.equal(preview.invalidEnd, false);
    assert.equal(rentalPeriodPreview(item, { end: '2029-03-03' }).invalidEnd, true);
});
