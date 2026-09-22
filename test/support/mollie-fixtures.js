'use strict';
// Contract-shaped local provider fixtures. No network or real credentials are used.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const directory = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'segnitz-mollie-test-'));
process.env.MOLLIE_TEST_FIXTURES_DIR = directory;
async function publishPaymentFixtures(connection) {
    const [rows] = await connection.execute(
        `SELECT mollie_payment_id AS id, order_id, SUM(amount) AS amount
         FROM rental_order_payments WHERE mollie_payment_id LIKE 'tr_test_%'
         AND payment_type IN ('initial_payment', 'rental_adjustment', 'return_additional_charge')
         GROUP BY mollie_payment_id, order_id`
    );
    for (const row of rows) {
        // IDs also contain scenario descriptions (e.g. paid_cancelled_extension).
        // Those labels must never override the explicit provider observation.
        const declared = /^tr_test_(open|pending|paid|failed|expired|authorized|cancelled|canceled)_/.exec(row.id)?.[1];
        const status = declared === 'cancelled' ? 'canceled' : declared || 'open';
        const fixture = { resource: 'payment', id: row.id, status, method: status === 'paid' ? 'ideal' : null,
            amount: { currency: 'EUR', value: Number(row.amount).toFixed(2) }, metadata: { orderId: String(row.order_id) } };
        const file = path.join(directory, `${row.id}.json`);
        await fs.writeFile(`${file}.tmp`, JSON.stringify(fixture));
        await fs.rename(`${file}.tmp`, file);
    }
}
module.exports = { publishPaymentFixtures, directory };
