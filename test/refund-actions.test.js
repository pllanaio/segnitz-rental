'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildOrderPaymentActions } = require('../frontend/lib/adminPayments.js');
const { isLatestSheetPayment, sheetPaymentRows } = require('../frontend/lib/orders.js');

// Maps the rendered button kinds to the data attributes the admin page handles.
const MARKERS = {
    'manual-payment': 'open-manual-payment',
    'manual-refund': 'open-manual-refund',
    'retry-refund': 'retry-online-refund',
    pos: 'data-pos-order',
    transfer: 'data-transfer-order',
    'additional-transfer': 'data-additional-transfer',
    'checkout-link': 'checkout-link'
};
const markers = order => buildOrderPaymentActions(order)
    .flatMap(action => action.buttons.map(button => MARKERS[button.kind]))
    .join(' ');
const render = payments => markers({ id: 1, status: 'cancelled', payment_method: 'cash', payments });
const initial = { paymentType: 'initial_payment', paymentStatus: 'paid', amount: 460, paymentMethod: 'online', molliePaymentId: 'tr_original' };
const refund = { paymentType: 'deposit_refund', paymentStatus: 'pending', amount: -300, paymentMethod: 'cash', orderItemId: 2 };

test('bezahlte Ersatz-Nachzahlung blendet alte Zahlungsaktionen aus und zeigt den aktuellen Status', () => {
    const payments=[{id:1,orderItemId:2,paymentType:'return_additional_charge',paymentStatus:'failed',paymentMethod:'online',amount:80},
        {id:2,orderItemId:2,paymentType:'return_additional_charge',paymentStatus:'paid',paymentMethod:'online',amount:80}];
    const html=markers({id:1,status:'returned',payment_status:'paid',payments});
    assert.doesNotMatch(html,/open-manual-payment|data-pos-order|data-additional-transfer/);
    const rows=sheetPaymentRows({payment_status:'paid',payments});
    assert.equal(rows.filter(row=>isLatestSheetPayment(row,rows)).map(row=>row.paymentStatus).join(','),'paid');
    assert.equal(isLatestSheetPayment(rows.find(row=>row.paymentStatus==='failed'),rows),false);
});

test('versteckt Vor-Ort-Erstattung bei Online-Quelle trotz falscher Auftrags- und Erstattungsart', () => {
    assert.doesNotMatch(render([initial, refund]), /open-manual-refund/);
    assert.doesNotMatch(render([initial, { ...refund, paymentType: 'order_cancellation_refund' }]), /open-manual-refund/);
});
test('bietet Vor-Ort-Erstattung nur für tatsächlich vor Ort bezahlte Beträge an', () => {
    assert.match(render([{ ...initial, paymentMethod: 'cash', molliePaymentId: null }, refund]), /open-manual-refund/);
    assert.doesNotMatch(render([{ ...initial, paymentMethod: 'cash', molliePaymentId: null, amount: 100 }, refund]), /open-manual-refund/);
});
test('behält Mollie-Retry für fehlgeschlagene Online-Erstattungen', () => {
    const html = render([initial, { ...refund, paymentMethod: 'online', paymentStatus: 'failed', molliePaymentId: 'tr_original' }]);
    assert.match(html, /retry-online-refund/);
    assert.doesNotMatch(html, /open-manual-refund/);
});

test('beendete unbezahlte POS-Zahlung bietet wieder Barzahlung ohne doppelte Zahlungszeile', () => {
    for (const status of ['failed', 'cancelled', 'expired', 'open', 'paid']) {
        const payments = ['initial_payment', 'rental', 'deposit'].map((paymentType, i) => ({ id: i+1, paymentType, amount: paymentType === 'initial_payment' ? 400 : 200, paymentMethod: 'online', paymentStatus: status, molliePaymentId: 'tr_pos', posTerminalId: 'term_one' }));
        const html = markers({ id: 1, status: 'confirmed', payment_status: status, payments });
        assert.equal(html.includes('open-manual-payment'), ['failed', 'cancelled', 'expired'].includes(status), status);
    }
});

test('Rechnungskauf zeigt die Erstattung der separat bar bezahlten Kaution', () => {
    const payments=[initial,{paymentType:'deposit',paymentStatus:'paid',amount:300,paymentMethod:'cash'},refund];
    const html=markers({id:1,status:'cancelled',payment_method:'invoice',payments});
    assert.match(html,/open-manual-refund/);
});
