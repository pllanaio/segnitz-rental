CREATE TABLE external_effects_outbox (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    operation_key VARCHAR(191) NOT NULL,
    effect_type VARCHAR(80) NOT NULL,
    payload_json JSON NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    max_attempts INT UNSIGNED NOT NULL DEFAULT 8,
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at DATETIME NULL,
    locked_by VARCHAR(128) NULL,
    result_json JSON NULL,
    last_error TEXT NULL,
    completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_external_effects_operation_key (operation_key),
    KEY idx_external_effects_ready (status, available_at, id),
    KEY idx_external_effects_lease (status, locked_at),
    KEY idx_external_effects_retention (status, completed_at),
    CONSTRAINT chk_external_effects_attempts CHECK (attempt_count <= max_attempts),
    CONSTRAINT chk_external_effects_status CHECK (
        status IN ('pending', 'processing', 'retry', 'succeeded', 'dead')
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The automatic migration installs the following idempotency contract via its
-- ensureColumn/ensureIndex helpers so existing and freshly created schemas are
-- both handled safely:
-- rental_order_payments.external_operation_key VARCHAR(191) NULL
-- UNIQUE uq_rental_order_payments_external_operation (external_operation_key)
