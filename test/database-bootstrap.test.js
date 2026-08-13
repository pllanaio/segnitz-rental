'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildMigrationManifest,
    makeCreateTableIdempotent,
    hasExistingApplicationTables,
    legacyMigrationChecksum,
    migrationChecksum,
    recordFreshSchemaMigrations,
    runAutomaticMigrations,
    quoteIdentifier,
    validateConfiguredSetupToken,
    validateDatabaseConfig
} = require('../database/bootstrap');
const { migrations } = require('../database/migrations/automatic');
const {
    SchemaVerificationError,
    buildActualForeignKeys,
    normalizeActualColumn,
    normalizeCheckClause,
    normalizeGenerationExpression,
    normalizeReferentialRule,
    parseCanonicalSchema,
    schemaPartsEqual,
    verifyCanonicalSchema
} = require('../database/schemaContract');
const {
    setupTokenMatches,
    validateAdminInput
} = require('../services/setupService');

test('validiert die für den automatischen Bootstrap nötige Datenbankkonfiguration', () => {
    assert.doesNotThrow(() => validateDatabaseConfig({
        host: '127.0.0.1',
        port: 3306,
        user: 'rental',
        database: 'segnitz-rental_$'
    }));

    assert.throws(
        () => validateDatabaseConfig({ host: '', port: 3306, user: 'rental', database: 'rental' }),
        /host fehlt/
    );
    assert.throws(
        () => validateDatabaseConfig({ host: 'db', port: 0, user: 'rental', database: 'rental' }),
        /DB_PORT/
    );
    assert.throws(
        () => validateDatabaseConfig({ host: 'db', port: 3306, user: 'rental', database: 'bad`name' }),
        /DB_NAME/
    );
});

test('quotiert ausschließlich bekannte sichere SQL-Bezeichner', () => {
    assert.equal(quoteIdentifier('rental_orders'), '`rental_orders`');
    assert.throws(() => quoteIdentifier('rental_orders; DROP TABLE users'), /Unsicherer/);
});

test('macht ausschließlich CREATE-TABLE-Anweisungen idempotent', () => {
    assert.equal(
        makeCreateTableIdempotent('CREATE TABLE users (id INT)'),
        'CREATE TABLE IF NOT EXISTS users (id INT)'
    );
    assert.equal(
        makeCreateTableIdempotent('UPDATE users SET role = role'),
        'UPDATE users SET role = role'
    );
});

test('erkennt ein frisches Schema auch neben fremden Tabellen', () => {
    const canonicalSchema = new Map([
        ['users', {}],
        ['rental_orders', {}]
    ]);

    assert.equal(hasExistingApplicationTables(new Set(['unrelated_table']), canonicalSchema), false);
    assert.equal(hasExistingApplicationTables(new Set(['unrelated_table', 'users']), canonicalSchema), true);
});

test('berechnet für jede automatische Migration eine stabile Prüfsumme', () => {
    for (const migration of migrations) {
        const checksum = migrationChecksum(migration);
        assert.match(checksum, /^[a-f0-9]{64}$/);
        assert.equal(checksum, migrationChecksum(migration));
    }
});

test('akzeptiert Legacy-Prüfsummen nur für den unveränderten SQL-Quelltext', () => {
    const migration = migrations[0];
    assert.equal(legacyMigrationChecksum(migration), migration.legacyChecksums[0]);
    assert.notEqual(
        legacyMigrationChecksum({ ...migration, checksumSource: `${migration.checksumSource}\nSELECT 1` }),
        migration.legacyChecksums[0]
    );
});

