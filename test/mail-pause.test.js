'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { deliverGraphMail } = require('../services/mailService');
const { processClaimedExternalEffect } = require('../services/externalEffectsWorker');

test('disabled delivery cannot be reported as accepted mail', async () => {
    const original = process.env.DISABLE_EMAILS;
    process.env.DISABLE_EMAILS = '1';
    try {
        await assert.rejects(deliverGraphMail({ to: 'fixture@example.invalid' }),
            { code: 'MAIL_DELIVERY_PAUSED' });
    } finally {
        if (original === undefined) delete process.env.DISABLE_EMAILS;
        else process.env.DISABLE_EMAILS = original;
    }
});

test('a pause between claim and dispatch releases the job without success or exhausted retries', async () => {
    const effect = { id: 1, effect_type: 'mail.send', locked_by: 'fixture-worker',
        payload: { message: { to: 'fixture@example.invalid' } } };
    const calls = [];
    const result = await processClaimedExternalEffect(effect, {
        deliverMail: async () => { throw Object.assign(new Error('Mail paused'), { code: 'MAIL_DELIVERY_PAUSED' }); },
        deferEffect: async value => { calls.push(['defer', value.id]); },
        completeEffect: async () => { calls.push(['complete']); },
        failEffect: async () => { calls.push(['fail']); }
    });
    assert.deepEqual(calls, [['defer', 1]]);
    assert.deepEqual(result, { paused: true });
});
