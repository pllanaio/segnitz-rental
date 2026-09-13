'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const mollie = require('../services/mollieService');

async function isolated(action) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mollie-confinement-test-'));
    const directory = path.join(root, 'fixtures');
    await fs.mkdir(directory);
    const previous = {};
    for (const name of ['NODE_ENV', 'MOLLIE_TEST_MODE', 'MOLLIE_TEST_FIXTURES_DIR', 'MOLLIE_API_KEY']) previous[name] = process.env[name];
    Object.assign(process.env, { NODE_ENV: 'test', MOLLIE_TEST_MODE: '1', MOLLIE_TEST_FIXTURES_DIR: directory });
    delete process.env.MOLLIE_API_KEY;
    try { await action({ root, directory }); }
    finally {
        for (const [name, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
        await fs.rm(root, { recursive: true, force: true });
    }
}

test('Mollie simulator refuses symlinked payment fixtures outside its directory', async () => isolated(async ({ root, directory }) => {
    const payment = { resource: 'payment', id: 'tr_test_external', status: 'paid', amount: { value: '1.00', currency: 'EUR' } };
    const outside = path.join(root, 'private-data.json');
    await fs.writeFile(outside, JSON.stringify(payment));
    await fs.symlink(outside, path.join(directory, `${payment.id}.json`));
    await assert.rejects(mollie.getMolliePayment(payment.id), { code: 'MOLLIE_TEST_FIXTURE_INVALID' });
}));

test('Mollie fixture response IDs cannot redirect persisted cancellation outside the directory', async () => isolated(async ({ root, directory }) => {
    const outside = path.join(root, 'outside.json');
    await fs.writeFile(outside, 'synthetic sentinel');
    await fs.writeFile(path.join(directory, 'tr_test_mismatched.json'), JSON.stringify({ resource: 'payment', id: '../outside', status: 'paid' }));
    await assert.rejects(mollie.cancelMolliePayment('tr_test_mismatched', { idempotencyKey: crypto.randomUUID() }),
        { code: 'MOLLIE_TEST_FIXTURE_INVALID' });
    assert.equal(await fs.readFile(outside, 'utf8'), 'synthetic sentinel');
}));

test('Mollie simulator rejects excessive fixture bytes and filesystem special objects', async () => isolated(async ({ directory }) => {
    await fs.writeFile(path.join(directory, 'tr_test_large.json'), JSON.stringify({ id: 'tr_test_large', resource: 'payment', padding: 'x'.repeat(1024 * 1024) }));
    await assert.rejects(mollie.getMolliePayment('tr_test_large'), { code: 'MOLLIE_TEST_FIXTURE_INVALID' });
    await fs.mkdir(path.join(directory, 'tr_test_directory.json'));
    await assert.rejects(mollie.getMolliePayment('tr_test_directory'), { code: 'MOLLIE_TEST_FIXTURE_INVALID' });
}));

test('isolated payment/refund persistence remains idempotent with no provider API key', async () => isolated(async ({ directory }) => {
    const operationKey = crypto.randomUUID();
    const order = { id: 17, orderNo: 'SYNTHETIC-17', totalAmount: 20, idempotencyKey: operationKey };
    const payment = await mollie.createMolliePaymentForOrder(order);
    assert.equal(payment.resource, 'payment');
    assert.deepEqual((await mollie.getMolliePayment(payment.id)).amount, { currency: 'EUR', value: '20.00' });
    assert.equal((await mollie.createMolliePaymentForOrder(order)).id, payment.id);
    const refundArgs = { paymentId: payment.id, amount: 20, idempotencyKey: crypto.randomUUID() };
    const refund = await mollie.createMollieRefundForPayment(refundArgs);
    assert.equal((await mollie.createMollieRefundForPayment(refundArgs)).id, refund.id);
    assert.equal((await mollie.listMollieRefundsForPayment(payment.id))[0].id, refund.id);
    assert.deepEqual(await mollie.listMollieChargebacksForPayment(payment.id), []);
    assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.tmp')), false);
}));

test('simulator persistence never follows or removes a pre-existing predictable temporary symlink', async () => isolated(async ({ root, directory }) => {
    const operationKey = crypto.randomUUID();
    const outside = path.join(root, 'outside.json');
    await fs.writeFile(outside, 'synthetic sentinel');
    const previousTemporary = path.join(directory, `operation-${crypto.createHash('sha256').update(operationKey).digest('hex')}.json.tmp`);
    await fs.symlink(outside, previousTemporary);
    const payment = await mollie.createMolliePaymentForOrder({ id: 18, orderNo: 'SYNTHETIC-18', totalAmount: 20, idempotencyKey: operationKey });
    assert.equal(payment.resource, 'payment');
    assert.equal(await fs.readFile(outside, 'utf8'), 'synthetic sentinel');
    assert.equal((await fs.lstat(previousTemporary)).isSymbolicLink(), true);
}));
