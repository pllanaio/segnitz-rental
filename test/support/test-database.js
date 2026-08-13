'use strict';

const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { rebuildDatabaseSchema } = require('./database-schema');

const TEST_USER = Object.freeze({
    email: 'test@example.com',
    password: 'TestPassword123!',
    role: 'customer'
});

const TEST_ADMIN = Object.freeze({
    email: 'admin@example.com',
    password: 'AdminPassword123!',
    role: 'global_admin'
});

const TEST_PRODUCT = Object.freeze({
    id: 1,
    productKey: 'TEST-RUETTELPLATTE',
    title: 'Test-Rüttelplatte'
});

async function resetTestDatabase() {
    const connection = await mysql.createConnection(dbConfig);

    try {
        await rebuildDatabaseSchema(connection);

        const [passwordHash, adminPasswordHash] = await Promise.all([
            bcrypt.hash(TEST_USER.password, 4),
            bcrypt.hash(TEST_ADMIN.password, 4)
        ]);

        await connection.execute(
            `INSERT INTO users
             (username, password, role, first_name, last_name, phone, address, zip, city, customer_no, email_verified)
             VALUES (?, ?, ?, 'Test', 'Kunde', '0123456789', 'Teststrasse 1', '97070', 'Wuerzburg', 'TEST-0001', 1)`,
            [TEST_USER.email, passwordHash, TEST_USER.role]
        );

        await connection.execute(
            `INSERT INTO users
             (username, password, role, first_name, last_name, email_verified)
             VALUES (?, ?, ?, 'Test', 'Admin', 1)`,
            [TEST_ADMIN.email, adminPasswordHash, TEST_ADMIN.role]
        );

        await connection.execute(
            `INSERT INTO rental_products
             (id, product_key, title, description, price_per_day, deposit, image_path, category, is_active, times_ordered)
             VALUES (?, ?, ?, 'Automatisches Testprodukt für CI und Browser-Tests.', 49.90, 150.00, '', 'Baumaschinen', 1, 0)`,
            [TEST_PRODUCT.id, TEST_PRODUCT.productKey, TEST_PRODUCT.title]
        );

        await connection.execute(
            `INSERT INTO rental_categories (id, name, slug)
             VALUES (1, 'Baumaschinen', 'baumaschinen')`
        );

        await connection.execute(
            `INSERT INTO rental_product_categories (product_id, category_id)
             VALUES (?, 1)`,
            [TEST_PRODUCT.id]
        );

        for (let weekday = 0; weekday <= 6; weekday += 1) {
            await connection.execute(
                `INSERT INTO opening_hours (weekday, is_open, open_time, close_time)
                 VALUES (?, 1, '00:00:00', '23:59:59')`,
                [weekday]
            );
        }
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    resetTestDatabase()
        .then(() => {
            console.log('Testdatenbank wurde mit database/schema.sql zurückgesetzt.');
        })
        .catch(error => {
            console.error('Testdatenbank konnte nicht vorbereitet werden:', error);
            process.exitCode = 1;
        });
}

module.exports = {
    resetTestDatabase,
    TEST_ADMIN,
    TEST_PRODUCT,
    TEST_USER
};
