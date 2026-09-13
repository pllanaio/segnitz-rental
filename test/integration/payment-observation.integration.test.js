'use strict';
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { resetOrderLifecycleDatabase, TEST_PRODUCT } = require('../support/order-lifecycle-database');
const { lockBookingOrder, resolveInitialPaymentBooking } = require('../../services/bookingPaymentService');
const { lockRentalProducts, checkProductAvailability } = require('../../utils/availability');
const { applyRefundObservation, applyChargebackObservations } = require('../../services/paymentObservationService');

before(resetOrderLifecycleDatabase);

test('two real MySQL sessions: expired A cannot regain B occupancy without cleanup, clock is controlled', async () => {
    const a = await mysql.createConnection(dbConfig);
    const b = await mysql.createConnection(dbConfig);
    try {
        const [[identityA]] = await a.query('SELECT CONNECTION_ID() AS id');
        const [[identityB]] = await b.query('SELECT CONNECTION_ID() AS id');
        assert.notEqual(identityA.id, identityB.id);
        const clock = new Date('2026-10-24T10:00:00.000Z');
        for (const connection of [a, b]) await connection.query('SET timestamp = ?', [clock.getTime() / 1000]);
        const [insertA] = await a.execute("INSERT INTO rental_orders (order_no, status, payment_status, payment_method, reserved_until, total_amount) VALUES ('HOLD-A', 'reserved', 'pending', 'online', DATE_ADD(NOW(), INTERVAL 15 MINUTE), 100)");
        const [itemA] = await a.execute("INSERT INTO rental_order_items (order_id, product_id, rental_start, rental_end) VALUES (?, ?, '2026-10-25', '2026-10-26')", [insertA.insertId, TEST_PRODUCT.id]);
        const afterExpiry = clock.getTime() / 1000 + 901;
        for (const connection of [a, b]) await connection.query('SET timestamp = ?', [afterExpiry]);
        await b.beginTransaction();
        await lockRentalProducts(b, [TEST_PRODUCT.id]);
        assert.equal(await checkProductAvailability(b, TEST_PRODUCT.id, '2026-10-25', '2026-10-26', null, true), true);
        const [insertB] = await b.execute("INSERT INTO rental_orders (order_no, status, payment_status, payment_method) VALUES ('HOLD-B', 'confirmed', 'pending', 'cash')");
        await b.execute("INSERT INTO rental_order_items (order_id, product_id, rental_start, rental_end) VALUES (?, ?, '2026-10-25', '2026-10-26')", [insertB.insertId, TEST_PRODUCT.id]);
        await a.beginTransaction();
        const latePayment = (async () => {
            const { order } = await lockBookingOrder(a, insertA.insertId);
            return resolveInitialPaymentBooking(a, order, 'paid', { now: new Date(afterExpiry * 1000) });
        })();
        await b.commit();
        const result = await latePayment;
        assert.equal(result.status, 'expired');
        assert.equal(result.reservationLost, true);
        await a.commit();
        assert.equal(await checkProductAvailability(a, TEST_PRODUCT.id, '2026-10-25', '2026-10-26', itemA.insertId), false);
        const [valid] = await a.execute("SELECT COUNT(*) AS count FROM rental_orders WHERE id IN (?, ?) AND status = 'confirmed'", [insertA.insertId, insertB.insertId]);
        assert.equal(Number(valid[0].count), 1);
    } finally { await Promise.allSettled([a.rollback(), b.rollback()]); await Promise.allSettled([a.end(), b.end()]); }
});

