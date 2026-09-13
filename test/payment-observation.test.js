'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { transitionPaymentStatus, transitionRefundStatus, validateProviderAmount } = require('../services/paymentStateService');

test('older open, failed and cancelled observations cannot regress settled payments', () => {
  for (const observed of ['pending', 'authorized', 'failed', 'expired', 'cancelled']) {
    assert.equal(transitionPaymentStatus('paid', observed), 'paid');
    assert.equal(transitionPaymentStatus('refunded', observed), 'refunded');
    assert.equal(transitionPaymentStatus('charged_back', observed), 'charged_back');
  }
  assert.equal(transitionPaymentStatus('authorized', 'pending'), 'authorized');
  assert.equal(transitionPaymentStatus('failed', 'pending'), 'failed');
  assert.equal(transitionPaymentStatus('expired', 'paid'), 'paid');
  assert.equal(transitionPaymentStatus('offset', 'pending'), 'offset');
  assert.equal(transitionPaymentStatus('offset', 'paid'), 'paid');
});

test('settled refunds remain settled when processing, pending or failure arrives late', () => {
  for (const observed of ['pending', 'failed', 'cancelled']) assert.equal(transitionRefundStatus('paid', observed), 'paid');
  assert.equal(transitionRefundStatus('failed', 'pending'), 'failed');
  assert.equal(transitionRefundStatus('pending', 'paid'), 'paid');
});

test('provider observations require exact EUR cents and local intent match', () => {
  assert.equal(validateProviderAmount({ currency: 'EUR', value: '250.00' }, '250.00'), 25000);
  for (const amount of [null, { currency: 'USD', value: '250.00' }, { currency: 'EUR', value: '250.001' }, { currency: 'EUR', value: '249.99' }]) {
    assert.throws(() => validateProviderAmount(amount, '250.00'), { code: 'PROVIDER_CONTRACT_MISMATCH' });
  }
});

const { collectMolliePages } = require('../services/mollieService');
const { createPaymentReconciler } = require('../services/paymentReconciliationService');

test('provider pagination follows the SDK contract and never applies a silently truncated list', async () => {
    const last = [{ id: 're_two' }];
    const first = [{ id: 're_one' }];
    first.nextPage = async () => last;
    assert.deepEqual(await collectMolliePages(async () => first, 'refunds'), [{ id: 're_one' }, { id: 're_two' }]);
    await assert.rejects(collectMolliePages(async () => first, 'refunds', { maxPages: 1 }), { code: 'MOLLIE_PAGINATION_LIMIT' });
});

test('bounded reconciliation releases DB connections before provider calls and advances after a timeout', async () => {
    let connected = false;
    let calls = 0;
    const seen = [];
    const reconciler = createPaymentReconciler({
        batchSize: 2,
        logger: { error() {} },
        createConnection: async () => {
            connected = true;
            return {
                execute: async (sql, params) => {
                    assert.ok(params[1] <= 2);
                    if (sql.includes('FROM rental_order_payments source')) return [[]];
                    calls += 1;
                    return [calls === 1 ? [{ id: 1, mollie_payment_id: 'tr_timeout' }, { id: 2, mollie_payment_id: 'tr_paid' }] : []];
                },
                end: async () => { connected = false; }
            };
        },
        reconcilePayment: async id => {
            assert.equal(connected, false);
            seen.push(id);
            if (id === 'tr_timeout') throw Object.assign(new Error('timeout'), { code: 'MOLLIE_TIMEOUT' });
        }
    });
    await Promise.all([reconciler.cycle(), reconciler.cycle()]);
    assert.deepEqual(seen, ['tr_timeout', 'tr_paid']);
    assert.equal(reconciler.progress.failed, 1);
    assert.equal(reconciler.progress.succeeded, 1);
    assert.equal(reconciler.progress.cursor, 2);
    await reconciler.cycle();
    assert.equal(reconciler.progress.cursor, 0);
    await reconciler.stop();
});

const { applyRefundObservation, applyChargebackObservations } = require('../services/paymentObservationService');

