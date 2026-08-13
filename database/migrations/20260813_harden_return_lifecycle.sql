-- Richtet bestehende Datenbanken auf den belastbaren Rückgabe-Lifecycle aus.
-- Vor der Ausführung muss ein Backup der betroffenen Datenbank erstellt werden.

UPDATE rental_orders
SET return_case_status = NULL
WHERE status NOT IN (
    'picked_up',
    'returned',
    'payment_dispute',
    'cancelled',
    'expired'
)
AND COALESCE(return_status, 'pending') = 'pending';

ALTER TABLE rental_orders
    MODIFY return_case_status VARCHAR(50) NULL DEFAULT NULL;

ALTER TABLE rental_order_payments
    ADD COLUMN checkout_url VARCHAR(2048) NULL AFTER mollie_refund_id;

-- Ein Auftrag mit ausschließlich zurückgegebenen oder stornierten Positionen ist
-- terminal. Ältere Teilrückgaben konnten nach der letzten Positionsstornierung
-- fälschlich auf "picked_up/partial" stehen bleiben.
UPDATE rental_orders ordersToClose
JOIN (
    SELECT
        order_id,
        SUM(COALESCE(item_status, 'active') IN ('active', 'picked_up')) AS open_count,
        SUM(COALESCE(item_status, 'active') LIKE 'returned_%') AS returned_count,
        SUM(return_status IN ('returned_late', 'returned_late_damaged')) AS late_count,
        SUM(return_status IN ('returned_damaged', 'returned_late_damaged')) AS damaged_count,
        MAX(returned_at) AS last_returned_at,
        MAX(return_processed_by_user_id) AS return_processor_id
    FROM rental_order_items
    GROUP BY order_id
) itemState ON itemState.order_id = ordersToClose.id
SET ordersToClose.status = 'returned',
    ordersToClose.return_status = CASE
        WHEN itemState.late_count > 0 AND itemState.damaged_count > 0
            THEN 'returned_late_damaged'
        WHEN itemState.damaged_count > 0 THEN 'returned_damaged'
        WHEN itemState.late_count > 0 THEN 'returned_late'
        ELSE 'returned_ok'
    END,
    ordersToClose.returned_at = COALESCE(
        ordersToClose.returned_at,
        itemState.last_returned_at,
        NOW()
    ),
    ordersToClose.return_processed_by_user_id = COALESCE(
        ordersToClose.return_processed_by_user_id,
        itemState.return_processor_id
    )
WHERE itemState.open_count = 0
AND itemState.returned_count > 0
AND ordersToClose.status NOT IN ('returned', 'cancelled', 'expired');

-- Laufende Teilrückgaben werden aus den Positionszuständen rekonstruiert.
UPDATE rental_orders openReturns
JOIN (
    SELECT
        order_id,
        SUM(COALESCE(item_status, 'active') = 'picked_up') AS picked_up_count,
        SUM(COALESCE(item_status, 'active') LIKE 'returned_%') AS returned_count
    FROM rental_order_items
    GROUP BY order_id
) itemState ON itemState.order_id = openReturns.id
SET openReturns.return_case_status = CASE
    WHEN itemState.picked_up_count > 0 AND itemState.returned_count > 0 THEN 'partial'
    WHEN itemState.picked_up_count > 0 THEN 'open'
    ELSE openReturns.return_case_status
END
WHERE openReturns.status = 'picked_up';

-- Finanzielle Abschlusszustände werden aus dem Ledger rekonstruiert. Bei
-- Erstattungs-Retries zählt nur der jüngste Datensatz je Ziel und Zahlungsquelle.
UPDATE rental_orders returnedOrders
SET returnedOrders.return_case_status = CASE
    WHEN returnedOrders.payment_status = 'charged_back' THEN 'payment_dispute'
    WHEN EXISTS (
        SELECT 1
        FROM rental_order_payments payment
        WHERE payment.order_id = returnedOrders.id
        AND payment.payment_type IN ('rental_adjustment', 'return_additional_charge')
        AND payment.payment_status IN ('failed', 'cancelled', 'expired')
    ) THEN 'payment_failed'
    WHEN EXISTS (
        SELECT 1
        FROM rental_order_payments payment
        WHERE payment.order_id = returnedOrders.id
        AND payment.payment_type IN ('rental_adjustment', 'return_additional_charge')
        AND payment.payment_status IN ('pending', 'open', 'authorized')
    ) THEN 'payment_pending'
    WHEN EXISTS (
        SELECT 1
        FROM rental_order_payments refund
        WHERE refund.order_id = returnedOrders.id
        AND refund.payment_type IN (
            'deposit_refund',
            'order_cancellation_refund',
            'duplicate_payment_refund'
        )
        AND refund.payment_status IN ('failed', 'cancelled', 'expired')
        AND NOT EXISTS (
            SELECT 1
            FROM rental_order_payments newerRefund
            WHERE newerRefund.order_id = refund.order_id
            AND newerRefund.payment_type = refund.payment_type
            AND newerRefund.order_item_id <=> refund.order_item_id
            AND newerRefund.payment_method = refund.payment_method
            AND newerRefund.mollie_payment_id <=> refund.mollie_payment_id
            AND newerRefund.id > refund.id
        )
    ) THEN 'refund_failed'
    WHEN EXISTS (
        SELECT 1
        FROM rental_order_payments refund
        WHERE refund.order_id = returnedOrders.id
        AND refund.payment_type IN (
            'deposit_refund',
            'order_cancellation_refund',
            'duplicate_payment_refund'
        )
        AND refund.payment_status IN ('pending', 'open', 'authorized')
        AND NOT EXISTS (
            SELECT 1
            FROM rental_order_payments newerRefund
            WHERE newerRefund.order_id = refund.order_id
            AND newerRefund.payment_type = refund.payment_type
            AND newerRefund.order_item_id <=> refund.order_item_id
            AND newerRefund.payment_method = refund.payment_method
            AND newerRefund.mollie_payment_id <=> refund.mollie_payment_id
            AND newerRefund.id > refund.id
        )
    ) OR EXISTS (
        SELECT 1
        FROM rental_order_items item
        WHERE item.order_id = returnedOrders.id
        AND item.item_status LIKE 'returned_%'
        AND COALESCE(item.deposit_refund_amount, 0) > 0
        AND NOT EXISTS (
            SELECT 1
            FROM rental_order_payments refund
            WHERE refund.order_id = item.order_id
            AND refund.order_item_id = item.id
            AND refund.payment_type = 'deposit_refund'
        )
    ) THEN 'refund_pending'
    ELSE 'closed'
END
WHERE returnedOrders.status = 'returned';
