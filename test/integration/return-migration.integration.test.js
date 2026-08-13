'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { rebuildDatabaseSchema } = require('../support/database-schema');

const migrationPath = path.resolve(
    __dirname,
    '../../database/migrations/20260813_harden_return_lifecycle.sql'
);

function readMigrationStatements() {
    return fs.readFileSync(migrationPath, 'utf8')
        .split(/;\s*(?:\r?\n|$)/)
        .map(statement => statement.trim())
        .filter(Boolean);
}

test('migriert bestehende Aufträge auf terminale und finanzielle Rückgabezustände', async () => {
    const connection = await mysql.createConnection(dbConfig);

    try {
        await rebuildDatabaseSchema(connection);
        await connection.query(
            'ALTER TABLE rental_order_payments DROP COLUMN checkout_url'
        );
        await connection.execute(
            `INSERT INTO rental_products
             (id, product_key, title, description, price_per_day, deposit, is_active)
             VALUES (901, 'RETURN-MIGRATION', 'Migrationstest', '', 80, 300, 1)`
        );
        await connection.execute(
            `INSERT INTO rental_orders
             (id, order_no, status, payment_status, return_status, return_case_status)
             VALUES
                (901, 'RMIG-901', 'confirmed', 'paid', 'pending', 'open'),
                (902, 'RMIG-902', 'picked_up', 'paid', 'pending', 'partial'),
                (903, 'RMIG-903', 'returned', 'paid', 'returned_ok', 'closed'),
                (904, 'RMIG-904', 'returned', 'paid', 'returned_ok', 'refund_failed')`
        );
        await connection.execute(
            `INSERT INTO rental_order_items
             (id, order_id, product_id, rental_start, rental_end, price_per_day, deposit,
              item_status, return_status, deposit_refund_amount, returned_at)
             VALUES
                (901, 901, 901, '2026-08-01', '2026-08-02', 80, 300,
                 'active', 'pending', NULL, NULL),
                (902, 902, 901, '2026-08-01', '2026-08-02', 80, 300,
                 'returned_ok', 'returned_ok', 300, NOW()),
                (903, 902, 901, '2026-08-03', '2026-08-04', 80, 300,
                 'cancelled', 'pending', NULL, NULL),
                (904, 903, 901, '2026-08-05', '2026-08-06', 80, 300,
                 'returned_ok', 'returned_ok', 300, NOW()),
                (905, 904, 901, '2026-08-07', '2026-08-08', 80, 300,
                 'returned_ok', 'returned_ok', 300, NOW())`
        );
        await connection.execute(
            `INSERT INTO rental_order_payments
             (order_id, order_item_id, payment_type, payment_method, payment_status,
              amount, mollie_payment_id, mollie_refund_id)
             VALUES
                (903, 904, 'deposit_refund', 'cash', 'pending', -300, NULL, NULL),
                (904, 905, 'deposit_refund', 'online', 'failed', -300,
                 'tr_migration_904', 're_failed_904'),
                (904, 905, 'deposit_refund', 'online', 'paid', -300,
                 'tr_migration_904', 're_paid_904')`
        );

        for (const statement of readMigrationStatements()) {
            await connection.query(statement);
        }

        const [orders] = await connection.execute(
            `SELECT id, status, return_status, return_case_status
             FROM rental_orders
             WHERE id BETWEEN 901 AND 904
             ORDER BY id`
        );

        assert.deepEqual(orders, [
            {
                id: 901,
                status: 'confirmed',
                return_status: 'pending',
                return_case_status: null
            },
            {
                id: 902,
                status: 'returned',
                return_status: 'returned_ok',
                return_case_status: 'refund_pending'
            },
            {
                id: 903,
                status: 'returned',
                return_status: 'returned_ok',
                return_case_status: 'refund_pending'
            },
            {
                id: 904,
                status: 'returned',
                return_status: 'returned_ok',
                return_case_status: 'closed'
            }
        ]);

        const [columnRows] = await connection.execute(
            `SELECT COLUMN_DEFAULT AS columnDefault
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'rental_orders'
             AND COLUMN_NAME = 'return_case_status'`
        );
        assert.equal(columnRows[0].columnDefault, null);
    } finally {
        await connection.end();
    }
});
