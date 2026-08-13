'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    checkDatabaseReadiness,
    getCachedSchemaReadiness,
    primeSchemaReadiness,
    resetReadinessCache
} = require('../database/readiness');

test('koalesziert parallele tiefe Schema-Prüfungen und cached deren Ergebnis', async () => {
    resetReadinessCache();
    let connectionCount = 0;
    let resolveConnection;
    const gate = new Promise(resolve => { resolveConnection = resolve; });
    const connectionFactory = async () => {
        connectionCount += 1;
        await gate;
        return {
            async execute(sql) {
                if (sql.includes('information_schema.TABLES')) return [[]];
                if (sql.includes('information_schema.COLUMNS')) return [[]];
                if (sql.includes('information_schema.STATISTICS')) return [[]];
                if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [[]];
                if (sql.includes('information_schema.TABLE_CONSTRAINTS')) return [[]];
                if (sql.includes('opening_hours')) return [[]];
                throw new Error(sql);
            },
            async end() {}
        };
    };

    const checks = Array.from({ length: 10 }, () =>
        getCachedSchemaReadiness({ connectionFactory, deepCheckIntervalMs: 0 })
    );
    assert.equal(connectionCount, 1);
    resolveConnection();
    await assert.rejects(Promise.all(checks), /Kanonisches Datenbankschema/);
    assert.equal(connectionCount, 1);

    const primedSchema = { tables: 20 };
    primeSchemaReadiness(primedSchema);
    assert.equal(
        await getCachedSchemaReadiness({ connectionFactory, deepCheckIntervalMs: 300000 }),
        primedSchema
    );
    assert.equal(connectionCount, 1);
});

test('drosselt wiederholte fehlgeschlagene Deep-Checks kurzzeitig', async () => {
    resetReadinessCache();
    let connectionCount = 0;
    const schemaError = new Error('Schema vorübergehend nicht lesbar');
    const connectionFactory = async () => {
        connectionCount += 1;
        return {
            async execute() { throw schemaError; },
            async end() {}
        };
    };

    await assert.rejects(
        getCachedSchemaReadiness({ connectionFactory, deepCheckIntervalMs: 0 }),
        /vorübergehend/
    );
    await assert.rejects(
        getCachedSchemaReadiness({ connectionFactory, deepCheckIntervalMs: 0 }),
        /vorübergehend/
    );
    assert.equal(connectionCount, 1);
});

test('verwirft unbekannte Migrationen bereits im günstigen Readiness-Check', async () => {
    resetReadinessCache();
    const expectedMigration = { version: 'known_01', checksum: 'a'.repeat(64) };
    primeSchemaReadiness({ tables: 20 }, [expectedMigration]);
    let connectionEnded = false;
    const connectionFactory = async () => ({
        async query() {
            return [[{ alive: 1, sessionTimeZone: '+02:00' }]];
        },
        async execute(sql) {
            assert.match(sql, /app_schema_migrations/u);
            return [[
                expectedMigration,
                { version: 'future_02', checksum: 'b'.repeat(64) }
            ]];
        },
        async end() {
            connectionEnded = true;
        }
    });

    await assert.rejects(
        checkDatabaseReadiness({ connectionFactory }),
        /unbekannte oder neuere Migrationen: future_02/u
    );
    assert.equal(connectionEnded, true);
});

test('schließt die Ping-Verbindung vor dem gemeinsamen tiefen Schema-Check', async () => {
    resetReadinessCache();
    const expectedMigration = { version: 'known_01', checksum: 'a'.repeat(64) };
    primeSchemaReadiness({ tables: 20 }, [expectedMigration]);
    let connectionCount = 0;
    let pingConnectionEnded = false;
    const connectionFactory = async () => {
        connectionCount += 1;

        if (connectionCount === 1) {
            return {
                async query() {
                    return [[{ alive: 1, sessionTimeZone: '+02:00' }]];
                },
                async execute() {
                    return [[expectedMigration]];
                },
                async end() {
                    pingConnectionEnded = true;
                }
            };
        }

        assert.equal(pingConnectionEnded, true);
        return {
            async execute() {
                throw new Error('simulierter tiefer Schemafehler');
            },
            async end() {}
        };
    };

    await assert.rejects(
        checkDatabaseReadiness({
            connectionFactory,
            deepCheckIntervalMs: 0,
            failureRetryIntervalMs: 0
        }),
        /tiefer Schemafehler/u
    );
    assert.equal(connectionCount, 2);
});