test('real MySQL refund recovery and chargeback reversal are idempotent and preserve picked-up occupancy', async () => {
    const connection = await mysql.createConnection(dbConfig);
    try {
        const [order] = await connection.execute("INSERT INTO rental_orders (order_no, status, payment_status, total_amount) VALUES ('FINANCIAL-EVENTS', 'picked_up', 'paid', 100)");
        await connection.execute("INSERT INTO rental_order_items (order_id, product_id, rental_start, rental_end, item_status) VALUES (?, ?, '2026-11-10', '2026-11-11', 'picked_up')", [order.insertId, TEST_PRODUCT.id]);
        await connection.execute("INSERT INTO rental_order_payments (order_id, payment_type, payment_method, payment_status, amount, mollie_payment_id, external_operation_key) VALUES (?, 'deposit_refund', 'online', 'pending', -20, 'tr_financial', 'refund-lost-commit')", [order.insertId]);
        await connection.beginTransaction();
        await lockBookingOrder(connection, order.insertId);
        const refund = { id: 're_recovered', paymentId: 'tr_financial', amount: { currency: 'EUR', value: '20.00' }, status: 'refunded', metadata: { externalOperationKey: 'refund-lost-commit', orderId: String(order.insertId) } };
        await applyRefundObservation(connection, 'tr_financial', refund);
        await applyRefundObservation(connection, 'tr_financial', { ...refund, status: 'processing' });
        const payment = { id: 'tr_financial', status: 'paid', amount: { currency: 'EUR', value: '100.00' } };
        const dispute = { id: 'chb_financial', paymentId: payment.id, amount: { currency: 'EUR', value: '40.00' } };
        const context = { order_id: order.insertId, amount: '100.00' };
        await applyChargebackObservations(connection, payment, [dispute], context);
        assert.equal(await checkProductAvailability(connection, TEST_PRODUCT.id, '2026-11-10', '2026-11-11'), false);
        await applyChargebackObservations(connection, payment, [{ ...dispute, reversedAt: '2026-09-13T12:00:00Z' }], context);
        await applyChargebackObservations(connection, payment, [dispute], context);
        await connection.commit();
        const [orders] = await connection.execute('SELECT status, payment_status FROM rental_orders WHERE id = ?', [order.insertId]);
        assert.deepEqual(orders[0], { status: 'picked_up', payment_status: 'paid' });
        const [refunds] = await connection.execute("SELECT payment_status, mollie_refund_id FROM rental_order_payments WHERE external_operation_key = 'refund-lost-commit'");
        assert.deepEqual(refunds[0], { payment_status: 'paid', mollie_refund_id: 're_recovered' });
        const [disputes] = await connection.execute("SELECT COUNT(*) AS count FROM rental_order_payments WHERE order_id = ? AND payment_type = 'chargeback'", [order.insertId]);
        assert.equal(Number(disputes[0].count), 1);
    } finally { await connection.rollback(); await connection.end(); }
});

test('concurrent obsolete-checkout worker and webhook cannot allocate duplicate refund capacity', async () => {
    const { ensureDuplicatePaymentRefund } = require('../../services/duplicateRefundService');
    const { applyExternalEffectResult } = require('../../services/externalEffectsWorker');
    const { lockExternalEffectPaymentContext } = require('../../services/bookingPaymentService');
    const first = await mysql.createConnection(dbConfig);
    const second = await mysql.createConnection(dbConfig);
    try {
        for (const workerFirst of [false, true]) {
            const paymentId = workerFirst ? 'tr_worker_first' : 'tr_webhook_first';
            const [order] = await first.execute("INSERT INTO rental_orders (order_no, status, payment_status, total_amount) VALUES (?, 'confirmed', 'paid', 50)", [paymentId]);
            const orderId = order.insertId;
            await first.execute("INSERT INTO rental_order_items (order_id, product_id, rental_start, rental_end) VALUES (?, ?, '2026-12-10', '2026-12-11')", [orderId, TEST_PRODUCT.id]);
            await first.execute("INSERT INTO rental_order_payments (order_id, payment_type, payment_method, payment_status, amount, mollie_payment_id) VALUES (?, 'initial_payment', 'online', 'paid', 50, ?)", [orderId, paymentId]);
            const effect = { payload: { application: { kind: 'cancel_payment', paymentId, refundIfPaid: { orderId, amount: 50 } } } };
            const result = { id: paymentId, status: 'paid', amount: { currency: 'EUR', value: '50.00' } };
            const webhook = connection => ensureDuplicatePaymentRefund(connection, { orderId, paymentId, amount: 50 });
            const worker = connection => applyExternalEffectResult(connection, effect, result);
            await first.beginTransaction();
            await lockBookingOrder(first, orderId);
            await second.beginTransaction();
            const parallel = (async () => {
                await lockExternalEffectPaymentContext(second, effect);
                await (workerFirst ? webhook : worker)(second);
                await second.commit();
            })();
            await (workerFirst ? worker : webhook)(first);
            await first.commit();
            await parallel;
            const [refunds] = await first.execute("SELECT COUNT(*) AS count, SUM(ABS(amount)) AS total FROM rental_order_payments WHERE mollie_payment_id = ? AND payment_type = 'duplicate_payment_refund'", [paymentId]);
            assert.equal(Number(refunds[0].count), 1);
            assert.equal(Number(refunds[0].total), 50);
            const [effects] = await first.execute('SELECT COUNT(*) AS count FROM external_effects_outbox WHERE operation_key = ?', [`duplicate-payment-refund-${paymentId}`]);
            assert.equal(Number(effects[0].count), 1);
        }
    } finally { await Promise.allSettled([first.rollback(), second.rollback()]); await Promise.allSettled([first.end(), second.end()]); }
});
