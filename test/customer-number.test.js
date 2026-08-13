'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    allocateCustomerNumber,
    normalizeSequenceYear
} = require('../services/customerNumberService');

test('validiert das Jahr für Kundennummern', () => {
    assert.equal(normalizeSequenceYear(2026), 2026);
    assert.throws(() => normalizeSequenceYear(1999), /Ungültiges Jahr/);
    assert.throws(() => normalizeSequenceYear('nicht-ein-jahr'), /Ungültiges Jahr/);
});

test('formatiert den atomar von MySQL reservierten Sequenzwert', async () => {
    const statements = [];
    const connection = {
        async execute(sql, params = []) {
            statements.push({ sql, params });
            if (sql.includes('SELECT LAST_INSERT_ID()')) {
                return [[{ sequenceValue: 42 }]];
            }
            return [{ affectedRows: 1 }];
        }
    };

    assert.equal(await allocateCustomerNumber(connection, 2026), 'K202600042');
    assert.match(statements[0].sql, /customer_number_sequences/);
    assert.match(statements[1].sql, /LAST_INSERT_ID\(last_value \+ 1\)/);
});
