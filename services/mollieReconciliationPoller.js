'use strict';

// Localhost cannot receive Mollie's webhooks. Poll known payments in bounded
// batches as recovery, including paid payments (later refunds and chargebacks).
function startMollieReconciliationPoller(createConnection, reconcile) {
    if (process.env.MOLLIE_TEST_MODE === '1' || process.env.NODE_ENV === 'test' ||
        process.env.MOLLIE_RECONCILIATION_ENABLED === '0' || !process.env.MOLLIE_API_KEY) {
        return { stop: async () => {} };
    }
    let cursor = '';
    let running = null;
    let stopped = false;
    async function run() {
        const connection = await createConnection();
        let payments;
        try {
            [payments] = await connection.execute(
                `SELECT DISTINCT mollie_payment_id AS id FROM rental_order_payments
                 WHERE payment_method = 'online' AND mollie_payment_id IS NOT NULL
                 AND mollie_payment_id NOT LIKE 'tr_test_%' AND mollie_payment_id > ?
                 ORDER BY mollie_payment_id LIMIT 20`, [cursor]
            );
        } finally { await connection.end(); }
        if (!payments.length) { cursor = ''; return; }
        for (const payment of payments) {
            if (stopped) break;
            try { await reconcile(payment.id); }
            catch (error) { console.warn(`Mollie-Abgleich ${payment.id}: ${error.message}`); }
            cursor = payment.id;
        }
        if (payments.length < 20) cursor = '';
    }
    const timer = setInterval(() => {
        if (!running) running = run().catch(error => console.warn('Mollie-Abgleich:', error.message))
            .finally(() => { running = null; });
    }, 60000);
    timer.unref?.();
    return { async stop() { stopped = true; clearInterval(timer); if (running) await running; } };
}

module.exports = { startMollieReconciliationPoller };
