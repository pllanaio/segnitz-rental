async function expireOldReservations(connection) {
    const [updatedItems] = await connection.execute(
        `UPDATE rental_order_items roi
         JOIN rental_orders ro ON ro.id = roi.order_id
         SET roi.item_status = 'expired',
             roi.return_status = 'not_required'
         WHERE ro.status IN ('reserved', 'pending_payment', 'payment_failed')
         AND ro.reserved_until IS NOT NULL
         AND ro.reserved_until < NOW()`
    );

    const [updatedOrders] = await connection.execute(
        `UPDATE rental_orders
     SET status = 'expired',
         return_status = 'not_required',
         return_case_status = 'closed',
         payment_status = CASE
            WHEN payment_status IS NULL
              OR payment_status IN ('pending', 'open', 'authorized')
            THEN 'expired'
            ELSE payment_status
         END
         WHERE status IN ('reserved', 'pending_payment', 'payment_failed')
         AND reserved_until IS NOT NULL
         AND reserved_until < NOW()`
    );

    if (updatedOrders.affectedRows > 0 || updatedItems.affectedRows > 0) {
        console.log(
            `${new Date().toISOString()} - Cleanup: ${updatedOrders.affectedRows} Orders expired, ${updatedItems.affectedRows} Items expired`
        );
    }
}

async function deleteOldActiveCarts(connection) {
    const [result] = await connection.execute(
        `DELETE FROM rental_carts
         WHERE status IN ('active', 'converted')
         AND updated_at < NOW() - INTERVAL 24 HOUR`
    );

    if (result.affectedRows > 0) {
        console.log(
            `${new Date().toISOString()} - Cleanup: ${result.affectedRows} alte Carts gelöscht`
        );
    }
}

async function deleteExpiredGuestVerifications(connection) {
    const [result] = await connection.execute(
        `DELETE FROM guest_verifications
         WHERE expires_at < NOW()`
    );

    if (result.affectedRows > 0) {
        console.log(
            `${new Date().toISOString()} - Cleanup: ${result.affectedRows} abgelaufene Gast-Verifizierungen gelöscht`
        );
    }
}

async function runDatabaseCleanup(connection) {
    await connection.beginTransaction();

    try {
        await expireOldReservations(connection);
        await deleteOldActiveCarts(connection);
        await deleteExpiredGuestVerifications(connection);
        await connection.commit();
    } catch (error) {
        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.error('Rollback des Datenbank-Cleanups fehlgeschlagen:', rollbackError);
        }

        throw error;
    }
}

function cleanupLockName(databaseName) {
    const normalizedName = String(databaseName || 'unknown');
    return `segnitz-cleanup:${normalizedName}`.slice(0, 64);
}

async function runCoordinatedDatabaseCleanup(connection, { lockTimeoutSeconds = 0 } = {}) {
    const [databaseRows] = await connection.query('SELECT DATABASE() AS databaseName');
    const lockName = cleanupLockName(databaseRows[0]?.databaseName);
    const [lockRows] = await connection.execute(
        'SELECT GET_LOCK(?, ?) AS acquired',
        [lockName, lockTimeoutSeconds]
    );

    if (Number(lockRows[0]?.acquired) !== 1) {
        return { acquired: false };
    }

    try {
        await runDatabaseCleanup(connection);
        return { acquired: true };
    } finally {
        try {
            await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]);
        } catch (error) {
            console.error('Cleanup-Lock konnte nicht freigegeben werden:', error);
        }
    }
}

function createCleanupRunner(connectionFactory, options = {}) {
    if (typeof connectionFactory !== 'function') {
        throw new TypeError('Für den Cleanup-Runner ist eine Connection-Factory erforderlich.');
    }

    const cleanup = options.cleanup || runCoordinatedDatabaseCleanup;
    const onError = options.onError || (error => {
        console.error(`${new Date().toISOString()} - Fehler beim periodischen Datenbank-Cleanup:`, error);
    });
    let activeJob = null;

    function run() {
        if (activeJob) return activeJob;

        let trackedJob;
        trackedJob = (async () => {
            let connection;

            try {
                connection = await connectionFactory();
                return await cleanup(connection);
            } catch (error) {
                onError(error);
                return null;
            } finally {
                if (connection) {
                    try {
                        await connection.end();
                    } catch (error) {
                        onError(error);
                    }
                }
            }
        })().finally(() => {
            if (activeJob === trackedJob) activeJob = null;
        });

        activeJob = trackedJob;
        return activeJob;
    }

    return {
        run,
        waitForIdle() {
            return activeJob || Promise.resolve();
        }
    };
}

module.exports = {
    createCleanupRunner,
    cleanupLockName,
    runDatabaseCleanup,
    runCoordinatedDatabaseCleanup,
    expireOldReservations,
    deleteOldActiveCarts,
    deleteExpiredGuestVerifications
};
