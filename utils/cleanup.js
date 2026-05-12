async function runDatabaseCleanup(connection) {
    const start = Date.now();

    await expireOldReservations(connection);
    await deleteExpiredGuestVerifications(connection);
    await deleteOldActiveCarts(connection);

    const duration = Date.now() - start;

    /*console.log(
        `${new Date().toISOString()} - Cleanup abgeschlossen (${duration}ms)`
    );*/
}