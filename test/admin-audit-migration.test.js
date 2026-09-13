'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { up, TRIGGERS, SIGNAL_SQL, assertAuditTriggers } = require('../database/migrations/20260913_admin_audit');
const { buildMigrationManifest } = require('../database/bootstrap');

test('audit migration preserves every previously recorded migration checksum', () => {
    const expected = require('./support/pre-admin-audit-migrations.json');
    assert.deepEqual(buildMigrationManifest().filter(item => item.version < '20260913_03'), expected);
    assert.equal(buildMigrationManifest().at(-1).version, '20260913_03_admin_audit');
});

test('append-only contract rejects missing, altered and additional triggers', () => {
    const rows = TRIGGERS.map(trigger => ({ triggerName: trigger.name, event: trigger.event, timing: 'BEFORE', statement: SIGNAL_SQL }));
    assert.doesNotThrow(() => assertAuditTriggers(rows));
    for (const changed of [rows.slice(1), [...rows, { ...rows[0], triggerName: 'unexpected' }],
        rows.map(row => ({ ...row, timing: 'AFTER' })), rows.map(row => ({ ...row, statement: 'SET @x = 1' })),
        rows.map(row => ({ ...row, event: 'INSERT' }))]) assert.throws(() => assertAuditTriggers(changed), { code: 'ADMIN_AUDIT_TRIGGER_DRIFT' });
});

test('migration retry completes missing trigger DDL without altering existing events', async () => {
    const storedEvents = [{ id: 1, snapshot: 'existing-proof' }];
    const triggers = [];
    let created = 0;
    const connection = {
        async query(sql) {
            if (sql.startsWith('CREATE TABLE IF NOT EXISTS')) return [];
            const trigger = TRIGGERS.find(item => sql.includes(`CREATE TRIGGER ${item.name}`));
            assert.ok(trigger);
            created += 1;
            if (created === 2) throw new Error('synthetic interruption after first DDL');
            triggers.push({ triggerName: trigger.name, event: trigger.event, timing: 'BEFORE', statement: SIGNAL_SQL });
            return [];
        },
        async execute() { return [triggers]; }
    };
    await assert.rejects(up(connection), /synthetic interruption/);
    assert.equal(triggers.length, 1);
    await up(connection);
    await up(connection);
    assert.equal(triggers.length, 2);
    assert.deepEqual(storedEvents, [{ id: 1, snapshot: 'existing-proof' }]);
});
