'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { resetTestDatabase, TEST_ADMIN, TEST_PRODUCT } = require('../support/test-database');
const { appendAdminMutation, commitAdminMutation } = require('../../services/adminMutationAudit');
const { up } = require('../../database/migrations/20260913_admin_audit');
const { verifyCanonicalSchema } = require('../../database/schemaContract');

async function fixture(callback) {
    await resetTestDatabase(); // The shared guard rejects every non-test/ci DB name.
    const writer = await mysql.createConnection(dbConfig);
    let reader;
    try {
        reader = await mysql.createConnection(dbConfig);
        const [order] = await writer.execute(`INSERT INTO rental_orders(status, total_amount, payment_method, payment_status)
            VALUES ('confirmed', '100.10', 'cash', 'pending')`);
        const [item] = await writer.execute(`INSERT INTO rental_order_items(order_id, product_id, rental_start, rental_end, price_per_day, deposit)
            VALUES (?, ?, '2026-10-24', '2026-10-25', '0.00', '150.00')`, [order.insertId, TEST_PRODUCT.id]);
        await writer.execute(`INSERT INTO rental_order_payments(order_id, payment_type, payment_method, payment_status, amount)
            VALUES (?, 'rental', 'cash', 'pending', '100.10'), (?, 'deposit', 'cash', 'pending', '150.00')`, [order.insertId, order.insertId]);
        const req = { method: 'PUT', route: { path: '/admin/orders/:id/pick-up' }, params: { id: String(order.insertId) },
            session: { user: TEST_ADMIN.email, role: TEST_ADMIN.role, authVersion: 1 }, body: {} };
        await callback({ writer, reader, orderId: order.insertId, itemId: item.insertId, req });
    } finally {
        await writer.end();
        if (reader) await reader.end();
    }
}

test('real MySQL commits finance and audit together; another connection sees neither before COMMIT', async () => {
    await fixture(async ({ writer, reader, orderId, req }) => {
        await writer.beginTransaction();
        await writer.execute("UPDATE rental_orders SET total_amount = '125.25', status = 'picked_up' WHERE id = ?", [orderId]);
        await appendAdminMutation(writer, req);
        const [beforeEvents] = await reader.execute('SELECT id FROM admin_mutation_events');
        const [beforeOrder] = await reader.execute('SELECT total_amount FROM rental_orders WHERE id = ?', [orderId]);
        assert.equal(beforeEvents.length, 0);
        assert.equal(String(beforeOrder[0].total_amount), '100.10');
        await writer.commit();
        const [events] = await reader.execute('SELECT actor_user_id, actor_ref, request_id, order_id, snapshot_json FROM admin_mutation_events');
        assert.equal(events.length, 1);
        assert.equal(events[0].order_id, orderId);
        const snapshot = typeof events[0].snapshot_json === 'string' ? JSON.parse(events[0].snapshot_json) : events[0].snapshot_json;
        assert.equal(snapshot.order.totalAmountCents, '12525');
        assert.equal(snapshot.order.status, 'picked_up');
        assert.equal(snapshot.items[0].rentalStart, '2026-10-24');
        assert.equal(JSON.stringify(events).includes(TEST_ADMIN.email), false);
        assert.match(events[0].request_id, /^[a-f0-9-]{36}$/);
    });
});

test('real MySQL audit INSERT failure prevents the financial COMMIT', async () => {
    await fixture(async ({ writer, reader, orderId, req }) => {
        await writer.query("CREATE TRIGGER admin_audit_test_reject BEFORE INSERT ON admin_mutation_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit rejection'");
        try {
            await writer.beginTransaction();
            await writer.execute("UPDATE rental_orders SET total_amount = '125.25' WHERE id = ?", [orderId]);
            await assert.rejects(commitAdminMutation(writer, req), { code: 'ER_SIGNAL_EXCEPTION' });
            const [orders] = await reader.execute('SELECT total_amount FROM rental_orders WHERE id = ?', [orderId]);
            const [events] = await reader.execute('SELECT id FROM admin_mutation_events');
            assert.equal(String(orders[0].total_amount), '100.10');
            assert.equal(events.length, 0);
        } finally { await writer.query('DROP TRIGGER admin_audit_test_reject'); }
    });
});

test('real MySQL rejects audit UPDATE/DELETE, detects missing trigger and preserves events on migration retry', async () => {
    await fixture(async ({ writer, reader, req }) => {
        await writer.beginTransaction();
        await commitAdminMutation(writer, req);
        await assert.rejects(reader.execute("UPDATE admin_mutation_events SET actor_role = 'bearbeiter'"), { code: 'ER_SIGNAL_EXCEPTION' });
        await assert.rejects(reader.execute('DELETE FROM admin_mutation_events'), { code: 'ER_SIGNAL_EXCEPTION' });
        await reader.query('DROP TRIGGER admin_mutation_events_no_update');
        await assert.rejects(verifyCanonicalSchema(reader), error => error.name === 'SchemaVerificationError' && error.issues.some(issue => issue.includes('Audit-Trigger')));
        await up(reader); // Explicitly repairing only the deliberately damaged isolated test fixture.
        await up(reader);
        await verifyCanonicalSchema(reader);
        const [events] = await reader.execute('SELECT id FROM admin_mutation_events');
        assert.equal(events.length, 1);
    });
});

test('two real MySQL writers audit their own serialized resulting state, without a stale consistent-read snapshot', async () => {
    await fixture(async ({ writer, reader, orderId, req }) => {
        await writer.beginTransaction();
        await writer.execute("UPDATE rental_orders SET total_amount = '125.25' WHERE id = ?", [orderId]);
        await reader.beginTransaction();
        // Establish an old consistent read before the first writer commits.
        await reader.execute('SELECT total_amount FROM rental_orders WHERE id = ?', [orderId]);
        const secondWrite = reader.execute("UPDATE rental_orders SET total_amount = '130.30' WHERE id = ?", [orderId]);
        await commitAdminMutation(writer, req);
        await secondWrite;
        await commitAdminMutation(reader, { ...req });
        const [events] = await writer.execute('SELECT snapshot_json FROM admin_mutation_events ORDER BY id');
        const snapshots = events.map(event => typeof event.snapshot_json === 'string' ? JSON.parse(event.snapshot_json) : event.snapshot_json);
        assert.deepEqual(snapshots.map(value => value.order.totalAmountCents), ['12525', '13030']);
    });
});

test('connection abort after audit INSERT and before COMMIT exposes no audit or financial change', async () => {
    await fixture(async ({ writer, reader, orderId, req }) => {
        await writer.beginTransaction();
        await writer.execute("UPDATE rental_orders SET total_amount = '125.25' WHERE id = ?", [orderId]);
        await appendAdminMutation(writer, req);
        writer.destroy();
        const [orders] = await reader.execute('SELECT total_amount FROM rental_orders WHERE id = ?', [orderId]);
        const [events] = await reader.execute('SELECT id FROM admin_mutation_events');
        assert.equal(String(orders[0].total_amount), '100.10');
        assert.equal(events.length, 0);
    });
});
