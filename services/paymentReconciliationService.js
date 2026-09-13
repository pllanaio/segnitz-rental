'use strict';

// Keyset scan cycles through every provider-backed payment, including paid ones:
// chargebacks/reversals have no reliable final local age cutoff. Every cycle is
// bounded and never holds a DB connection during a provider request.
function createPaymentReconciler({ createConnection, reconcilePayment, batchSize = 10, intervalMs = 60000, logger = console }) {
    const limit = Math.min(Math.max(Math.trunc(Number(batchSize)) || 10, 1), 100);
    const interval = Math.min(Math.max(Number(intervalMs) || 60000, 1000), 3600000);
    let cursor = 0;
    let unresolvedCursor = 0;
    let timer;
    let running = null;
    let stopping = false;
    const progress = { attempted: 0, succeeded: 0, failed: 0, lastCompletedAt: null, cursor: 0 };
    async function cycle() {
        if (stopping) return;
        if (running) return running;
        running = (async () => {
            let connection;
            let rows;
            try {
                connection = await createConnection();
                const urgentLimit = limit > 1 ? Math.floor(limit / 2) : 0;
                let urgent = [];
                if (urgentLimit) {
                    [urgent] = await connection.execute(
                        `SELECT MIN(source.id) AS id, source.mollie_payment_id FROM rental_order_payments source
                         WHERE source.mollie_payment_id IS NOT NULL AND source.mollie_refund_id IS NULL
                         AND source.payment_method = 'online'
                         AND source.payment_type IN ('initial_payment', 'rental', 'deposit', 'rental_adjustment', 'return_additional_charge')
                         AND (source.payment_status IN ('pending', 'open', 'authorized', 'failed', 'expired', 'cancelled')
                              OR EXISTS (SELECT 1 FROM rental_order_payments refund
                                         WHERE refund.mollie_payment_id = source.mollie_payment_id
                                         AND refund.amount < 0 AND refund.payment_status IN ('pending', 'failed', 'charged_back')))
                         GROUP BY source.mollie_payment_id HAVING MIN(source.id) > ? ORDER BY MIN(source.id) LIMIT ?`,
                        [unresolvedCursor, urgentLimit]
                    );
                    unresolvedCursor = urgent.length ? Number(urgent[urgent.length - 1].id) : 0;
                }
                const [historical] = await connection.execute(
                    `SELECT MIN(id) AS id, mollie_payment_id FROM rental_order_payments
                     WHERE mollie_payment_id IS NOT NULL AND mollie_refund_id IS NULL
                     AND payment_method = 'online'
                     AND payment_type IN ('initial_payment', 'rental', 'deposit', 'rental_adjustment', 'return_additional_charge')
                     GROUP BY mollie_payment_id HAVING MIN(id) > ? ORDER BY MIN(id) LIMIT ?`, [cursor, limit - urgent.length]
                );
                cursor = historical.length ? Number(historical[historical.length - 1].id) : 0;
                rows = [...new Map([...urgent, ...historical].map(row => [row.mollie_payment_id, row])).values()];
            } finally { if (connection) await connection.end(); }
            for (const row of rows) {
                if (stopping) break;
                progress.attempted += 1;
                try { await reconcilePayment(row.mollie_payment_id); progress.succeeded += 1; }
                catch (error) {
                    progress.failed += 1;
                    logger.error('payment_reconciliation_failed', { paymentRecordId: row.id, code: error.code || 'PROVIDER_ERROR' });
                }
            }
            progress.cursor = cursor;
            progress.lastCompletedAt = new Date().toISOString();
        })();
        try { await running; } finally { running = null; }
    }
    return {
        cycle, progress,
        start() {
            if (timer) return;
            stopping = false;
            timer = setInterval(() => { cycle().catch(error => logger.error('payment_reconciliation_cycle_failed', { code: error.code || 'DB_ERROR' })); }, interval);
            timer.unref?.();
        },
        async stop() { stopping = true; clearInterval(timer); timer = null; if (running) await running; }
    };
}
module.exports = { createPaymentReconciler };
