'use strict';

const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { rebuildDatabaseSchema } = require('./database-schema');

const TEST_CUSTOMER = Object.freeze({
    email: 'lifecycle.customer@example.com',
    password: 'CustomerPassword123!',
    role: 'customer'
});

const TEST_ADMIN = Object.freeze({
    email: 'lifecycle.admin@example.com',
    password: 'AdminPassword123!',
    role: 'global_admin'
});

const TEST_OTHER_CUSTOMER = Object.freeze({
    email: 'other.lifecycle.customer@example.com',
    password: 'OtherCustomerPassword123!',
    role: 'customer'
});

const TEST_UNVERIFIED_CUSTOMER = Object.freeze({
    email: 'unverified.lifecycle.customer@example.com',
    password: 'UnverifiedPassword123!',
    role: 'customer'
});

const TEST_PRODUCT = Object.freeze({
    id: 101,
    productKey: 'LIFECYCLE-BAGGER',
    title: 'Lifecycle-Minibagger',
    pricePerDay: 80,
    deposit: 300
});

async function withConnection(callback) {
    const connection = await mysql.createConnection(dbConfig);

    try {
        return await callback(connection);
    } finally {
        await connection.end();
    }
}

async function resetOrderLifecycleDatabase() {
    await withConnection(async connection => {
        await rebuildDatabaseSchema(connection);

        const [customerHash, adminHash, otherCustomerHash, unverifiedCustomerHash] = await Promise.all([
            bcrypt.hash(TEST_CUSTOMER.password, 4),
            bcrypt.hash(TEST_ADMIN.password, 4),
            bcrypt.hash(TEST_OTHER_CUSTOMER.password, 4),
            bcrypt.hash(TEST_UNVERIFIED_CUSTOMER.password, 4)
        ]);

        await connection.execute(
            `INSERT INTO users
             (username, password, role, first_name, last_name, phone, address, zip, city, customer_no, email_verified)
             VALUES (?, ?, ?, 'Lifecycle', 'Kunde', '0123456789', 'Testweg 1', '97070', 'Wuerzburg', 'LIFE-0001', 1)`,
            [TEST_CUSTOMER.email, customerHash, TEST_CUSTOMER.role]
        );

        await connection.execute(
            `INSERT INTO users
             (username, password, role, first_name, last_name, email_verified)
             VALUES (?, ?, ?, 'Lifecycle', 'Admin', 1)`,
            [TEST_ADMIN.email, adminHash, TEST_ADMIN.role]
        );

        await connection.execute(
            `INSERT INTO users
             (username, password, role, first_name, last_name, email_verified)
             VALUES (?, ?, ?, 'Andere', 'Kundin', 1)`,
            [TEST_OTHER_CUSTOMER.email, otherCustomerHash, TEST_OTHER_CUSTOMER.role]
        );

        await connection.execute(
            `INSERT INTO users
             (username, password, role, first_name, last_name, email_verified)
             VALUES (?, ?, ?, 'Nicht', 'Verifiziert', 0)`,
            [
                TEST_UNVERIFIED_CUSTOMER.email,
                unverifiedCustomerHash,
                TEST_UNVERIFIED_CUSTOMER.role
            ]
        );

        await connection.execute(
            `INSERT INTO rental_products
             (id, product_key, title, description, price_per_day, deposit, image_path, category, is_active, times_ordered)
             VALUES (?, ?, ?, 'Testprodukt für den vollständigen Bestell- und Rückgabeprozess.', ?, ?, '', 'Baumaschinen', 1, 0)`,
            [
                TEST_PRODUCT.id,
                TEST_PRODUCT.productKey,
                TEST_PRODUCT.title,
                TEST_PRODUCT.pricePerDay,
                TEST_PRODUCT.deposit
            ]
        );

        await connection.execute(
            `INSERT INTO rental_categories (id, name, slug)
             VALUES (101, 'Baumaschinen', 'baumaschinen')`
        );

        await connection.execute(
            `INSERT INTO rental_product_categories (product_id, category_id)
             VALUES (?, 101)`,
            [TEST_PRODUCT.id]
        );

        for (let weekday = 0; weekday <= 6; weekday += 1) {
            await connection.execute(
                `INSERT INTO opening_hours (weekday, is_open, open_time, close_time)
                 VALUES (?, 1, '00:00:00', '23:59:59')`,
                [weekday]
            );
        }
    });
}

async function queryRows(sql, params = []) {
    return withConnection(async connection => {
        const [rows] = await connection.execute(sql, params);
        return rows;
    });
}

async function execute(sql, params = []) {
    return withConnection(async connection => {
        const [result] = await connection.execute(sql, params);
        return result;
    });
}

module.exports = {
    execute,
    queryRows,
    resetOrderLifecycleDatabase,
    TEST_ADMIN,
    TEST_CUSTOMER,
    TEST_OTHER_CUSTOMER,
    TEST_PRODUCT,
    TEST_UNVERIFIED_CUSTOMER
};
