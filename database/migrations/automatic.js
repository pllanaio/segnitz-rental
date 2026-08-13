'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readSqlStatements, removeSqlComments } = require('../sql');

function quoteIdentifier(identifier) {
    if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
        throw new Error(`Unsicherer SQL-Bezeichner: ${identifier}`);
    }

    return `\`${identifier}\``;
}

async function columnExists(connection, tableName, columnName) {
    const [rows] = await connection.execute(
        `SELECT 1
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?
         LIMIT 1`,
        [tableName, columnName]
    );

    return rows.length > 0;
}

async function indexExists(connection, tableName, indexName) {
    const [rows] = await connection.execute(
        `SELECT 1
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND INDEX_NAME = ?
         LIMIT 1`,
        [tableName, indexName]
    );

    return rows.length > 0;
}

async function constraintExists(connection, tableName, constraintName) {
    const [rows] = await connection.execute(
        `SELECT 1
         FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND CONSTRAINT_NAME = ?
         LIMIT 1`,
        [tableName, constraintName]
    );

    return rows.length > 0;
}

async function ensureColumn(connection, tableName, columnName, definition) {
    if (await columnExists(connection, tableName, columnName)) return;

    await connection.query(
        `ALTER TABLE ${quoteIdentifier(tableName)} ` +
        `ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`
    );
}

async function ensureAndModifyColumn(connection, tableName, columnName, definition) {
    await ensureColumn(connection, tableName, columnName, definition);
    await connection.query(
        `ALTER TABLE ${quoteIdentifier(tableName)} ` +
        `MODIFY COLUMN ${quoteIdentifier(columnName)} ${definition}`
    );
}

async function ensureIndex(connection, tableName, indexName, columns) {
    if (await indexExists(connection, tableName, indexName)) return;

    const columnSql = columns.map(quoteIdentifier).join(', ');

    await connection.query(
        `ALTER TABLE ${quoteIdentifier(tableName)} ` +
        `ADD INDEX ${quoteIdentifier(indexName)} (${columnSql})`
    );
}

async function ensureUniqueIndex(connection, tableName, indexName, columns) {
    if (await indexExists(connection, tableName, indexName)) return;

    const columnSql = columns.map(quoteIdentifier).join(', ');

    await connection.query(
        `ALTER TABLE ${quoteIdentifier(tableName)} ` +
        `ADD UNIQUE INDEX ${quoteIdentifier(indexName)} (${columnSql})`
    );
}

async function ensureConstraint(connection, tableName, constraintName, definition) {
    if (await constraintExists(connection, tableName, constraintName)) return;

    await connection.query(
        `ALTER TABLE ${quoteIdentifier(tableName)} ` +
        `ADD CONSTRAINT ${quoteIdentifier(constraintName)} ${definition}`
    );
}

async function executeDataStatements(connection, migrationFile) {
    for (const statement of readSqlStatements(migrationFile)) {
        const sql = removeSqlComments(statement);

        if (/^(?:INSERT|UPDATE)\b/i.test(sql)) {
            await connection.query(sql);
        }
    }
}

async function executeBusinessDataStatements(connection, migrationFile) {
    for (const statement of readSqlStatements(migrationFile)) {
        const sql = removeSqlComments(statement);
        if (/^(?:DELETE|INSERT|UPDATE)\b/i.test(sql)) await connection.query(sql);
    }
}

async function ensureGeneratedColumn(connection, tableName, columnName, definition) {
    if (await columnExists(connection, tableName, columnName)) return;
    await connection.query(
        `ALTER TABLE ${quoteIdentifier(tableName)} ` +
        `ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`
    );
}

const alignMigrationFile = path.join(
    __dirname,
    '20260813_align_dump_with_application.sql'
);
const hardenReturnMigrationFile = path.join(
    __dirname,
    '20260813_harden_return_lifecycle.sql'
);
const invariantMigrationFile = path.join(
    __dirname,
    '20260813_schema_invariants_and_opening_hours.sql'
);
const businessDataMigrationFile = path.join(__dirname, '20260813_business_data_concurrency.sql');
const externalEffectsMigrationFile = path.join(__dirname, '20260813_external_effects_outbox.sql');

