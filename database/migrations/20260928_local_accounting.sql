CREATE TABLE IF NOT EXISTS billing_settings (
 id TINYINT PRIMARY KEY, settings_json JSON NOT NULL, revision INT NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS billing_sequences (
 series VARCHAR(30) PRIMARY KEY, next_number BIGINT UNSIGNED NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_documents (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 invoice_id BIGINT UNSIGNED NOT NULL,
 kind VARCHAR(30) NOT NULL,
 operation_key VARCHAR(160) NOT NULL UNIQUE,
 document_number VARCHAR(80) NOT NULL UNIQUE,
 original_document_id BIGINT UNSIGNED NULL,
 order_item_id INT NULL,
 gross_cents BIGINT NOT NULL,
 snapshot_json JSON NOT NULL,
 pdf_data LONGBLOB NOT NULL,
 pdf_sha256 CHAR(64) NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (order_id) REFERENCES rental_orders(id),
 FOREIGN KEY (invoice_id) REFERENCES rental_invoices(id),
 FOREIGN KEY (original_document_id) REFERENCES billing_documents(id)
);

DROP TABLE IF EXISTS mollie_invoice_settings;