test('bindet Migration-Version, Up-Logik und Helper in die Prüfsumme ein', () => {
    const migration = {
        version: 'test_01',
        checksumSource: 'SELECT 1',
        checksumDependencies: [function helper() { return 1; }],
        async up() { return true; }
    };

    assert.notEqual(migrationChecksum(migration), migrationChecksum({
        ...migration,
        version: 'test_02'
    }));
    assert.notEqual(migrationChecksum(migration), migrationChecksum({
        ...migration,
        async up() { return false; }
    }));
    assert.notEqual(migrationChecksum(migration), migrationChecksum({
        ...migration,
        checksumDependencies: [function helper() { return 2; }]
    }));
});

test('bindet SQL-Lese- und Kommentarlogik in jede Migrationsprüfsumme ein', () => {
    for (const migration of migrations) {
        const dependencySources = (migration.checksumDependencies || [])
            .map(dependency => Function.prototype.toString.call(dependency))
            .join('\n');

        assert.match(dependencySources, /readFileSync/);
        assert.match(dependencySources, /startsWith\('--'\)/);
    }
});

test('bricht vor Up-Logik ab, wenn die Datenbank eine unbekannte Migration enthält', async () => {
    let upCalls = 0;
    const migrationList = [{
        version: 'known_01',
        checksumSource: 'SELECT 1',
        async up() { upCalls += 1; }
    }];
    const expectedManifest = buildMigrationManifest(migrationList);
    const connection = {
        async execute(sql) {
            assert.match(sql, /SELECT version, checksum/u);
            return [[
                expectedManifest[0],
                { version: 'future_02', checksum: 'f'.repeat(64) }
            ]];
        }
    };

    await assert.rejects(
        runAutomaticMigrations(connection, migrationList),
        /unbekannte oder neuere Migrationen: future_02/u
    );
    assert.equal(upCalls, 0);
});

test('markiert ein frisches finales Schema ohne Legacy-Up-Logik als migriert', async () => {
    let upCalls = 0;
    const records = [];
    const freshMigrations = [{
        version: 'fresh_01',
        checksumSource: 'CREATE TABLE final_schema (id INT)',
        async up() { upCalls += 1; }
    }];
    const connection = {
        async execute(sql, params) {
            records.push({ sql, params });
            return [{ affectedRows: 1 }];
        }
    };

    assert.deepEqual(
        await recordFreshSchemaMigrations(connection, freshMigrations),
        ['fresh_01']
    );
    assert.equal(upCalls, 0);
    assert.equal(records.length, 1);
    assert.equal(records[0].params[0], 'fresh_01');
    assert.match(records[0].params[1], /^[a-f0-9]{64}$/u);
});

test('normalisiert MySQL-Zeichensatzpräfixe ohne Lifecycle-Werte zu verändern', () => {
    assert.equal(
        normalizeCheckClause("status IN (_utf8mb4'pending_payment', 'payment_failed')"),
        normalizeCheckClause("status IN ('pending_payment', 'payment_failed')")
    );
    assert.notEqual(
        normalizeCheckClause("status IN ('pending_payment')"),
        normalizeCheckClause("status IN ('pending')")
    );
});

test('normalisiert die CHECK_CLAUSE-Darstellung aus MySQL 8.4 ohne Drift zu verbergen', () => {
    const mysqlClause =
        "((`status` in (_utf8mb4'setup_required' collate utf8mb4_0900_ai_ci," +
        "_utf8mb4'ready' collate utf8mb4_0900_ai_ci)))";

    assert.equal(
        normalizeCheckClause(mysqlClause),
        normalizeCheckClause("status IN ('setup_required', 'ready')")
    );
    assert.notEqual(
        normalizeCheckClause(mysqlClause),
        normalizeCheckClause("status IN ('setup_required', 'disabled')")
    );
    assert.notEqual(
        normalizeCheckClause("status COLLATE utf8mb4_bin = 'ready'"),
        normalizeCheckClause("status = 'ready'")
    );
});