const alignMigrationDependencies = Object.freeze([
    readSqlStatements,
    removeSqlComments,
    quoteIdentifier,
    columnExists,
    indexExists,
    ensureColumn,
    ensureAndModifyColumn,
    ensureIndex,
    executeDataStatements
]);
const hardenReturnMigrationDependencies = Object.freeze([
    readSqlStatements,
    removeSqlComments,
    quoteIdentifier,
    columnExists,
    ensureColumn,
    ensureAndModifyColumn,
    executeDataStatements
]);
const invariantMigrationDependencies = Object.freeze([
    readSqlStatements,
    removeSqlComments,
    quoteIdentifier,
    indexExists,
    constraintExists,
    ensureUniqueIndex,
    ensureConstraint,
    executeDataStatements
]);
const businessDataMigrationDependencies = Object.freeze([
    readSqlStatements,
    removeSqlComments,
    quoteIdentifier,
    columnExists,
    indexExists,
    ensureColumn,
    ensureIndex,
    ensureUniqueIndex,
    executeBusinessDataStatements,
    ensureGeneratedColumn
]);
const externalEffectsMigrationDependencies = Object.freeze([
    readSqlStatements,
    removeSqlComments,
    quoteIdentifier,
    columnExists,
    indexExists,
    ensureColumn,
    ensureIndex,
    ensureUniqueIndex
]);

