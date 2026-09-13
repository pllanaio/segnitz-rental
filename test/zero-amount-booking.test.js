'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { settleZeroAmountBooking } = require('../services/zeroAmountBookingService');

test('eine offene Kaution macht eine Nullpreis-Miete weiterhin zahlungspflichtig', async () => {
    let mutations = 0;
    const connection = { execute: async () => { mutations += 1; return [[]]; } };
    assert.equal(await settleZeroAmountBooking(connection, { orderId: 1, paymentMethod: 'online', totalAmount: 150, items: [{ pricePerDay: 0, deposit: 150 }] }), false);
    assert.equal(mutations, 0);
});

test('inkonsistenter Null-Gesamtpreis darf keine positive Mietabsicht als bezahlt abschließen', async () => {
    let mutations = 0;
    const connection = { execute: async () => { mutations += 1; return [[]]; } };
    await assert.rejects(settleZeroAmountBooking(connection, { orderId: 1, paymentMethod: 'online', totalAmount: 0, items: [{ pricePerDay: 50, deposit: 0 }] }));
    assert.equal(mutations, 0);
    const contradictory = { execute: async sql => {
        if (sql.startsWith('SELECT')) return [[{ id: 5 }]];
        mutations += 1;
        return [{ affectedRows: 1 }];
    } };
    await assert.rejects(settleZeroAmountBooking(contradictory, { orderId: 1, paymentMethod: 'cash', totalAmount: 0, items: [{ pricePerDay: 0, deposit: 0 }] }));
    assert.equal(mutations, 0);
});
