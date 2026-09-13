const BLOCKING_OCCUPANCY_SQL = `AND ro.status IN (
            'reserved', 'pending_payment', 'payment_failed',
            'paid', 'confirmed', 'active', 'picked_up', 'payment_dispute', 'partially_returned', 'partially_cancelled'
        )
        AND (
            ro.status NOT IN ('reserved', 'pending_payment', 'payment_failed')
            OR ro.reserved_until > NOW()
        )
        AND roi.returned_at IS NULL
        AND COALESCE(roi.item_status, 'active') != 'cancelled'`;

async function lockRentalProducts(connection, productIds) {
    const normalizedIds = [...new Set(
        (productIds || [])
            .map(id => Number(id))
            .filter(id => Number.isInteger(id) && id > 0)
    )].sort((a, b) => a - b);

    if (normalizedIds.length === 0) return;

    const placeholders = normalizedIds.map(() => '?').join(',');
    const [products] = await connection.execute(
        `SELECT id, is_active
         FROM rental_products
         WHERE id IN (${placeholders})
         ORDER BY id
         FOR UPDATE`,
        normalizedIds
    );

    if (products.length !== normalizedIds.length) {
        throw new Error('Mindestens ein Mietprodukt wurde nicht gefunden.');
    }

    return products;
}

async function checkProductAvailability(
    connection,
    productId,
    rentalStart,
    rentalEnd,
    excludeOrderItemId = null,
    lockConflicts = false
) {
    let sql = `
        SELECT roi.id
        FROM rental_order_items roi
        JOIN rental_orders ro ON ro.id = roi.order_id
        WHERE roi.product_id = ?
        ${BLOCKING_OCCUPANCY_SQL}
        AND COALESCE(roi.adjusted_rental_start, roi.rental_start) <= ?
        AND COALESCE(roi.adjusted_rental_end, roi.rental_end) >= ?
    `;

    const params = [productId, rentalEnd, rentalStart];

    if (excludeOrderItemId) {
        sql += ` AND roi.id != ?`;
        params.push(excludeOrderItemId);
    }

    sql += ` LIMIT 1${lockConflicts ? ' FOR UPDATE' : ''}`;

    const [orderConflicts] = await connection.execute(sql, params);

    return orderConflicts.length === 0;
}

async function listProductBlockedPeriods(connection, productId) {
    const [periods] = await connection.execute(
        `SELECT DATE_FORMAT(COALESCE(roi.adjusted_rental_start, roi.rental_start), '%Y-%m-%d') AS rentalStart,
                DATE_FORMAT(COALESCE(roi.adjusted_rental_end, roi.rental_end), '%Y-%m-%d') AS rentalEnd
         FROM rental_order_items roi JOIN rental_orders ro ON ro.id = roi.order_id
         WHERE roi.product_id = ? ${BLOCKING_OCCUPANCY_SQL}
         ORDER BY COALESCE(roi.adjusted_rental_start, roi.rental_start) ASC`, [productId]
    );
    return periods;
}

module.exports = {
    checkProductAvailability, listProductBlockedPeriods,
    lockRentalProducts
};
