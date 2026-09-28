'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/backend_config.js'), 'utf8');
const panel = source.slice(source.indexOf('function renderOrderPaymentActionPanel('), source.indexOf('function renderOrderItemCard('));
const context = { formatPaymentType: value => value };
vm.createContext(context);
vm.runInContext(panel, context);
const render = payments => context.renderOrderPaymentActionPanel({ id: 1, status: 'cancelled', payment_method: 'cash', payments });
const initial = { paymentType: 'initial_payment', paymentStatus: 'paid', amount: 460, paymentMethod: 'online', molliePaymentId: 'tr_original' };
const refund = { paymentType: 'deposit_refund', paymentStatus: 'pending', amount: -300, paymentMethod: 'cash', orderItemId: 2 };

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
        const html = context.renderOrderPaymentActionPanel({ id: 1, status: 'confirmed', payment_status: status, payments });
        assert.equal(html.includes('open-manual-payment'), ['failed', 'cancelled', 'expired'].includes(status), status);
    }
});

test('Rechnungskauf zeigt die Erstattung der separat bar bezahlten Kaution', () => {
    const payments=[initial,{paymentType:'deposit',paymentStatus:'paid',amount:300,paymentMethod:'cash'},refund];
    const html=context.renderOrderPaymentActionPanel({id:1,status:'cancelled',payment_method:'invoice',payments});
    assert.match(html,/open-manual-refund/);
});