test('refund reconciliation recovers provider success after local ID assignment was lost', async () => {
    const ledger = { id: 4, order_id: 2, amount: '-50.00', payment_status: 'pending', mollie_payment_id: 'tr_example', mollie_refund_id: null };
    const connection = { execute: async (sql, params) => {
        if (sql.includes('WHERE mollie_refund_id =')) return [[...(ledger.mollie_refund_id === params[0] ? [ledger] : [])]];
        if (sql.includes('WHERE external_operation_key =')) { assert.equal(params[0], 'refund-operation-4'); return [[ledger]]; }
        if (sql.includes('SET mollie_refund_id =')) ledger.mollie_refund_id = params[0];
        if (sql.includes('SET payment_status =')) ledger.payment_status = params[0];
        return [{ affectedRows: 1 }];
    } };
    const refund = { id: 're_example', paymentId: 'tr_example', status: 'refunded', amount: { currency: 'EUR', value: '50.00' }, metadata: { externalOperationKey: 'refund-operation-4', orderId: '2' } };
    assert.equal(await applyRefundObservation(connection, 'tr_example', refund), 1);
    assert.equal(ledger.mollie_refund_id, 're_example');
    assert.equal(ledger.payment_status, 'paid');
    await applyRefundObservation(connection, 'tr_example', { ...refund, status: 'processing' });
    assert.equal(ledger.payment_status, 'paid');
    await assert.rejects(applyRefundObservation(connection, 'tr_other', refund), { code: 'PROVIDER_CONTRACT_MISMATCH' });
});

test('chargebacks are distinct financial resources; partial/full and stale reversal snapshots preserve physical state', async () => {
    const ledger = new Map();
    const order = { payment_status: 'paid', status: 'picked_up' };
    const connection = { execute: async (sql, params) => {
        if (sql.startsWith('SELECT id, order_id, amount')) return [[...(ledger.has(params[0]) ? [ledger.get(params[0])] : [])]];
        if (sql.includes('INSERT INTO rental_order_payments')) {
            ledger.set(params[5], { id: ledger.size + 1, order_id: params[0], amount: params[3], payment_status: params[2] });
        }
        if (sql.includes("UPDATE rental_order_payments SET payment_status = 'cancelled'")) {
            [...ledger.values()].find(row => row.id === params[0]).payment_status = 'cancelled';
        }
        if (sql.startsWith('SELECT id, payment_status FROM rental_order_payments')) return [[...ledger.values()]];
        if (sql.includes("UPDATE rental_orders SET payment_status = 'charged_back'")) order.payment_status = 'charged_back';
        if (sql.includes("UPDATE rental_orders SET payment_status = 'paid'")) order.payment_status = 'paid';
        return [{ affectedRows: 1 }];
    } };
    const payment = { id: 'tr_example', status: 'paid', amount: { currency: 'EUR', value: '100.00' } };
    const context = { order_id: 2, order_item_id: null, amount: '100.00' };
    const partial = { id: 'chb_one', paymentId: 'tr_example', amount: { currency: 'EUR', value: '40.00' } };
    const rest = { ...partial, id: 'chb_two', amount: { currency: 'EUR', value: '60.00' } };
    await applyChargebackObservations(connection, { ...payment, amountChargedBack: partial.amount }, [partial], context);
    assert.equal(order.payment_status, 'charged_back');
    assert.equal(order.status, 'picked_up');
    await applyChargebackObservations(connection, payment, [partial, rest], context);
    assert.equal([...ledger.values()].reduce((sum, row) => sum + Number(row.amount), 0), -100);
    await applyChargebackObservations(connection, payment, [partial, rest].map(row => ({ ...row, reversedAt: '2026-09-13T12:00:00Z' })), context);
    assert.equal(order.payment_status, 'paid');
    await applyChargebackObservations(connection, payment, [partial, rest], context);
    assert.equal(order.payment_status, 'paid');
    assert.equal(order.status, 'picked_up');
    assert.equal(ledger.size, 2);
    await assert.rejects(applyChargebackObservations(connection, { ...payment, amountChargedBack: { currency: 'EUR', value: '100.00' } }, [partial], context), { code: 'PROVIDER_OBSERVATION_INCOMPLETE' });
});

