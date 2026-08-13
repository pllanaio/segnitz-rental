'use strict';

const fs = require('node:fs');
const path = require('node:path');

const schemaPath = path.resolve(__dirname, '../../database/schema.sql');

const tableNames = Object.freeze([
    'user_sessions',
    'mollie_webhook_events',
    'rental_order_return_images',
    'rental_order_payments',
    'product_reviews',
    'rental_cart_items',
    'rental_order_items',
    'rental_orders',
    'rental_carts',
    'rental_product_categories',
    'rental_product_images',
    'rental_categories',
    'rental_products',
    'opening_hours',
    'guest_verifications',
    'users',
    'app_installation',
    'app_schema_migrations'
]);

function readSchemaStatements() {
    return fs.readFileSync(schemaPath, 'utf8')
        .split(/;\s*(?:\r?\n|$)/)
        .map(statement => statement.trim())
        .filter(Boolean);
}

function assertTestDatabaseName(databaseName = process.env.DB_NAME) {
    const normalizedName = String(databaseName || '').trim().toLowerCase();

    if (!/(^|[_-])(test|ci)([_-]|$)/.test(normalizedName)) {
        throw new Error(
            `Unsicherer Datenbankname "${databaseName || ''}": ` +
            'Der destruktive Test-Reset ist nur für Namen mit test oder ci erlaubt.'
        );
    }
}

async function dropDatabaseSchema(connection) {
    assertTestDatabaseName();
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    try {
        for (const table of tableNames) {
            await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
        }
    } finally {
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    }
}

async function rebuildDatabaseSchema(connection) {
    await dropDatabaseSchema(connection);

    for (const statement of readSchemaStatements()) {
        await connection.query(statement);
    }
}

module.exports = {
    assertTestDatabaseName,
    dropDatabaseSchema,
    readSchemaStatements,
    rebuildDatabaseSchema,
    schemaPath,
    tableNames
};
