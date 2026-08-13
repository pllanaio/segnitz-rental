CREATE TABLE app_schema_migrations (
    version VARCHAR(128) NOT NULL,
    checksum CHAR(64) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE app_installation (
    id TINYINT UNSIGNED NOT NULL,
    status VARCHAR(32) NOT NULL,
    setup_token_hash CHAR(64) NULL,
    setup_token_created_at DATETIME NULL,
    initialized_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT chk_app_installation_singleton CHECK (id = 1),
    CONSTRAINT chk_app_installation_status CHECK (status IN ('setup_required', 'ready'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE users (
    id INT NOT NULL AUTO_INCREMENT,
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'customer',
    first_name VARCHAR(100) NULL,
    last_name VARCHAR(100) NULL,
    company VARCHAR(255) NULL,
    phone VARCHAR(50) NULL,
    address VARCHAR(255) NULL,
    zip VARCHAR(20) NULL,
    city VARCHAR(100) NULL,
    customer_no VARCHAR(30) NULL,
    email_verified TINYINT(1) NOT NULL DEFAULT 0,
    verification_token VARCHAR(128) NULL,
    verification_expires DATETIME NULL,
    reset_token VARCHAR(255) NULL,
    reset_token_expires DATETIME NULL,
    mollie_customer_id VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_customer_no (customer_no),
    KEY idx_users_verification_token (verification_token),
    KEY idx_users_reset_token (reset_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE guest_verifications (
    id INT NOT NULL AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL,
    verification_token VARCHAR(128) NOT NULL,
    expires_at DATETIME NOT NULL,
    verified TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_guest_verifications_token (verification_token),
    KEY idx_guest_verifications_email (email),
    KEY idx_guest_verifications_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE rental_products (
    id INT NOT NULL AUTO_INCREMENT,
    product_key VARCHAR(100) NOT NULL,
    title VARCHAR(150) NOT NULL,
    description TEXT NULL,
    price_per_day DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    deposit DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    image_path VARCHAR(500) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    category VARCHAR(100) NULL,
    times_ordered INT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_rental_products_product_key (product_key),
    KEY idx_rental_products_active_popular (is_active, times_ordered)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE rental_categories (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(140) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_rental_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE rental_product_categories (
    product_id INT NOT NULL,
    category_id INT NOT NULL,
    PRIMARY KEY (product_id, category_id),
    KEY idx_rental_product_categories_category (category_id),
    CONSTRAINT fk_rpc_product FOREIGN KEY (product_id)
        REFERENCES rental_products (id) ON DELETE CASCADE,
    CONSTRAINT fk_rpc_category FOREIGN KEY (category_id)
        REFERENCES rental_categories (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE rental_product_images (
    id INT NOT NULL AUTO_INCREMENT,
    product_id INT NOT NULL,
    image_path VARCHAR(500) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_rental_product_images_product (product_id, sort_order),
    CONSTRAINT fk_rpi_product FOREIGN KEY (product_id)
        REFERENCES rental_products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE rental_carts (
    id INT NOT NULL AUTO_INCREMENT,
    session_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_rental_carts_session_status (session_id, status),
    KEY idx_rental_carts_user_status (user_email, status),
    KEY idx_rental_carts_status_updated (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE rental_cart_items (
    id INT NOT NULL AUTO_INCREMENT,
    cart_id INT NOT NULL,
    product_id INT NOT NULL,
    rental_start DATE NOT NULL,
    rental_end DATE NOT NULL,
    quantity INT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_rental_cart_items_cart (cart_id),
    KEY idx_rental_cart_items_product_period (product_id, rental_start, rental_end),
    CONSTRAINT fk_rci_cart FOREIGN KEY (cart_id)
        REFERENCES rental_carts (id) ON DELETE CASCADE,
    CONSTRAINT fk_rci_product FOREIGN KEY (product_id)
        REFERENCES rental_products (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE rental_orders (
    id INT NOT NULL AUTO_INCREMENT,
    order_no VARCHAR(50) NULL,
    cart_id INT NULL,
    user_id INT NULL,
    customer_email VARCHAR(255) NULL,
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
    confirmation_json JSON NULL,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    payment_method VARCHAR(50) NULL,
    payment_status VARCHAR(50) NULL,
    mollie_payment_id VARCHAR(255) NULL,
    mollie_checkout_url VARCHAR(2048) NULL,
    mollie_payment_status VARCHAR(50) NULL,
    mollie_payment_method VARCHAR(50) NULL,
    mollie_customer_id VARCHAR(255) NULL,
    mollie_mandate_id VARCHAR(255) NULL,
    paid_at DATETIME NULL,
    order_confirmation_sent_at DATETIME NULL,
    picked_up_at DATETIME NULL,
    picked_up_by_user_id INT NULL,
    returned_at DATETIME NULL,
    return_status VARCHAR(50) NULL DEFAULT 'pending',
    return_case_status VARCHAR(50) NULL DEFAULT NULL,
    return_processed_by_user_id INT NULL,
    cancelled_at DATETIME NULL,
    cancelled_by_user_id INT NULL,
    cancelled_by_name VARCHAR(255) NULL,
    cancel_reason TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_rental_orders_order_no (order_no),
    KEY idx_rental_orders_cart (cart_id),
    KEY idx_rental_orders_user (user_id),
    KEY idx_rental_orders_customer_created (customer_email, created_at),
    KEY idx_rental_orders_status_created (status, created_at),
    KEY idx_rental_orders_payment_created (payment_status, created_at),
    KEY idx_rental_orders_return_created (return_status, created_at),
    KEY idx_rental_orders_reserved (status, reserved_until),
    KEY idx_rental_orders_mollie_payment (mollie_payment_id),
    CONSTRAINT fk_ro_cart FOREIGN KEY (cart_id)
        REFERENCES rental_carts (id) ON DELETE SET NULL,
    CONSTRAINT fk_ro_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_ro_picked_up_by FOREIGN KEY (picked_up_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_ro_return_processed_by FOREIGN KEY (return_processed_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_ro_cancelled_by FOREIGN KEY (cancelled_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE rental_order_items (
    id INT NOT NULL AUTO_INCREMENT,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    rental_start DATE NOT NULL,
    rental_end DATE NOT NULL,
    price_per_day DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    deposit DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    adjusted_rental_start DATE NULL,
    adjusted_rental_end DATE NULL,
    adjusted_price_per_day DECIMAL(10,2) NULL,
    adjusted_rental_total DECIMAL(10,2) NULL,
    actual_return_date DATE NULL,
    item_status VARCHAR(50) NULL DEFAULT 'active',
    return_status VARCHAR(50) NULL DEFAULT 'pending',
    is_damaged TINYINT(1) NOT NULL DEFAULT 0,
    damage_description TEXT NULL,
    is_late TINYINT(1) NOT NULL DEFAULT 0,
    late_description TEXT NULL,
    deposit_decision VARCHAR(50) NULL,
    deposit_deduction_percent DECIMAL(5,2) NULL,
    deposit_deduction_amount DECIMAL(10,2) NULL,
    deposit_refund_amount DECIMAL(10,2) NULL,
    deposit_deduction_reason TEXT NULL,
    additional_charge_reason TEXT NULL,
    additional_charge_amount DECIMAL(10,2) NULL,
    return_notes TEXT NULL,
    picked_up_at DATETIME NULL,
    picked_up_by_user_id INT NULL,
    returned_at DATETIME NULL,
    return_processed_by_user_id INT NULL,
    return_case_processed_at DATETIME NULL,
    cancelled_at DATETIME NULL,
    cancelled_by_user_id INT NULL,
    cancelled_by_name VARCHAR(255) NULL,
    cancel_reason TEXT NULL,
    PRIMARY KEY (id),
    KEY idx_rental_order_items_order (order_id),
    KEY idx_rental_order_items_product_period (product_id, rental_start, rental_end),
    KEY idx_rental_order_items_status (item_status, return_status),
    CONSTRAINT fk_roi_order FOREIGN KEY (order_id)
        REFERENCES rental_orders (id) ON DELETE CASCADE,
    CONSTRAINT fk_roi_product FOREIGN KEY (product_id)
        REFERENCES rental_products (id) ON DELETE RESTRICT,
    CONSTRAINT fk_roi_picked_up_by FOREIGN KEY (picked_up_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_roi_return_processed_by FOREIGN KEY (return_processed_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_roi_cancelled_by FOREIGN KEY (cancelled_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE rental_order_payments (
    id INT NOT NULL AUTO_INCREMENT,
    order_id INT NOT NULL,
    order_item_id INT NULL,
    payment_type VARCHAR(80) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    amount DECIMAL(10,2) NOT NULL,
    mollie_payment_id VARCHAR(255) NULL,
    mollie_refund_id VARCHAR(255) NULL,
    checkout_url VARCHAR(2048) NULL,
    mollie_customer_id VARCHAR(255) NULL,
    mollie_mandate_id VARCHAR(255) NULL,
    sequence_type VARCHAR(50) NULL,
    paid_at DATETIME NULL,
    recorded_by_user_id INT NULL,
    note TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_rental_order_payments_order_type_status (order_id, payment_type, payment_status),
    KEY idx_rental_order_payments_item (order_item_id),
    KEY idx_rental_order_payments_mollie_payment (mollie_payment_id),
    KEY idx_rental_order_payments_mollie_refund (mollie_refund_id),
    CONSTRAINT fk_rop_order FOREIGN KEY (order_id)
        REFERENCES rental_orders (id) ON DELETE CASCADE,
    CONSTRAINT fk_rop_item FOREIGN KEY (order_item_id)
        REFERENCES rental_order_items (id) ON DELETE CASCADE,
    CONSTRAINT fk_rop_recorded_by FOREIGN KEY (recorded_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE rental_order_return_images (
    id INT NOT NULL AUTO_INCREMENT,
    order_id INT NOT NULL,
    order_item_id INT NOT NULL,
    image_path VARCHAR(500) NOT NULL,
    uploaded_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_rental_order_return_images_order (order_id),
    KEY idx_rental_order_return_images_item (order_item_id),
    CONSTRAINT fk_rori_order FOREIGN KEY (order_id)
        REFERENCES rental_orders (id) ON DELETE CASCADE,
    CONSTRAINT fk_rori_item FOREIGN KEY (order_item_id)
        REFERENCES rental_order_items (id) ON DELETE CASCADE,
    CONSTRAINT fk_rori_uploaded_by FOREIGN KEY (uploaded_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE mollie_webhook_events (
    id INT NOT NULL AUTO_INCREMENT,
    mollie_payment_id VARCHAR(255) NOT NULL,
    mollie_status VARCHAR(50) NOT NULL,
    processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_mollie_webhook_events_payment_status (mollie_payment_id, mollie_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE product_reviews (
    id INT NOT NULL AUTO_INCREMENT,
    product_id INT NOT NULL,
    order_id INT NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    rating TINYINT UNSIGNED NOT NULL,
    review_text TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_product_reviews_product_order_user (product_id, order_id, user_email),
    KEY idx_product_reviews_order (order_id),
    CONSTRAINT fk_pr_product FOREIGN KEY (product_id)
        REFERENCES rental_products (id) ON DELETE CASCADE,
    CONSTRAINT fk_pr_order FOREIGN KEY (order_id)
        REFERENCES rental_orders (id) ON DELETE CASCADE,
    CONSTRAINT chk_product_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE opening_hours (
    id INT NOT NULL AUTO_INCREMENT,
    weekday TINYINT UNSIGNED NOT NULL,
    is_open TINYINT(1) NOT NULL DEFAULT 1,
    open_time TIME NULL,
    close_time TIME NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_opening_hours_weekday (weekday),
    CONSTRAINT chk_opening_hours_weekday CHECK (weekday BETWEEN 0 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_sessions (
    session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    expires INT UNSIGNED NOT NULL,
    data MEDIUMTEXT COLLATE utf8mb4_bin NULL,
    PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