test('normalisiert echte MySQL-8.4-Fremdschlüsselmetadaten strukturell', () => {
    const actual = buildActualForeignKeys([
        {
            tableName: 'rental_product_categories',
            constraintName: 'fk_rpc_product',
            columnName: 'product_id',
            referencedTable: 'rental_products',
            referencedColumn: 'id',
            deleteRule: 'CASCADE',
            updateRule: 'NO ACTION'
        }
    ]).get('rental_product_categories.fk_rpc_product');
    const expected = {
        columns: ['product_id'],
        deleteRule: 'CASCADE',
        referencedColumns: ['id'],
        referencedTable: 'rental_products',
        type: 'FOREIGN KEY',
        updateRule: 'RESTRICT'
    };

    assert.equal(normalizeReferentialRule('NO ACTION'), 'RESTRICT');
    assert.equal(schemaPartsEqual(actual, expected), true);
    assert.equal(schemaPartsEqual(actual, { ...expected, deleteRule: 'SET NULL' }), false);
});

test('normalisiert echte MySQL-8.4-Metadaten gespeicherter generierter Spalten', () => {
    const carts = parseCanonicalSchema().get('rental_carts').columns;
    const guestColumn = normalizeActualColumn({
        columnType: 'varchar(255)',
        defaultValue: null,
        extra: 'STORED GENERATED',
        generationExpression:
            "(case when ((`status` = _utf8mb4'active') and (`user_email` is null)) " +
            'then `session_id` else NULL end)',
        isNullable: 'YES'
    });
    const userColumn = normalizeActualColumn({
        columnType: 'varchar(255)',
        defaultValue: null,
        extra: 'STORED GENERATED',
        generationExpression:
            "(case when ((`status` = _utf8mb4'active') and (`user_email` is not null)) " +
            'then lower(`user_email`) else NULL end)',
        isNullable: 'YES'
    });

    assert.deepEqual(guestColumn, carts.get('active_guest_session_id'));
    assert.deepEqual(userColumn, carts.get('active_user_email'));
    assert.equal(schemaPartsEqual(guestColumn, { ...guestColumn, columnType: 'varchar(191)' }), false);
    assert.equal(schemaPartsEqual(guestColumn, { ...guestColumn, defaultValue: 'active' }), false);
});

test('normalisiert echte MySQL-Klammerung ohne AND/OR-Präzedenz zu verlieren', () => {
    assert.equal(
        normalizeCheckClause(
            "((`status` = _utf8mb4'active') and (`user_email` is null))"
        ),
        normalizeCheckClause("status = 'active' AND user_email IS NULL")
    );
    assert.equal(
        normalizeGenerationExpression(
            "CASE WHEN ((`status` = _utf8mb4'active') and (`user_email` is null)) " +
            'THEN `session_id` ELSE NULL END'
        ),
        normalizeGenerationExpression(
            "CASE WHEN status = 'active' AND user_email IS NULL THEN session_id ELSE NULL END"
        )
    );
    assert.notEqual(
        normalizeCheckClause("(is_open = 0 AND open_time IS NULL) OR is_open = 1"),
        normalizeCheckClause("is_open = 0 AND (open_time IS NULL OR is_open = 1)")
    );
});

