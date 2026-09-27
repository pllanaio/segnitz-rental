CREATE TABLE handover_reports (
    order_id INT NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    document_json JSON NOT NULL,
    pdf_data MEDIUMBLOB NULL,
    updated_by VARCHAR(255) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    signed_at DATETIME(3) NULL,
    PRIMARY KEY (order_id),
    CONSTRAINT fk_handover_order FOREIGN KEY (order_id) REFERENCES rental_orders (id),
    CONSTRAINT chk_handover_status CHECK (status IN ('draft', 'signed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