test('isolated provider persists idempotency across adapter restart after provider success', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'segnitz-provider-restart-'));
    const previous = { NODE_ENV: process.env.NODE_ENV, MOLLIE_TEST_MODE: process.env.MOLLIE_TEST_MODE, MOLLIE_TEST_FIXTURES_DIR: process.env.MOLLIE_TEST_FIXTURES_DIR };
    Object.assign(process.env, { NODE_ENV: 'test', MOLLIE_TEST_MODE: '1', MOLLIE_TEST_FIXTURES_DIR: directory });
    try {
        const modulePath = require.resolve('../services/mollieService');
        const request = { refund: { paymentId: 'tr_restart', amount: 40, metadata: { orderId: '2' } } };
        const first = await require(modulePath).executeMollieExternalEffect('mollie.refund.create', request, 'refund-stable-key');
        delete require.cache[modulePath];
        const restarted = require(modulePath);
        const second = await restarted.executeMollieExternalEffect('mollie.refund.create', request, 'refund-stable-key');
        assert.equal(first.id, second.id);
        assert.equal(first.metadata.externalOperationKey, 'refund-stable-key');
        assert.equal((await restarted.listMollieRefundsForPayment('tr_restart')).length, 1);
    } finally {
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('webhook and obsolete-checkout recovery share one refund in either arrival order', async () => {
    const { ensureDuplicatePaymentRefund } = require('../services/duplicateRefundService');
    const { applyExternalEffectResult } = require('../services/externalEffectsWorker');
    for (const workerFirst of [false, true]) {
        const refunds = [];
        const outbox = [];
        const connection = { execute: async (sql, params = []) => {
            if (sql.startsWith('SELECT order_id FROM rental_order_payments')) return [[{ order_id: 2 }]];
            if (sql.startsWith('SELECT product_id FROM rental_order_items')) return [[]];
            if (sql.startsWith('SELECT * FROM rental_orders')) return [[{ id: 2 }]];
            if (sql.includes("payment_type = 'duplicate_payment_refund'") && sql.startsWith('SELECT')) return [[...refunds]];
            if (sql.startsWith('SELECT amount FROM rental_order_payments')) return [[]];
            if (sql.includes('INSERT INTO rental_order_payments')) {
                refunds.push({ id: 4, payment_status: 'pending', amount: params[2], operationKey: params[4] });
                return [{ insertId: 4 }];
            }
            if (sql.includes('INSERT INTO external_effects_outbox')) {
                outbox.push({ operation_key: params[0], effect_type: params[1], payload_json: params[2], payload_hash: params[3] });
                return [{ insertId: 5 }];
            }
            if (sql.includes('FROM external_effects_outbox')) return [[outbox[0]]];
            return [{ affectedRows: 1 }];
        } };
        const webhook = () => ensureDuplicatePaymentRefund(connection, { orderId: 2, paymentId: 'tr_duplicate', amount: 50 });
        const worker = () => applyExternalEffectResult(connection, { payload: { application: {
            kind: 'cancel_payment', paymentId: 'tr_duplicate', refundIfPaid: { orderId: 2, amount: 50, sourceOperationKey: 'late-checkout' }
        } } }, { id: 'tr_duplicate', status: 'paid', amount: { currency: 'EUR', value: '50.00' } });
        if (workerFirst) { await worker(); await webhook(); } else { await webhook(); await worker(); }
        assert.equal(refunds.length, 1);
        assert.equal(outbox.length, 1);
        assert.equal(outbox[0].operation_key, 'duplicate-payment-refund-tr_duplicate');
    }
});

test('provider identity, metadata, currency and amount mismatches fail before a Paid decision', () => {
    const { validateProviderPayment } = require('../services/paymentStateService');
    const intent = { paymentId: 'tr_correct', orderId: 2, amount: '50.00' };
    const valid = { id: 'tr_correct', status: 'paid', amount: { currency: 'EUR', value: '50.00' }, metadata: { orderId: '2' } };
    assert.equal(validateProviderPayment(valid, intent), 5000);
    for (const invalid of [{ ...valid, id: 'tr_other' }, { ...valid, metadata: { orderId: '3' } },
        { ...valid, amount: { currency: 'USD', value: '50.00' } }, { ...valid, amount: { currency: 'EUR', value: '49.99' } }]) {
        assert.throws(() => validateProviderPayment(invalid, intent), { code: 'PROVIDER_CONTRACT_MISMATCH' });
    }
});
