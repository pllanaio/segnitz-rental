'use strict';

const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');

const TEST_USER = Object.freeze({
    email: 'test@example.com',
    password: 'TestPassword123!',
    role: 'customer'
});

const TEST_PRODUCT = Object.freeze({
    id: 1,
    productKey: 'TEST-RUETTELPLATTE',
    title: 'Test-Rüttelplatte'
});

const dropOrder = [
    'user_sessions',
    'product_reviews',
    'rental_cart_items',
    'rental_carts',
    'rental_order_items',
    'rental_orders',
    'rental_product_categories',
    'rental_product_images',
    'rental_categories',
    'rental_products',
    'opening_hours',
    'users'
];

const schemaStatements = [
    `CREATE TABLE users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        username VARCHAR(254) NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'customer',
        first_name VARCHAR(100) NULL,
        last_name VARCHAR(100) NULL,
        company VARCHAR(255) NULL,
        phone VARCHAR(50) NULL,
        address VARCHAR(255) NULL,
        zip VARCHAR(20) NULL,
        city VARCHAR(100) NULL,
        customer_no VARCHAR(50) NULL,
        email_verified TINYINT(1) NOT NULL DEFAULT 1,
        reset_token_hash VARCHAR(255) NULL,
        reset_token_expires_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_products (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        product_key VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NULL,
        price_per_day DECIMAL(10,2) NOT NULL DEFAULT 0,
        deposit DECIMAL(10,2) NOT NULL DEFAULT 0,
        image_path VARCHAR(500) NOT NULL DEFAULT '',
        category VARCHAR(255) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        times_ordered INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uq_rental_products_key (product_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_categories (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_rental_categories_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_product_categories (
        product_id INT UNSIGNED NOT NULL,
        category_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (product_id, category_id),
        CONSTRAINT fk_rpc_product FOREIGN KEY (product_id)
            REFERENCES rental_products (id) ON DELETE CASCADE,
        CONSTRAINT fk_rpc_category FOREIGN KEY (category_id)
            REFERENCES rental_categories (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_product_images (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        product_id INT UNSIGNED NOT NULL,
        image_path VARCHAR(500) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        CONSTRAINT fk_rpi_product FOREIGN KEY (product_id)
            REFERENCES rental_products (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_orders (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_no VARCHAR(50) NULL,
        customer_email VARCHAR(254) NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'reserved',
        payment_status VARCHAR(50) NULL,
        reserved_until DATETIME NULL,
        return_status VARCHAR(50) NULL,
        return_case_status VARCHAR(50) NULL,
        PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_order_items (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id INT UNSIGNED NOT NULL,
        product_id INT UNSIGNED NOT NULL,
        rental_start DATE NOT NULL,
        rental_end DATE NOT NULL,
        adjusted_rental_start DATE NULL,
        adjusted_rental_end DATE NULL,
        returned_at DATETIME NULL,
        item_status VARCHAR(50) NULL,
        return_status VARCHAR(50) NULL,
        PRIMARY KEY (id),
        KEY idx_roi_product_period (product_id, rental_start, rental_end),
        CONSTRAINT fk_roi_order FOREIGN KEY (order_id)
            REFERENCES rental_orders (id) ON DELETE CASCADE,
        CONSTRAINT fk_roi_product FOREIGN KEY (product_id)
            REFERENCES rental_products (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_carts (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_id VARCHAR(255) NOT NULL,
        user_email VARCHAR(254) NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_rental_carts_session (session_id, status),
        KEY idx_rental_carts_user (user_email, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_cart_items (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        cart_id INT UNSIGNED NOT NULL,
        product_id INT UNSIGNED NOT NULL,
        rental_start DATE NOT NULL,
        rental_end DATE NOT NULL,
        quantity INT UNSIGNED NOT NULL DEFAULT 1,
        PRIMARY KEY (id),
        CONSTRAINT fk_rci_cart FOREIGN KEY (cart_id)
            REFERENCES rental_carts (id) ON DELETE CASCADE,
        CONSTRAINT fk_rci_product FOREIGN KEY (product_id)
            REFERENCES rental_products (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE product_reviews (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        product_id INT UNSIGNED NOT NULL,
        order_id INT UNSIGNED NULL,
        user_email VARCHAR(254) NOT NULL,
        rating INT NOT NULL,
        review_text TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        CONSTRAINT fk_pr_product FOREIGN KEY (product_id)
            REFERENCES rental_products (id) ON DELETE CASCADE,
        CONSTRAINT fk_pr_order FOREIGN KEY (order_id)
            REFERENCES rental_orders (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE opening_hours (
        weekday TINYINT UNSIGNED NOT NULL,
        is_open TINYINT(1) NOT NULL DEFAULT 0,
        open_time TIME NULL,
        close_time TIME NULL,
        PRIMARY KEY (weekday)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE user_sessions (
        session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
        expires INT UNSIGNED NOT NULL,
        data MEDIUMTEXT COLLATE utf8mb4_bin,
        PRIMARY KEY (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`
];

async function resetTestDatabase() {
    const connection = await mysql.createConnection(dbConfig);

    try {
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');

        for (const table of dropOrder) {
            await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
        }

        await connection.query('SET FOREIGN_KEY_CHECKS = 1');

        for (const statement of schemaStatements) {
            await connection.query(statement);
        }

        const passwordHash = await bcrypt.hash(TEST_USER.password, 4);

        await connection.execute(
            `INSERT INTO users
             (username, password, role, first_name, last_name, phone, address, zip, city, customer_no, email_verified)
             VALUES (?, ?, ?, 'Test', 'Kunde', '0123456789', 'Teststrasse 1', '97070', 'Wuerzburg', 'TEST-0001', 1)`,
            [TEST_USER.email, passwordHash, TEST_USER.role]
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
            console.log('Testdatenbank wurde zurückgesetzt.');
        })
        .catch(error => {
            console.error('Testdatenbank konnte nicht vorbereitet werden:', error);
            process.exitCode = 1;
        });
}

module.exports = {
    resetTestDatabase,
    TEST_PRODUCT,
    TEST_USER
};
