async function checkProductAvailability(connection, productId, rentalStart, rentalEnd, excludeOrderItemId = null) {
    let sql = `
        SELECT roi.id
        FROM rental_order_items roi
        JOIN rental_orders ro ON ro.id = roi.order_id
        WHERE roi.product_id = ?
        AND ro.status IN ('reserved', 'paid', 'confirmed', 'active')
        AND (ro.status != 'reserved' OR ro.reserved_until > NOW())
        AND roi.returned_at IS NULL
        AND COALESCE(roi.item_status, 'active') != 'cancelled'
        AND COALESCE(roi.adjusted_rental_start, roi.rental_start) <= ?
        AND COALESCE(roi.adjusted_rental_end, roi.rental_end) >= ?
    `;

    const params = [productId, rentalEnd, rentalStart];

    if (excludeOrderItemId) {
        sql += ` AND roi.id != ?`;
        params.push(excludeOrderItemId);
    }

    sql += ` LIMIT 1`;

    const [orderConflicts] = await connection.execute(sql, params);

    return orderConflicts.length === 0;
}

module.exports = {
    checkProductAvailability
};