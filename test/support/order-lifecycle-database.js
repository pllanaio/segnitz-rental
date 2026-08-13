'use strict';

const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');

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

const TEST_PRODUCT = Object.freeze({
    id: 101,
    productKey: 'LIFECYCLE-BAGGER',
    title: 'Lifecycle-Minibagger',
    pricePerDay: 80,
    deposit: 300
});

const dropOrder = [
    'user_sessions',
    'mollie_webhook_events',
    'rental_order_return_images',
    'rental_order_payments',
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
    'guest_verifications',
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
        verification_token_hash VARCHAR(255) NULL,
        verification_token_expires_at DATETIME NULL,
        reset_token_hash VARCHAR(255) NULL,
        reset_token_expires_at DATETIME NULL,
        mollie_customer_id VARCHAR(100) NULL,
        mollie_mandate_id VARCHAR(100) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE guest_verifications (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(254) NOT NULL,
        token_hash VARCHAR(255) NULL,
        expires_at DATETIME NULL,
        PRIMARY KEY (id)
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
        CONSTRAINT fk_lifecycle_rpc_product FOREIGN KEY (product_id)
            REFERENCES rental_products (id) ON DELETE CASCADE,
        CONSTRAINT fk_lifecycle_rpc_category FOREIGN KEY (category_id)
            REFERENCES rental_categories (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_product_images (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        product_id INT UNSIGNED NOT NULL,
        image_path VARCHAR(500) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        CONSTRAINT fk_lifecycle_rpi_product FOREIGN KEY (product_id)
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
        KEY idx_lifecycle_carts_session (session_id, status),
        KEY idx_lifecycle_carts_user (user_email, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_cart_items (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        cart_id INT UNSIGNED NOT NULL,
        product_id INT UNSIGNED NOT NULL,
        rental_start DATE NOT NULL,
        rental_end DATE NOT NULL,
        quantity INT UNSIGNED NOT NULL DEFAULT 1,
        PRIMARY KEY (id),
        CONSTRAINT fk_lifecycle_rci_cart FOREIGN KEY (cart_id)
            REFERENCES rental_carts (id) ON DELETE CASCADE,
        CONSTRAINT fk_lifecycle_rci_product FOREIGN KEY (product_id)
            REFERENCES rental_products (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_orders (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_no VARCHAR(50) NULL,
        cart_id INT UNSIGNED NULL,
        user_id INT UNSIGNED NULL,
        customer_email VARCHAR(254) NULL,
        customer_first_name VARCHAR(100) NULL,
        customer_last_name VARCHAR(100) NULL,
        customer_company VARCHAR(255) NULL,
        customer_phone VARCHAR(50) NULL,
        customer_address VARCHAR(255) NULL,
        customer_zip VARCHAR(20) NULL,
        customer_city VARCHAR(100) NULL,
        signature_data_url LONGTEXT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'reserved',
        reserved_until DATETIME NULL,
        confirmation_json LONGTEXT NULL,
        total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        payment_method VARCHAR(50) NULL,
        payment_status VARCHAR(50) NULL,
        mollie_payment_id VARCHAR(100) NULL,
        mollie_checkout_url VARCHAR(500) NULL,
        mollie_payment_status VARCHAR(50) NULL,
        mollie_payment_method VARCHAR(50) NULL,
        mollie_customer_id VARCHAR(100) NULL,
        mollie_mandate_id VARCHAR(100) NULL,
        paid_at DATETIME NULL,
        order_confirmation_sent_at DATETIME NULL,
        picked_up_at DATETIME NULL,
        picked_up_by_user_id INT UNSIGNED NULL,
        returned_at DATETIME NULL,
        return_status VARCHAR(50) NULL,
        return_case_status VARCHAR(50) NULL,
        return_processed_by_user_id INT UNSIGNED NULL,
        cancel_reason TEXT NULL,
        cancelled_by_user_id INT UNSIGNED NULL,
        cancelled_by_name VARCHAR(254) NULL,
        cancelled_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_lifecycle_order_no (order_no),
        KEY idx_lifecycle_orders_payment (mollie_payment_id),
        CONSTRAINT fk_lifecycle_order_cart FOREIGN KEY (cart_id)
            REFERENCES rental_carts (id) ON DELETE SET NULL,
        CONSTRAINT fk_lifecycle_order_user FOREIGN KEY (user_id)
            REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_order_items (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id INT UNSIGNED NOT NULL,
        product_id INT UNSIGNED NOT NULL,
        rental_start DATE NOT NULL,
        rental_end DATE NOT NULL,
        price_per_day DECIMAL(10,2) NOT NULL DEFAULT 0,
        deposit DECIMAL(10,2) NOT NULL DEFAULT 0,
        adjusted_rental_start DATE NULL,
        adjusted_rental_end DATE NULL,
        adjusted_price_per_day DECIMAL(10,2) NULL,
        adjusted_rental_total DECIMAL(10,2) NULL,
        actual_return_date DATE NULL,
        item_status VARCHAR(50) NULL DEFAULT 'active',
        return_status VARCHAR(50) NULL,
        is_damaged TINYINT(1) NOT NULL DEFAULT 0,
        damage_description TEXT NULL,
        is_late TINYINT(1) NOT NULL DEFAULT 0,
        late_description TEXT NULL,
        deposit_decision VARCHAR(50) NULL,
        deposit_deduction_percent DECIMAL(10,2) NULL,
        deposit_deduction_amount DECIMAL(10,2) NULL,
        deposit_refund_amount DECIMAL(10,2) NULL,
        deposit_deduction_reason TEXT NULL,
        additional_charge_reason TEXT NULL,
        additional_charge_amount DECIMAL(10,2) NULL,
        return_notes TEXT NULL,
        picked_up_at DATETIME NULL,
        picked_up_by_user_id INT UNSIGNED NULL,
        returned_at DATETIME NULL,
        return_processed_by_user_id INT UNSIGNED NULL,
        return_case_processed_at DATETIME NULL,
        cancelled_at DATETIME NULL,
        cancelled_by_user_id INT UNSIGNED NULL,
        cancelled_by_name VARCHAR(254) NULL,
        cancel_reason TEXT NULL,
        PRIMARY KEY (id),
        KEY idx_lifecycle_roi_product_period (product_id, rental_start, rental_end),
        CONSTRAINT fk_lifecycle_roi_order FOREIGN KEY (order_id)
            REFERENCES rental_orders (id) ON DELETE CASCADE,
        CONSTRAINT fk_lifecycle_roi_product FOREIGN KEY (product_id)
            REFERENCES rental_products (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_order_payments (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id INT UNSIGNED NOT NULL,
        order_item_id INT UNSIGNED NULL,
        payment_type VARCHAR(80) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        payment_status VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        mollie_payment_id VARCHAR(100) NULL,
        mollie_refund_id VARCHAR(100) NULL,
        mollie_customer_id VARCHAR(100) NULL,
        mollie_mandate_id VARCHAR(100) NULL,
        sequence_type VARCHAR(50) NULL,
        note TEXT NULL,
        paid_at DATETIME NULL,
        recorded_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_lifecycle_payments_order (order_id),
        KEY idx_lifecycle_payments_mollie (mollie_payment_id),
        CONSTRAINT fk_lifecycle_payment_order FOREIGN KEY (order_id)
            REFERENCES rental_orders (id) ON DELETE CASCADE,
        CONSTRAINT fk_lifecycle_payment_item FOREIGN KEY (order_item_id)
            REFERENCES rental_order_items (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE rental_order_return_images (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id INT UNSIGNED NOT NULL,
        order_item_id INT UNSIGNED NOT NULL,
        image_path VARCHAR(500) NOT NULL,
        uploaded_by_user_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        CONSTRAINT fk_lifecycle_return_image_order FOREIGN KEY (order_id)
            REFERENCES rental_orders (id) ON DELETE CASCADE,
        CONSTRAINT fk_lifecycle_return_image_item FOREIGN KEY (order_item_id)
            REFERENCES rental_order_items (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE mollie_webhook_events (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        mollie_payment_id VARCHAR(100) NOT NULL,
        mollie_status VARCHAR(50) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_lifecycle_webhook_event (mollie_payment_id, mollie_status)
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
        CONSTRAINT fk_lifecycle_review_product FOREIGN KEY (product_id)
            REFERENCES rental_products (id) ON DELETE CASCADE,
        CONSTRAINT fk_lifecycle_review_order FOREIGN KEY (order_id)
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
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');

        for (const table of dropOrder) {
            await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
        }

        await connection.query('SET FOREIGN_KEY_CHECKS = 1');

        for (const statement of schemaStatements) {
            await connection.query(statement);
        }

        const [customerHash, adminHash] = await Promise.all([
            bcrypt.hash(TEST_CUSTOMER.password, 4),
            bcrypt.hash(TEST_ADMIN.password, 4)
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
    TEST_PRODUCT
};
