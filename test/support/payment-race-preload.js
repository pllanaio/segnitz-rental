'use strict';
// Test-only preloader: commit a competing payment change exactly after preflight
// reads its snapshot. Never loaded by the application or included in the image.
if (process.env.NODE_ENV !== 'test' || process.env.MOLLIE_TEST_MODE !== '1' || !/(?:^|_)test(?:_|$)/.test(process.env.DB_NAME || '')) {
    throw new Error('Payment race fixture requires an isolated test database.');
}
// The lifecycle suite performs hundreds of mutations against one isolated server.
// Only this explicit test preloader raises mutation quotas; production is unchanged.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(name, ...args) {
    const result = originalLoad.call(this, name, ...args);
    if (name !== 'express-rate-limit') return result;
    return Object.assign(options => result({...options, limit: 10000}), result);
};
const mysql = require('mysql2/promise');
const createConnection = mysql.createConnection.bind(mysql);
mysql.createConnection = async (...args) => {
    const connection = await createConnection(...args);
    const execute = connection.execute.bind(connection);
    connection.execute = async (sql, params) => {
        const result = await execute(sql, params);
        if (typeof sql === 'string' && sql.includes('SELECT id, amount, payment_method, mollie_payment_id, payment_status') && !sql.includes('FOR UPDATE') && result[0][0]) {
            const payment = result[0][0];
            const [[stored]] = await execute('SELECT note FROM rental_order_payments WHERE id = ?', [payment.id]);
            const scenario = /^audit-race:(publish|paid|amount|churn)$/.exec(stored?.note || '')?.[1];
            if (scenario) {
                const rival = await createConnection(...args);
                try {
                    if (scenario === 'publish') await rival.execute("UPDATE rental_order_payments SET mollie_payment_id = ?, note = 'audit-race-done' WHERE id = ?", [`tr_test_open_race_${payment.id}`, payment.id]);
                    if (scenario === 'paid') await rival.execute("UPDATE rental_order_payments SET payment_status = 'paid', paid_at = NOW(), note = 'audit-race-done' WHERE id = ?", [payment.id]);
                    if (scenario === 'amount') await rival.execute("UPDATE rental_order_payments SET amount = amount + 1, note = 'audit-race-done' WHERE id = ?", [payment.id]);
                    if (scenario === 'churn') await rival.execute("UPDATE rental_order_payments SET payment_status = IF(payment_status = 'open', 'pending', 'open') WHERE id = ?", [payment.id]);
                } finally { await rival.end(); }
            }
        }
        return result;
    };
    return connection;
};
