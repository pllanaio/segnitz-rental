'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { publishPaymentFixtures, directory } = require('./support/mollie-fixtures');

test('provider fixture status comes from its explicit prefix, never scenario labels', async () => {
    const rows = [
        { id: 'tr_test_paid_cancelled_extension_42', expected: 'paid' },
        { id: 'tr_test_paid_failed_refund_43', expected: 'paid' },
        { id: 'tr_test_open_paid_history_44', expected: 'open' },
        { id: 'tr_test_cancelled_retry_45', expected: 'canceled' },
        { id: 'tr_test_expired_retry_46', expected: 'expired' }
    ];
    await publishPaymentFixtures({ execute: async () => [rows.map(row => ({ ...row, order_id: 42, amount: '80.00' }))] });
    for (const row of rows) {
        const fixture = JSON.parse(await fs.readFile(path.join(directory, `${row.id}.json`), 'utf8'));
        assert.equal(fixture.status, row.expected, row.id);
        assert.deepEqual(fixture.amount, { currency: 'EUR', value: '80.00' });
        assert.equal(fixture.metadata.orderId, '42');
    }
});
