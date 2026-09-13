'use strict';

const bcrypt = require('bcrypt');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { assertTestDatabaseName, rebuildDatabaseSchema } = require('./database-schema');

const TEST_USER = Object.freeze({
    email: 'test@example.com',
    password: 'TestPassword123!',
    role: 'customer'
});

const TEST_FOREIGN_USER = Object.freeze({ email: 'foreign@example.com', password: 'ForeignTestPassword123!', role: 'customer' });

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

async function expireTestUserSessions() {
    assertTestDatabaseName(dbConfig.database);
    const connection = await mysql.createConnection(dbConfig);
    try {
        // Persisted-store TTL only, scoped to the known synthetic fixture user.
        // No session IDs, cookies, CSRF values or payloads leave this helper.
        const [result] = await connection.execute(
            `UPDATE user_sessions SET expires = UNIX_TIMESTAMP() - 1
             WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.user')) = ?`,
            [TEST_USER.email]
        );
        return Number(result.affectedRows);
    } finally {
        await connection.end();
    }
}

async function createPrimaryScenarioFixtures(label) {
    assertTestDatabaseName(dbConfig.database);
    if (!/^\d{3,4}-retry-\d{1,2}$/u.test(label)) throw new Error('Ungültige Browserfixture-Bezeichnung.');
    const marker = randomUUID();
    const identity = { email: `primary.${marker}@example.com`, password: TEST_USER.password, role: 'customer' };
    const product = { productKey: `PRIMARY-${marker}`, title: `Hauptablauf-Rüttelplatte ${label}` };
    const passwordHash = await bcrypt.hash(identity.password, 4);
    const connection = await mysql.createConnection(dbConfig);
    try {
        await connection.beginTransaction();
        await connection.execute(
            `INSERT INTO users (username, password, role, first_name, last_name, phone, address, zip, city, customer_no, email_verified)
             VALUES (?, ?, 'customer', 'Browser', 'Testkunde', '0123456789', 'Teststrasse 1', '97070', 'Wuerzburg', ?, 1)`,
            [identity.email, passwordHash, `P-${marker.replace(/-/g, '').slice(0, 24)}`]
        );
        const [insert] = await connection.execute(
            `INSERT INTO rental_products (product_key, title, description, price_per_day, deposit, image_path, category, is_active, times_ordered)
             VALUES (?, ?, 'Isoliertes Produkt für einen Browserhauptablauf.', 49.90, 150.00, '', 'Baumaschinen', 1, 0)`,
            [product.productKey, product.title]
        );
        product.id = Number(insert.insertId);
        const [category] = await connection.execute(
            `INSERT INTO rental_product_categories (product_id, category_id)
             SELECT ?, id FROM rental_categories WHERE name = 'Baumaschinen' LIMIT 1`, [product.id]
        );
        if (Number(category.affectedRows) !== 1) throw new Error('Browserfixture-Kategorie fehlt.');
        await connection.commit();
        return { identity, product };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }
}

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
            `INSERT INTO users (username, password, role, first_name, last_name, customer_no, email_verified)
             VALUES (?, ?, 'customer', 'Fremder', 'Testkunde', 'TEST-0002', 1)`,
            [TEST_FOREIGN_USER.email, await bcrypt.hash(TEST_FOREIGN_USER.password, 4)]
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
    createPrimaryScenarioFixtures,
    expireTestUserSessions,
    resetTestDatabase,
    TEST_ADMIN,
    TEST_FOREIGN_USER,
    TEST_PRODUCT,
    TEST_USER
};
