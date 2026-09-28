'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function service(client, env = {}) {
    const context = { module: { exports: {} }, process: { env: {
        MOLLIE_API_KEY: 'test_contract', MOLLIE_TEST_MODE: '0',
        NODE_ENV: 'development', BASE_URL: 'http://localhost:3000', ...env
    } }, setTimeout, clearTimeout, URL,
    require: () => ({ createMollieClient: () => client }) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/mollieService.js'), 'utf8'), context);
    return context.module.exports;
}

test('echter Mollie-Test-Key erzeugt API-Checkout mit Adressdaten und Positionen ohne localhost-Webhook', async () => {
    let payload;
    const api = service({ payments: { create: async data => { payload = data; return { id: 'tr_real' }; } } });
    await api.createMolliePaymentForOrder({ id: 42, orderNo: 'R42', totalAmount: 49.9,
        billingAddress: { email: 'test@example.invalid' }, lines: [{ description: 'Miete' }], idempotencyKey: 'stable' });
    assert.equal(payload.amount.value, '49.90');
    assert.equal(payload.webhookUrl, undefined);
    assert.equal(payload.billingAddress.email, 'test@example.invalid');
    assert.equal(payload.lines[0].description, 'Miete');
    assert.equal(payload.metadata.orderId, '42');
    assert.equal(payload.idempotencyKey, 'stable');
    assert.equal(payload.redirectUrl, 'http://localhost:3000/index.html?payment=return&orderId=42');
    assert.equal(payload.locale, 'de_DE');
});

test('POS sendet Terminal, Betrag und Idempotenzschlüssel an Mollie und benötigt keine Checkout-URL', async () => {
    let payload;
    const api = service({ payments: { create: async data => { payload = data; return { id: 'tr_pos', _links: { changePaymentState: { href: 'https://www.mollie.com/test' } } }; } } });
    const payment = await api.createMolliePaymentForOrder({ id: 42, totalAmount: 460, terminalId: 'term_testone', idempotencyKey: 'pos-stable' });
    assert.equal(payload.method, 'pointofsale'); assert.equal(payload.terminalId, 'term_testone');
    assert.equal(payload.amount.value, '460.00'); assert.equal(payload.idempotencyKey, 'pos-stable');
    const result = api.serializeMolliePayment(payment);
    assert.equal(result.checkoutUrl, null); assert.equal(result.links.changePaymentState.href, 'https://www.mollie.com/test');
    await assert.rejects(api.createMolliePaymentForOrder({ id: 42, totalAmount: 460, terminalId: '../other' }), /Terminal-ID/);
});

test('öffentlicher Webhook wird getrennt vom lokalen Browser-Redirect konfiguriert', () => {
    assert.equal(service({}, { MOLLIE_WEBHOOK_URL: 'https://rental.example.com/webhooks/mollie' }).getWebhookUrl(),
        'https://rental.example.com/webhooks/mollie');
    assert.throws(() => service({}, { NODE_ENV: 'production' }).getWebhookUrl(), /öffentlich/);
    assert.throws(() => service({}, { MOLLIE_WEBHOOK_URL: 'http://localhost:3000/webhooks/mollie' }).getWebhookUrl(), /öffentlich/);
});

test('Chargebacks und Refunds werden über alle SDK-Seiten geladen; payment.status bleibt paid', async () => {
    const first = [{ id: 'chb_1' }];
    first.nextPage = async () => [{ id: 'chb_2', reversedAt: '2026-09-27T12:00:00Z' }];
    const api = service({ payments: { get: async () => ({ id: 'tr_real', status: 'paid' }) },
        paymentChargebacks: { page: async () => first }, paymentRefunds: { page: async () => first } });
    const payment = await api.getMolliePayment('tr_real');
    assert.equal(payment.status, 'paid');
    assert.equal(payment.chargebacks.length, 2);
    assert.equal((await api.listMollieRefundsForPayment('tr_real')).length, 2);
});

test('Refund-API erhält positiven EUR-Betrag und dieselbe Idempotenzreferenz in den Metadaten', async () => {
    let payload;
    const api = service({ paymentRefunds: { create: async data => { payload = data; return data; } } });
    await api.createMollieRefundForPayment({ paymentId: 'tr_real', amount: 12.3, description: 'Kaution', idempotencyKey: 'refund-42' });
    assert.equal(payload.amount.value, '12.30');
    assert.equal(payload.metadata.operationKey, 'refund-42');
    assert.equal(payload.idempotencyKey, 'refund-42');
    await assert.rejects(api.createMollieRefundForPayment({ paymentId: 'tr_real', amount: -1 }), /größer/);
});

test('Überweisung sendet Gesamtbetrag, Zahlungsziel und Kundenadresse an Mollie und archiviert nur Zahlungsanweisungen',async()=>{
 let payload;const api=service({payments:{create:async data=>{payload=data;return {id:'tr_bank',method:'banktransfer',details:{bankAccount:'DE123',bankBic:'TEST',bankName:'Bank',transferReference:'123.456',consumerAccount:'PRIVATE'}};}}});
 const payment=await api.createMolliePaymentForOrder({id:7,orderNo:'R7',totalAmount:460,method:'banktransfer',dueDate:'2026-10-12',billingAddress:{email:'customer@example.invalid'},idempotencyKey:'bank-7'});
 assert.equal(payload.method,'banktransfer');assert.equal(payload.amount.value,'460.00');assert.equal(payload.dueDate,'2026-10-12');assert.equal(payload.billingAddress.email,'customer@example.invalid');assert.equal(payload.locale,'de_DE');assert.equal(payload.idempotencyKey,'bank-7');
 const result=api.serializeMolliePayment(payment);assert.equal(result.details.transferReference,'123.456');assert.equal(result.details.bankAccount,'DE123');assert.equal(result.details.consumerAccount,undefined);
});
