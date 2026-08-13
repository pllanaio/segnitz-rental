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

async function executeDataStatements(connection, migrationFile) {
    for (const statement of readSqlStatements(migrationFile)) {
        const sql = removeSqlComments(statement);

        if (/^UPDATE\b/i.test(sql)) {
            await connection.query(sql);
        }
    }
}

const alignMigrationFile = path.join(
    __dirname,
    '20260813_align_dump_with_application.sql'
);
const hardenReturnMigrationFile = path.join(
    __dirname,
    '20260813_harden_return_lifecycle.sql'
);

const migrations = [
    {
        version: '20260813_01_align_dump_with_application',
        checksumSource: `v2\n${fs.readFileSync(alignMigrationFile, 'utf8')}`,
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
        checksumSource: `v2\n${fs.readFileSync(hardenReturnMigrationFile, 'utf8')}`,
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
    }
];

module.exports = {
    columnExists,
    indexExists,
    migrations
};
