async function expireOldReservations(connection) {
    const [updatedItems] = await connection.execute(
        `UPDATE rental_order_items roi
         JOIN rental_orders ro ON ro.id = roi.order_id
         SET roi.item_status = 'expired',
             roi.return_status = 'not_required'
         WHERE ro.status = 'reserved'
         AND ro.reserved_until IS NOT NULL
         AND ro.reserved_until < NOW()`
    );

    const [updatedOrders] = await connection.execute(
        `UPDATE rental_orders
         SET status = 'expired',
             return_status = 'not_required',
             return_case_status = 'closed'
         WHERE status = 'reserved'
         AND reserved_until IS NOT NULL
         AND reserved_until < NOW()`
    );

    if (updatedOrders.affectedRows > 0 || updatedItems.affectedRows > 0) {
        console.log(
            `${new Date().toISOString()} - Cleanup: ${updatedOrders.affectedRows} Orders expired, ${updatedItems.affectedRows} Items expired`
        );
    }
}

async function deleteExpiredGuestVerifications(connection) {
    const [result] = await connection.execute(
        `DELETE FROM guest_verifications
         WHERE expires_at IS NOT NULL
         AND expires_at < NOW()`
    );

    if (result.affectedRows > 0) {
        console.log(
            `${new Date().toISOString()} - Cleanup: ${result.affectedRows} Guest-Verifications gelöscht`
        );
    }
}

async function deleteOldActiveCarts(connection) {
    const [result] = await connection.execute(
        `DELETE FROM rental_carts
         WHERE status = 'active'
         AND updated_at < NOW() - INTERVAL 24 HOUR`
    );

    if (result.affectedRows > 0) {
        console.log(
            `${new Date().toISOString()} - Cleanup: ${result.affectedRows} alte Carts gelöscht`
        );
    }
}

async function runDatabaseCleanup(connection) {
    await expireOldReservations(connection);
    await deleteExpiredGuestVerifications(connection);
    await deleteOldActiveCarts(connection);
}

module.exports = {
    runDatabaseCleanup,
    expireOldReservations,
    deleteExpiredGuestVerifications,
    deleteOldActiveCarts
};