'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { convertLegacyDatetime } = require('../database/migrations/20260913_utc_instants');

test('Berlin legacy instants use their historical offset, not startup offset', () => {
    assert.equal(convertLegacyDatetime('2026-01-15 12:00:00', { mode: 'berlin' }), '2026-01-15 11:00:00');
    assert.equal(convertLegacyDatetime('2026-07-15 12:00:00', { mode: 'berlin' }), '2026-07-15 10:00:00');
    assert.equal(convertLegacyDatetime('2026-07-15 12:00:00', { mode: 'utc' }), '2026-07-15 12:00:00');
    assert.equal(convertLegacyDatetime(null, { mode: 'berlin' }), null);
});

test('DST gap and fold require an explicit audited per-cell decision', () => {
    for (const stored of ['2026-03-29 02:10:00', '2026-10-25 02:10:00']) {
        assert.throws(() => convertLegacyDatetime(stored, { mode: 'berlin', key: 'users.1.reset_token_expires' }), { code: 'DB_LEGACY_DATETIME_REVIEW_REQUIRED' });
    }
    const key = 'users.1.reset_token_expires';
    const overrides = { [key]: { stored: '2026-10-25 02:10:00', utc: '2026-10-25T01:10:00Z', reason: 'Provider/UTC audit confirms second occurrence.' } };
    assert.equal(convertLegacyDatetime('2026-10-25 02:10:00', { mode: 'berlin', key, overrides }), '2026-10-25 01:10:00');
    assert.throws(() => convertLegacyDatetime('2026-10-25 02:11:00', { mode: 'berlin', key, overrides }), /veralteter/);
});

test('invalid stored dates cannot silently normalize into another date', () => {
    assert.throws(() => convertLegacyDatetime('2026-02-30 12:00:00', { mode: 'utc' }), /ungültiges Kalenderdatum/);
});
