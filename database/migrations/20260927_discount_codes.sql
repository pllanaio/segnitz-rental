CREATE TABLE discount_codes (
    id INT NOT NULL AUTO_INCREMENT,
    code VARCHAR(40) NOT NULL,
    percent DECIMAL(5,2) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    valid_from DATE NULL,
    valid_until DATE NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    updated_by VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_discount_code (code),
    CONSTRAINT chk_discount_percent CHECK (percent > 0 AND percent <= 100),
    CONSTRAINT chk_discount_dates CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
