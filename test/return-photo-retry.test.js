'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
test('nach bestätigter Rückgabe und fehlgeschlagenem Fotoupload wiederholt UI ausschließlich Folgeaktionen', async () => {
    const source = fs.readFileSync('public/js/backend_config.js', 'utf8');
    const a = source.indexOf('async function saveOrderItemReturn(');
    const b = source.indexOf('\nasync function ', a + 1);
    let writes = 0; let uploads = 0; let mails = 0; let closed = 0;
    const fields = new Map();
    const context = {
        committedReturnItems: new Set(), applyOrderItemReturnModalRules() {}, normalizeDecimalInput: value => value,
        document: { getElementById(id) { if (!fields.has(id)) fields.set(id, { value: '', checked: false, textContent: '' }); return fields.get(id); } },
        getAdminCsrfHeaders: async () => ({}), showAlert() {}, console: { error() {} }, setTimeout() {}, restoreOrderDetailsModalLayer() {},
        loadOrders: async () => {}, renderOrderDetails() {},
        bootstrap: { Modal: { getInstance: () => ({ hide() { closed++; } }) } },
        fetch: async (url, options = {}) => { if (options.method === 'PUT') writes++; return { ok: true, json: async () => ({ items: [], message: 'Gespeichert' }) }; },
        uploadReturnImagesForCurrentReturn: async () => { uploads++; if (uploads === 1) throw new Error('503'); },
        sendReturnSummaryEmailForItem: async () => { mails++; }
    };
    vm.runInNewContext(source.slice(a, b), context);
    await context.saveOrderItemReturn(12, 20);
    assert.equal(writes, 1); assert.equal(closed, 0); assert.equal(mails, 0);
    assert.equal(context.committedReturnItems.has('12'), true);
    await context.saveOrderItemReturn(12, 20);
    assert.equal(writes, 1); assert.equal(uploads, 2); assert.equal(mails, 1); assert.equal(closed, 1);
});