test('liefert bei Schema-Drift normalisierte Expected/Actual-Metadaten', async () => {
    const contract = new Map([['test_table', {
        columns: new Map([['generated_value', {
            columnType: 'varchar(255)',
            defaultValue: null,
            generationExpression: "case when status='active' then source_value else null end",
            generationStorage: 'stored',
            nullable: true
        }]]),
        constraints: new Map([['chk_test_status', {
            type: 'CHECK',
            clause: normalizeCheckClause("status IN ('active', 'converted')")
        }]]),
        indexes: new Map()
    }]]);
    const resultSets = [
        [[{ tableName: 'test_table' }]],
        [[{
            tableName: 'test_table',
            columnName: 'generated_value',
            columnType: 'varchar(255)',
            isNullable: 'YES',
            defaultValue: null,
            extra: 'STORED GENERATED',
            generationExpression: "case when (`status` = _utf8mb4'active') then `source_value` else NULL end"
        }]],
        [[]],
        [[]],
        [[{
            tableName: 'test_table',
            constraintName: 'chk_test_status',
            checkClause: "`status` in (_utf8mb4'active',_utf8mb4'archived')"
        }]],
        [[...Array(7).keys()].map(weekday => ({ weekday }))]
    ];
    const connection = {
        async execute() {
            return resultSets.shift();
        }
    };

    await assert.rejects(
        verifyCanonicalSchema(connection, contract),
        error => {
            assert.equal(error instanceof SchemaVerificationError, true);
            assert.deepEqual(error.issues, [
                'Constraint test_table.chk_test_status fehlt oder weicht ab'
            ]);
            assert.deepEqual(error.mismatches, [{
                identifier: 'test_table.chk_test_status',
                kind: 'constraint',
                expected: {
                    type: 'CHECK',
                    clause: "status in('active','converted')"
                },
                actual: {
                    clause: "status in('active','archived')",
                    type: 'CHECK'
                }
            }]);
            assert.deepEqual(error.mismatchDetails, [
                'constraint test_table.chk_test_status: ' +
                'expected={"type":"CHECK","clause":"status in(\'active\',\'converted\')"} ' +
                'actual={"clause":"status in(\'active\',\'archived\')","type":"CHECK"}'
            ]);
            const inspectedError = require('node:util').inspect(error);
            assert.match(inspectedError, /expected=.*converted/u);
            assert.match(inspectedError, /actual=.*archived/u);
            return true;
        }
    );
});

test('leitet Spalten, Defaults, Indizes und Constraints aus dem kanonischen Schema ab', () => {
    const contract = parseCanonicalSchema();
    const orders = contract.get('rental_orders');

    assert.equal(orders.columns.get('status').defaultValue, 'reserved');
    assert.deepEqual(orders.indexes.get('uq_rental_orders_order_no'), {
        columns: ['order_no'],
        unique: true
    });
    assert.equal(orders.constraints.get('chk_rental_orders_lifecycle').type, 'CHECK');
});

test('validiert optional konfigurierte Setup-Codes', () => {
    assert.equal(validateConfiguredSetupToken(''), null);
    assert.equal(
        validateConfiguredSetupToken('a-secure-setup-token-for-tests'),
        'a-secure-setup-token-for-tests'
    );
    assert.throws(() => validateConfiguredSetupToken('too-short'), /ADMIN_SETUP_TOKEN/);
});

test('vergleicht Setup-Codes über ihre konstante SHA-256-Repräsentation', () => {
    const expectedHash = require('../services/setupService').hashSetupToken('correct-token');
    assert.equal(setupTokenMatches('correct-token', expectedHash), true);
    assert.equal(setupTokenMatches('wrong-token', expectedHash), false);
    assert.equal(setupTokenMatches('correct-token', ''), false);
});

test('erzwingt für den ersten Admin eine starke und normalisierte Anmeldung', () => {
    const input = validateAdminInput({
        setupToken: 'setup-token',
        firstName: ' Leon ',
        lastName: ' Admin ',
        email: ' ADMIN@EXAMPLE.COM ',
        password: 'VerySecure123!'
    });

    assert.deepEqual(input, {
        setupToken: 'setup-token',
        firstName: 'Leon',
        lastName: 'Admin',
        email: 'admin@example.com',
        password: 'VerySecure123!'
    });

    assert.throws(
        () => validateAdminInput({
            setupToken: 'setup-token',
            firstName: 'Leon',
            lastName: 'Admin',
            email: 'admin@example.com',
            password: 'weak123!'
        }),
        /Adminpasswort/
    );

    assert.throws(
        () => validateAdminInput({
            setupToken: 'setup-token',
            firstName: 'Leon',
            lastName: 'Admin',
            email: 'admin@example.com',
            password: `Aa1!${'x'.repeat(69)}`
        }),
        /72 Bytes/
    );
});
