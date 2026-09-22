'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { convertLegacyDatetime, migrateUtcInstants } = require('../database/migrations/20260913_utc_instants');

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

test('UTC migration checkpoints numeric IDs across interruption without converting a row twice', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({ id: String(index + 1), expires_at: '2026-07-15 12:00:00' }));
    let checkpoint;
    const connection = {
        query: async () => [[]], beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {},
        async execute(sql, values = []) {
            if (sql.includes('information_schema.COLUMNS')) return [[{ tableName: 'guest_verifications', columnName: 'expires_at', dataType: 'datetime' }]];
            if (sql.startsWith('SELECT * FROM app_datetime_migration_progress')) return [[...(checkpoint ? [{ ...checkpoint }] : [])]];
            if (sql.startsWith('SELECT CAST')) {
                const result = rows.filter(row => BigInt(row.id) > BigInt(values[0]));
                // MySQL ORDER BY resolves an unqualified SELECT alias first:
                // CAST(id AS CHAR) AS id therefore sorts lexically, not numerically.
                const aliasOrder = /ORDER BY id LIMIT/u.test(sql);
                result.sort((left, right) => aliasOrder ? left.id.localeCompare(right.id) : Number(BigInt(left.id) - BigInt(right.id)));
                return [result.slice(0, 200).map(row => ({ ...row }))];
            }
            if (sql.startsWith('UPDATE `guest_verifications`')) {
                rows.find(row => row.id === values.at(-1)).expires_at = values[0];
                return [{ affectedRows: 1 }];
            }
            if (sql.startsWith('INSERT INTO app_datetime_migration_progress')) {
                checkpoint = { interpretation: values[1], override_hash: values[2], last_id: values[3], completed: values[4] };
                return [{ affectedRows: 1 }];
            }
            throw new Error(`Unexpected migration query: ${sql}`);
        }
    };
    const env = { DB_LEGACY_DATETIME_MODE: 'berlin', DB_LEGACY_WRITERS_STOPPED: '1' };
    await assert.rejects(migrateUtcInstants(connection, { env, afterBatch() { throw new Error('simulated process interruption'); } }), /simulated process interruption/u);
    await migrateUtcInstants(connection, { env });
    await migrateUtcInstants(connection, { env });
    assert.deepEqual([...new Set(rows.map(row => row.expires_at))], ['2026-07-15 10:00:00']);
    assert.equal(checkpoint.last_id, '201');
    assert.equal(checkpoint.completed, 1);
});