const migrations = [
    {
        version: '20260813_01_align_dump_with_application',
        checksumVersion: 2,
        checksumSource: `v2\n${fs.readFileSync(alignMigrationFile, 'utf8')}`,
        checksumDependencies: alignMigrationDependencies,
        legacyChecksums: [
            'ddd6d9ae4d0e97f1e6e36756b10138094f84a0d7b7b4b9b87c54165c933906b7'
        ],
        async up(connection) {
            await ensureAndModifyColumn(
                connection,
                'rental_carts',
                'status',
                "VARCHAR(50) NOT NULL DEFAULT 'active'"
            );
            await ensureAndModifyColumn(
                connection,
                'rental_orders',
                'status',
                "VARCHAR(50) NOT NULL DEFAULT 'reserved'"
            );
            await ensureAndModifyColumn(
                connection,
                'rental_orders',
                'return_status',
                "VARCHAR(50) NULL DEFAULT 'pending'"
            );
            await ensureAndModifyColumn(
                connection,
                'rental_orders',
                'return_case_status',
                "VARCHAR(50) NULL DEFAULT 'open'"
            );
            await ensureAndModifyColumn(
                connection,
                'rental_order_items',
                'item_status',
                "VARCHAR(50) NULL DEFAULT 'active'"
            );
            await ensureAndModifyColumn(
                connection,
                'rental_order_items',
                'return_status',
                "VARCHAR(50) NULL DEFAULT 'pending'"
            );
            await ensureAndModifyColumn(
                connection,
                'rental_order_items',
                'deposit_decision',
                'VARCHAR(50) NULL'
            );
            await ensureAndModifyColumn(
                connection,
                'rental_order_payments',
                'payment_type',
                'VARCHAR(80) NOT NULL'
            );
            await ensureAndModifyColumn(
                connection,
                'rental_order_payments',
                'payment_method',
                'VARCHAR(50) NOT NULL'
            );
            await ensureAndModifyColumn(
                connection,
                'rental_order_payments',
                'payment_status',
                "VARCHAR(50) NOT NULL DEFAULT 'pending'"
            );

            await executeDataStatements(connection, alignMigrationFile);

            await ensureIndex(
                connection,
                'rental_orders',
                'idx_rental_orders_customer_created',
                ['customer_email', 'created_at']
            );
            await ensureIndex(
                connection,
                'rental_orders',
                'idx_rental_orders_status_created',
                ['status', 'created_at']
            );
            await ensureIndex(
                connection,
                'rental_orders',
                'idx_rental_orders_payment_created',
                ['payment_status', 'created_at']
            );
            await ensureIndex(
                connection,
                'rental_orders',
                'idx_rental_orders_return_created',
                ['return_status', 'created_at']
            );
            await ensureIndex(
                connection,
                'rental_orders',
                'idx_rental_orders_reserved',
                ['status', 'reserved_until']
            );
            await ensureIndex(
                connection,
                'rental_orders',
                'idx_rental_orders_mollie_payment',
                ['mollie_payment_id']
            );
            await ensureIndex(
                connection,
                'rental_order_items',
                'idx_rental_order_items_product_period',
                ['product_id', 'rental_start', 'rental_end']
            );
            await ensureIndex(
                connection,
                'rental_order_items',
                'idx_rental_order_items_status',
                ['item_status', 'return_status']
            );
            await ensureIndex(
                connection,
                'rental_order_payments',
                'idx_rental_order_payments_order_type_status',
                ['order_id', 'payment_type', 'payment_status']
            );
            await ensureIndex(
                connection,
                'rental_order_payments',
                'idx_rental_order_payments_mollie_refund',
                ['mollie_refund_id']
            );
        }
    },
    {
        version: '20260813_02_harden_return_lifecycle',
        checksumVersion: 2,
        checksumSource: `v2\n${fs.readFileSync(hardenReturnMigrationFile, 'utf8')}`,
        checksumDependencies: hardenReturnMigrationDependencies,
        legacyChecksums: [
            '1ff3a8ec199ba5ac54d29a9cdf4585dc887fb3abd66b4d5a051a5910c04688c8'
        ],
        async up(connection) {
            await ensureAndModifyColumn(
                connection,
                'rental_orders',
                'return_case_status',
                'VARCHAR(50) NULL DEFAULT NULL'
            );
            await ensureColumn(
                connection,
                'rental_order_payments',
                'checkout_url',
                'VARCHAR(2048) NULL'
            );

            await executeDataStatements(connection, hardenReturnMigrationFile);
        }
    },
    {
        version: '20260813_03_schema_invariants_and_opening_hours',
        checksumVersion: 2,
        checksumSource: `v1\n${fs.readFileSync(invariantMigrationFile, 'utf8')}`,
        checksumDependencies: invariantMigrationDependencies,
        async up(connection) {
            await executeDataStatements(connection, invariantMigrationFile);

            await ensureConstraint(
                connection,
                'users',
                'chk_users_email_verified',
                'CHECK (email_verified IN (0, 1))'
            );
            await ensureConstraint(
                connection,
                'guest_verifications',
                'chk_guest_verifications_verified',
                'CHECK (verified IN (0, 1))'
            );
            await ensureConstraint(
                connection,
                'rental_products',
                'chk_rental_products_values',
                'CHECK (price_per_day >= 0 AND deposit >= 0 AND is_active IN (0, 1))'
            );
            await ensureConstraint(
                connection,
                'rental_cart_items',
                'chk_rental_cart_items_period_quantity',
                'CHECK (rental_end >= rental_start AND quantity > 0)'
            );
            await ensureConstraint(
                connection,
                'rental_carts',
                'chk_rental_carts_status',
                "CHECK (status IN ('active', 'converted'))"
            );
            await ensureConstraint(
                connection,
                'rental_orders',
                'chk_rental_orders_total_amount',
                'CHECK (total_amount >= 0)'
            );
            await ensureConstraint(
                connection,
                'rental_orders',
                'chk_rental_orders_lifecycle',
                `CHECK (
                    status IN (
                        'reserved', 'pending_payment', 'payment_failed', 'paid', 'confirmed',
                        'active', 'picked_up', 'returned', 'partially_returned', 'cancelled',
                        'partially_cancelled', 'expired', 'payment_dispute'
                    )
                    AND (payment_status IS NULL OR payment_status IN (
                        'pending', 'open', 'authorized', 'paid', 'failed', 'cancelled',
                        'expired', 'charged_back', 'refunded', 'refund_pending', 'refund_failed'
                    ))
                    AND (return_status IS NULL OR return_status IN (
                        'pending', 'not_required', 'returned_ok', 'returned_damaged',
                        'returned_late', 'returned_late_damaged'
                    ))
                    AND (return_case_status IS NULL OR return_case_status IN (
                        'open', 'partial', 'closed', 'payment_failed', 'payment_pending',
                        'refund_failed', 'refund_pending', 'payment_dispute'
                    ))
                )`
            );
            await ensureConstraint(
                connection,
                'rental_order_items',
                'chk_rental_order_items_values',
                `CHECK (
                    rental_end >= rental_start
                    AND price_per_day >= 0
                    AND deposit >= 0
                    AND is_damaged IN (0, 1)
                    AND is_late IN (0, 1)
                    AND (adjusted_rental_start IS NULL) = (adjusted_rental_end IS NULL)
                    AND (adjusted_rental_end IS NULL OR adjusted_rental_end >= adjusted_rental_start)
                    AND (adjusted_price_per_day IS NULL OR adjusted_price_per_day >= 0)
                    AND (adjusted_rental_total IS NULL OR adjusted_rental_total >= 0)
                    AND (deposit_deduction_percent IS NULL OR deposit_deduction_percent BETWEEN 0 AND 100)
                    AND (deposit_deduction_amount IS NULL OR deposit_deduction_amount >= 0)
                    AND (deposit_refund_amount IS NULL OR deposit_refund_amount >= 0)
                    AND (additional_charge_amount IS NULL OR additional_charge_amount >= 0)
                )`
            );
            await ensureConstraint(
                connection,
                'rental_order_items',
                'chk_rental_order_items_lifecycle',
                `CHECK (
                    (item_status IS NULL OR item_status IN (
                        'active', 'picked_up', 'cancelled', 'expired', 'returned_ok',
                        'returned_damaged', 'returned_late', 'returned_late_damaged'
                    ))
                    AND (return_status IS NULL OR return_status IN (
                        'pending', 'not_required', 'returned_ok', 'returned_damaged',
                        'returned_late', 'returned_late_damaged'
                    ))
                    AND (deposit_decision IS NULL OR deposit_decision IN (
                        'no_refund', 'full_refund', 'partial_refund'
                    ))
                )`
            );
            await ensureConstraint(
                connection,
                'rental_order_payments',
                'chk_rental_order_payments_lifecycle',
                `CHECK (
                    payment_type IN (
                        'initial_payment', 'rental', 'deposit', 'rental_adjustment',
                        'return_additional_charge', 'deposit_refund',
                        'order_cancellation_refund', 'duplicate_payment_refund',
                        'chargeback', 'refund_record'
                    )
                    AND payment_status IN (
                        'pending', 'open', 'authorized', 'paid', 'failed', 'cancelled',
                        'expired', 'charged_back', 'offset', 'replaced', 'refunded'
                    )
                )`
            );
            await ensureConstraint(
                connection,
                'opening_hours',
                'chk_opening_hours_values',
                `CHECK (
                    (is_open = 0 AND open_time IS NULL AND close_time IS NULL)
                    OR
                    (is_open = 1 AND open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time)
                )`
            );

            await ensureUniqueIndex(
                connection,
                'rental_order_items',
                'uq_rental_order_items_id_order',
                ['id', 'order_id']
            );
            await ensureConstraint(
                connection,
                'rental_order_payments',
                'fk_rop_item_order',
                `FOREIGN KEY (order_item_id, order_id)
                 REFERENCES rental_order_items (id, order_id) ON DELETE CASCADE`
            );
            await ensureConstraint(
                connection,
                'rental_order_return_images',
                'fk_rori_item_order',
                `FOREIGN KEY (order_item_id, order_id)
                 REFERENCES rental_order_items (id, order_id) ON DELETE CASCADE`
            );
        }
    },
    {
        version: '20260813_04_business_data_concurrency',
        checksumVersion: 2,
        checksumSource: `v1\n${fs.readFileSync(businessDataMigrationFile, 'utf8')}`,
        checksumDependencies: businessDataMigrationDependencies,
        async up(connection) {
            await connection.query(`CREATE TABLE IF NOT EXISTS customer_number_sequences (
                sequence_year SMALLINT UNSIGNED NOT NULL,
                last_value INT UNSIGNED NOT NULL DEFAULT 0,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (sequence_year)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
            await executeBusinessDataStatements(connection, businessDataMigrationFile);
            await ensureGeneratedColumn(
                connection, 'rental_carts', 'active_guest_session_id',
                `VARCHAR(255) GENERATED ALWAYS AS (
                    CASE WHEN status = 'active' AND user_email IS NULL THEN session_id ELSE NULL END
                ) STORED`
            );
            await ensureGeneratedColumn(
                connection, 'rental_carts', 'active_user_email',
                `VARCHAR(255) GENERATED ALWAYS AS (
                    CASE WHEN status = 'active' AND user_email IS NOT NULL THEN LOWER(user_email) ELSE NULL END
                ) STORED`
            );
            await ensureUniqueIndex(connection, 'rental_carts', 'uq_rental_carts_active_guest', ['active_guest_session_id']);
            await ensureUniqueIndex(connection, 'rental_carts', 'uq_rental_carts_active_user', ['active_user_email']);
            await ensureUniqueIndex(
                connection, 'rental_cart_items', 'uq_rental_cart_items_exact_period',
                ['cart_id', 'product_id', 'rental_start', 'rental_end']
            );
            await ensureColumn(connection, 'rental_orders', 'guest_access_token_hash', 'CHAR(64) NULL');
            await ensureColumn(connection, 'rental_orders', 'guest_access_token_expires_at', 'DATETIME NULL');
            await ensureIndex(
                connection, 'rental_orders', 'idx_rental_orders_guest_access_expiry',
                ['guest_access_token_expires_at']
            );
        }
    },
    {
        version: '20260813_05_external_effects_outbox',
        checksumVersion: 2,
        checksumSource: `v1\n${fs.readFileSync(externalEffectsMigrationFile, 'utf8')}`,
        checksumDependencies: externalEffectsMigrationDependencies,
        async up(connection) {
            for (const statement of readSqlStatements(externalEffectsMigrationFile)) {
                const sql = removeSqlComments(statement);
                if (/^CREATE\s+TABLE\b/i.test(sql)) {
                    await connection.query(sql.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS '));
                }
            }
            await ensureColumn(
                connection, 'external_effects_outbox', 'payload_hash', 'CHAR(64) NULL'
            );
            await connection.execute(
                `UPDATE external_effects_outbox
                 SET payload_hash = SHA2(CAST(payload_json AS CHAR), 256)
                 WHERE payload_hash IS NULL`
            );
            await connection.query(
                `ALTER TABLE external_effects_outbox
                 MODIFY COLUMN payload_hash CHAR(64) NOT NULL`
            );
            await ensureColumn(
                connection, 'rental_order_payments', 'external_operation_key', 'VARCHAR(191) NULL'
            );
            await ensureUniqueIndex(
                connection, 'rental_order_payments',
                'uq_rental_order_payments_external_operation', ['external_operation_key']
            );
            await ensureIndex(
                connection, 'external_effects_outbox',
                'idx_external_effects_retention', ['status', 'completed_at']
            );
        }
    },
    {
        version: '20260813_06_user_auth_version',
        checksumVersion: 1,
        checksumSource: 'users.auth_version INT UNSIGNED NOT NULL DEFAULT 1',
        checksumDependencies: [
            readSqlStatements,
            removeSqlComments,
            quoteIdentifier,
            columnExists,
            ensureColumn
        ],
        async up(connection) {
            await ensureColumn(
                connection,
                'users',
                'auth_version',
                'INT UNSIGNED NOT NULL DEFAULT 1'
            );
        }
    }
];

module.exports = {
    columnExists,
    constraintExists,
    indexExists,
    migrations
};
