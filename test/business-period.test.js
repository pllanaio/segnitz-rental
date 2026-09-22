'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const { businessPeriodBounds, withBusinessPeriod } = require('../utils/businessPeriod');

test('actual order-filter function uses Berlin month boundaries as UTC instants', () => {
    const source = fs.readFileSync(require.resolve('../segnitz_rental'), 'utf8');
    const start = source.indexOf('function addCreatedAtRangeFilter(');
    const end = source.indexOf('\nfunction ', start + 1);
    const context = { businessPeriodBounds };
    vm.runInNewContext(source.slice(start, end), context);
    const where = [];
    const params = [];
    context.addCreatedAtRangeFilter(where, params, '2026', '07');
    assert.equal(new Date(params[0]).toISOString(), '2026-06-30T22:00:00.000Z');
    assert.equal(new Date(params[1]).toISOString(), '2026-07-31T22:00:00.000Z');
    assert.equal(params.every(value => value instanceof Date), true);
    const justAfterMidnightBerlin = new Date('2026-06-30T22:30:00Z');
    assert.equal(justAfterMidnightBerlin >= params[0] && justAfterMidnightBerlin < params[1], true);
});

test('business periods retain complete March/October and December/year boundaries', () => {
    for (const [year, month, start, end] of [
        ['2026', '03', '2026-02-28T23:00:00.000Z', '2026-03-31T22:00:00.000Z'],
        ['2026', '10', '2026-09-30T22:00:00.000Z', '2026-10-31T23:00:00.000Z'],
        ['2026', '12', '2026-11-30T23:00:00.000Z', '2026-12-31T23:00:00.000Z'],
        ['2026', '', '2025-12-31T23:00:00.000Z', '2026-12-31T23:00:00.000Z']
    ]) {
        const bounds = businessPeriodBounds(year, month, 'Europe/Berlin');
        assert.equal(bounds.start.toISOString(), start);
        assert.equal(bounds.end.toISOString(), end);
    }
    for (const args of [['9999', '01'], ['2026', '13'], ['2026', '1'], ['', '07']]) assert.throws(() => businessPeriodBounds(...args));
});

test('customer/admin filter options derive the same Berlin year/month without MySQL timezone tables', () => {
    for (const input of [new Date('2026-06-30T22:30:00Z'), '2026-06-30T22:30:00Z']) {
        const result = withBusinessPeriod({ createdAt: input, status: 'confirmed' }, 'Europe/Berlin');
        assert.equal(result.year, '2026');
        assert.equal(result.month, '07');
        assert.equal(result.status, 'confirmed');
    }
    assert.equal(withBusinessPeriod({ createdAt: new Date('2025-12-31T23:30:00Z') }, 'Europe/Berlin').year, '2026');
    assert.throws(() => withBusinessPeriod({ createdAt: '2026-06-30 22:30:00' }));
});
