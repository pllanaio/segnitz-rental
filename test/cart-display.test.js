'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
function cartLoader(fetch) {
    const source = fs.readFileSync('public/js/frontend_config.js', 'utf8');
    const a = source.indexOf('async function loadCart(');
    const b = source.indexOf('\nasync function ', a + 1);
    const context = { cartRequest: null, cartGeneration: 0, currentCart: { items: [{ id: 7 }] }, fetch, renderCart() {}, renderCartReview() {}, showAlert() {}, syncMainNextButtonVisibility() {}, document: { getElementById() { return null; } } };
    vm.runInNewContext(source.slice(a, b), context);
    return context;
}
test('fehlgeschlagener Cartabruf bewahrt vorhandene Daten und markiert Fehler', async () => {
    const context = cartLoader(async () => { throw new Error('offline'); });
    assert.equal(await context.loadCart(), null);
    assert.equal(context.cartState, 'error');
    assert.equal(context.currentCart.items[0].id, 7);
});
test('späte GET-Antwort vor einer Mutation überschreibt keinen neuen Warenkorb', async () => {
    const pending = [];
    const context = cartLoader(() => new Promise(resolve => pending.push(resolve)));
    const old = context.loadCart();
    const fresh = context.loadCart({ refresh: true });
    pending[1]({ ok: true, json: async () => ({ items: [{ id: 42 }] }) });
    await fresh;
    pending[0]({ ok: true, json: async () => ({ items: [] }) });
    await old;
    assert.equal(context.currentCart.items[0].id, 42);
    assert.equal(context.cartState, 'ready');
});
