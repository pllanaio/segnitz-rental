'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sendOrderEmail } = require('../services/mailService');

function fixture() {
    const state = { effect: null, inserts: 0, financeReads: 0, payments: [
        { payment_type: 'initial_payment', payment_method: 'online', payment_status: 'paid', amount: '250.00', mollie_payment_id: 'tr_confirmation' }
    ] };
    const connection = {
        [Symbol.for('segnitz.mysql.transaction-active')]: true,
        async execute(sql, params) {
            if (sql.includes('FROM rental_orders')) return [[{ id: 42 }]];
            if (sql.includes('FROM rental_order_items')) return [[{
                rentalStart: '2026-10-01', rentalEnd: '2026-10-01', price_per_day: '100.00', deposit: '150.00', item_status: 'active'
            }]];
            if (sql.includes('FROM rental_order_payments')) { state.financeReads++; return [state.payments]; }
            if (sql.includes('INSERT INTO external_effects_outbox')) {
                state.inserts++;
                state.effect ||= { id: 1, operation_key: params[0], effect_type: params[1], payload_json: JSON.parse(params[2]), payload_hash: params[3], status: 'pending' };
                return [{ affectedRows: 1 }];
            }
            if (sql.includes('FROM external_effects_outbox')) return [[...(state.effect ? [state.effect] : [])]];
            throw new Error('Unexpected synthetic SQL');
        }
    };
    const send = () => sendOrderEmail(['synthetic@example.com'], {
        id: 42, orderNo: 'TEST-42', items: [], totals: { rentalTotal: 100, depositTotal: 150, grandTotalBeforeDepositReturn: 250 }
    }, { email: 'synthetic@example.com' }, null, 'Online bezahlt', {
        connection, operationKey: 'mail-order-confirmation-42',
        application: { kind: 'order_confirmation_mail', orderId: 42 }
    });
    return { state, connection, send };
}

test('paused confirmation keeps its first financial snapshot across later refund observations', async () => {
    const { state, send } = fixture();
    assert.equal(await send(), true);
    const original = structuredClone(state.effect);
    state.payments.push({ payment_type: 'duplicate_payment_refund', payment_method: 'online', payment_status: 'failed', amount: '-25.00', mollie_payment_id: 'tr_confirmation', mollie_refund_id: 're_failed' });
    assert.equal(await send(), true);
    assert.deepEqual(state.effect, original);
    assert.equal(state.inserts, 1);
    assert.equal(state.financeReads, 1);
});

test('dead and redacted succeeded confirmation jobs are never silently recreated', async () => {
    for (const status of ['dead', 'succeeded']) {
        const { state, send } = fixture();
        await send();
        state.effect.status = status;
        state.effect.payload_json = { redacted: true };
        const original = structuredClone(state.effect);
        await send();
        assert.deepEqual(state.effect, original);
        assert.equal(state.inserts, 1);
    }
});

test('confirmation lookup needs an active transaction and rejects an unrelated operation', async () => {
    const { state, connection, send } = fixture();
    connection[Symbol.for('segnitz.mysql.transaction-active')] = false;
    await assert.rejects(send(), { code: 'ORDER_CONFIRMATION_CONTEXT_REQUIRED' });
    connection[Symbol.for('segnitz.mysql.transaction-active')] = true;
    state.effect = { id: 7, effect_type: 'mollie.refund.create', status: 'pending' };
    await assert.rejects(send(), { code: 'ORDER_CONFIRMATION_IDEMPOTENCY_CONFLICT' });
    assert.equal(state.inserts, 0);
});

test('confirmation completion acquires the order context before locking its outbox receipt', async () => {
    const { lockExternalEffectPaymentContext } = require('../services/bookingPaymentService');
    const calls = [];
    await lockExternalEffectPaymentContext({ execute: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('FROM rental_order_items')) return [[]];
        if (sql.includes('FROM rental_orders')) return [[{ id: 42 }]];
        throw new Error('Unexpected SQL');
    } }, { payload: { application: { kind: 'order_confirmation_mail', orderId: 42 } } });
    assert.equal(calls.length, 2);
    assert.match(calls[1].sql, /FROM rental_orders.*FOR UPDATE/);
    assert.deepEqual(calls[1].params, [42]);
});
