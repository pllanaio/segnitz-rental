'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { run } = require('../public/js/pending-actions');
test('Doppelklick führt nur eine Mutation aus und gibt Kontrolle nach Fehler frei', async () => {
    const button = { tagName: 'BUTTON', disabled: false, setAttribute() {}, removeAttribute() {} };
    let release; let calls = 0;
    const first = run(button, async () => { calls++; await new Promise(resolve => { release = resolve; }); throw new Error('offline'); });
    assert.equal(button.disabled, true);
    await run(button, () => { calls++; });
    assert.equal(calls, 1);
    release(); await first;
    assert.equal(button.disabled, false);
    await run(button, () => { calls++; });
    assert.equal(calls, 2);
});
