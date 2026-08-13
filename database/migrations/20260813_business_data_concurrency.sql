CREATE TABLE IF NOT EXISTS customer_number_sequences (
    sequence_year SMALLINT UNSIGNED NOT NULL,
    sequence_value INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (sequence_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO customer_number_sequences (sequence_year, sequence_value)
SELECT
    CAST(SUBSTRING(customer_no, 2, 4) AS UNSIGNED),
    MAX(CAST(SUBSTRING(customer_no, 6) AS UNSIGNED))
FROM users
WHERE customer_no REGEXP '^K[0-9]{9}$'
GROUP BY CAST(SUBSTRING(customer_no, 2, 4) AS UNSIGNED)
ON DUPLICATE KEY UPDATE
    sequence_value = GREATEST(sequence_value, VALUES(sequence_value));

INSERT INTO rental_cart_items
    (cart_id, product_id, rental_start, rental_end, quantity)
SELECT
    duplicate_user_cart.keep_id,
    item.product_id,
    item.rental_start,
    item.rental_end,
    MAX(item.quantity)
FROM rental_carts source_cart
JOIN (
    SELECT user_email, MAX(id) AS keep_id
    FROM rental_carts
    WHERE status = 'active' AND user_email IS NOT NULL
    GROUP BY user_email
    HAVING COUNT(*) > 1
) duplicate_user_cart ON duplicate_user_cart.user_email = source_cart.user_email
JOIN rental_cart_items item ON item.cart_id = source_cart.id
WHERE source_cart.status = 'active'
AND source_cart.id != duplicate_user_cart.keep_id
AND NOT EXISTS (
    SELECT 1
    FROM rental_cart_items keep_item
    WHERE keep_item.cart_id = duplicate_user_cart.keep_id
    AND keep_item.product_id = item.product_id
    AND keep_item.rental_start = item.rental_start
    AND keep_item.rental_end = item.rental_end
)
GROUP BY duplicate_user_cart.keep_id, item.product_id, item.rental_start, item.rental_end;

INSERT INTO rental_cart_items
    (cart_id, product_id, rental_start, rental_end, quantity)
SELECT
    duplicate_guest_cart.keep_id,
    item.product_id,
    item.rental_start,
    item.rental_end,
    MAX(item.quantity)
FROM rental_carts source_cart
JOIN (
    SELECT session_id, MAX(id) AS keep_id
    FROM rental_carts
    WHERE status = 'active' AND user_email IS NULL
    GROUP BY session_id
    HAVING COUNT(*) > 1
) duplicate_guest_cart ON duplicate_guest_cart.session_id = source_cart.session_id
JOIN rental_cart_items item ON item.cart_id = source_cart.id
WHERE source_cart.status = 'active'
AND source_cart.user_email IS NULL
AND source_cart.id != duplicate_guest_cart.keep_id
AND NOT EXISTS (
    SELECT 1
    FROM rental_cart_items keep_item
    WHERE keep_item.cart_id = duplicate_guest_cart.keep_id
    AND keep_item.product_id = item.product_id
    AND keep_item.rental_start = item.rental_start
    AND keep_item.rental_end = item.rental_end
)
GROUP BY duplicate_guest_cart.keep_id, item.product_id, item.rental_start, item.rental_end;

UPDATE rental_carts cart
JOIN (
    SELECT user_email, MAX(id) AS keep_id
    FROM rental_carts
    WHERE status = 'active' AND user_email IS NOT NULL
    GROUP BY user_email
    HAVING COUNT(*) > 1
) duplicate_user_cart ON duplicate_user_cart.user_email = cart.user_email
SET cart.status = 'converted'
WHERE cart.status = 'active'
AND cart.id != duplicate_user_cart.keep_id;

UPDATE rental_carts cart
JOIN (
    SELECT session_id, MAX(id) AS keep_id
    FROM rental_carts
    WHERE status = 'active' AND user_email IS NULL
    GROUP BY session_id
    HAVING COUNT(*) > 1
) duplicate_guest_cart ON duplicate_guest_cart.session_id = cart.session_id
SET cart.status = 'converted'
WHERE cart.status = 'active'
AND cart.user_email IS NULL
AND cart.id != duplicate_guest_cart.keep_id;

DELETE duplicate_item
FROM rental_cart_items duplicate_item
JOIN rental_cart_items keep_item
  ON keep_item.cart_id = duplicate_item.cart_id
 AND keep_item.product_id = duplicate_item.product_id
 AND keep_item.rental_start = duplicate_item.rental_start
 AND keep_item.rental_end = duplicate_item.rental_end
 AND keep_item.id < duplicate_item.id;

ALTER TABLE rental_carts
    ADD COLUMN active_guest_session_id VARCHAR(255)
        GENERATED ALWAYS AS (
            CASE
                WHEN status = 'active' AND user_email IS NULL THEN session_id
                ELSE NULL
            END
        ) STORED,
    ADD COLUMN active_user_email VARCHAR(255)
        GENERATED ALWAYS AS (
            CASE
                WHEN status = 'active' AND user_email IS NOT NULL THEN LOWER(user_email)
                ELSE NULL
            END
        ) STORED,
    ADD UNIQUE KEY uq_rental_carts_active_guest (active_guest_session_id),
    ADD UNIQUE KEY uq_rental_carts_active_user (active_user_email);

ALTER TABLE rental_cart_items
    ADD UNIQUE KEY uq_rental_cart_items_exact_period
        (cart_id, product_id, rental_start, rental_end);

ALTER TABLE rental_orders
    ADD COLUMN guest_access_token_hash CHAR(64) NULL,
    ADD COLUMN guest_access_token_expires_at DATETIME NULL,
    ADD KEY idx_rental_orders_guest_access_expiry (guest_access_token_expires_at);
