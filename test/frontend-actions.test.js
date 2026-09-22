'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const PendingActions = require('../public/js/pending-actions');

test('Zahlungs-Retry sperrt gleichzeitige Klicks und gibt den Button nach Pending wieder frei', async () => {
    const source = fs.readFileSync('public/js/frontend_config.js', 'utf8');
    const start = source.indexOf('function handleFrontendActionClick(');
    const end = source.indexOf('\ndocument.addEventListener', start);
    let complete;
    let calls = 0;
    const context = { window: { PendingActions }, retryMolliePayment: async () => {
        calls++;
        await new Promise(resolve => { complete = resolve; });
    } };
    vm.runInNewContext(source.slice(start, end), context);
    const button = { tagName: 'BUTTON', disabled: false, dataset: { frontendAction: 'retry-payment', orderId: '4' }, setAttribute() {}, removeAttribute() {} };
    const event = { target: { closest: () => button } };
    const first = context.handleFrontendActionClick(event);
    context.handleFrontendActionClick(event);
    assert.equal(calls, 1);
    assert.equal(button.disabled, true);
    complete();
    await first;
    assert.equal(button.disabled, false);
});
