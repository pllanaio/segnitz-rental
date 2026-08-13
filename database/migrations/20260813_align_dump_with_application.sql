-- Einmalige Migration für Datenbanken, die aus db_segnitz.sql vom 13.08.2026 stammen.
-- Vor der Ausführung muss ein Backup der betroffenen Datenbank erstellt werden.

CREATE TABLE IF NOT EXISTS guest_verifications (
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

UPDATE rental_orders
SET return_status = 'not_required',
    return_case_status = 'closed'
WHERE status IN ('cancelled', 'expired');

ALTER TABLE rental_carts
    MODIFY status VARCHAR(50) NOT NULL DEFAULT 'active';

ALTER TABLE rental_orders
    MODIFY status VARCHAR(50) NOT NULL DEFAULT 'reserved',
    MODIFY return_status VARCHAR(50) NULL DEFAULT 'pending',
    MODIFY return_case_status VARCHAR(50) NULL DEFAULT 'open';

ALTER TABLE rental_order_items
    MODIFY item_status VARCHAR(50) NULL DEFAULT 'active',
    MODIFY return_status VARCHAR(50) NULL DEFAULT 'pending',
    MODIFY deposit_decision VARCHAR(50) NULL;

ALTER TABLE rental_order_payments
    MODIFY payment_type VARCHAR(80) NOT NULL,
    MODIFY payment_method VARCHAR(50) NOT NULL,
    MODIFY payment_status VARCHAR(50) NOT NULL DEFAULT 'pending';

ALTER TABLE rental_orders
    ADD KEY idx_rental_orders_customer_created (customer_email, created_at),
    ADD KEY idx_rental_orders_status_created (status, created_at),
    ADD KEY idx_rental_orders_payment_created (payment_status, created_at),
    ADD KEY idx_rental_orders_return_created (return_status, created_at),
    ADD KEY idx_rental_orders_reserved (status, reserved_until),
    ADD KEY idx_rental_orders_mollie_payment (mollie_payment_id);

ALTER TABLE rental_order_items
    ADD KEY idx_rental_order_items_product_period (product_id, rental_start, rental_end),
    ADD KEY idx_rental_order_items_status (item_status, return_status);

ALTER TABLE rental_order_payments
    ADD KEY idx_rental_order_payments_order_type_status (order_id, payment_type, payment_status),
    ADD KEY idx_rental_order_payments_mollie_refund (mollie_refund_id);
