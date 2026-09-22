#!/usr/bin/env node
'use strict';
// Synthetic-only entry point. It refuses existing application data and never
// resets anything. The ordinary server.js starts after the fixture transaction.
const fs = require('node:fs/promises');
const sharp = require('sharp');
const bcrypt = require('bcrypt');
const { createHash } = require('node:crypto');

async function main() {
    if (process.env.NODE_ENV !== 'test' || process.env.RESTORE_SYNTHETIC_REHEARSAL !== '1' ||
        !/^segnitz_restore_test_source_[a-f0-9]{12}$/.test(process.env.DB_NAME || '') ||
        !process.env.RESTORE_FIXTURE_PASSWORD || process.env.RESTORE_FIXTURE_PASSWORD.length < 32 ||
        process.env.MOLLIE_TEST_MODE !== '1' || process.env.MAIL_DELIVERY_PAUSED !== '1') {
        throw new Error('RESTORE_FIXTURE_ISOLATION_REQUIRED');
    }
    const { initializeDatabase } = require('../../database/bootstrap');
    await initializeDatabase();
    const db = require('../../config/db');
    const connection = await require('mysql2/promise').createConnection(db);
    try {
        const [existing] = await connection.execute(`SELECT
            (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM rental_orders) +
            (SELECT COUNT(*) FROM rental_products) + (SELECT COUNT(*) FROM external_effects_outbox) AS count`);
        if (Number(existing[0].count) !== 0) throw new Error('RESTORE_FIXTURE_REQUIRES_EMPTY_DATABASE');
        for (const directory of ['/app/public/img/products', '/app/uploads/returns']) {
            if ((await fs.readdir(directory)).length) throw new Error('RESTORE_FIXTURE_REQUIRES_EMPTY_VOLUMES');
        }
        const image = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#257482' } }).png().toBuffer();
        await fs.writeFile('/app/public/img/products/restore-fixture.png', image, { flag: 'wx' });
        await fs.writeFile('/app/uploads/returns/restore-fixture.png', image, { flag: 'wx' });
        await connection.beginTransaction();
        const password = await bcrypt.hash(process.env.RESTORE_FIXTURE_PASSWORD, 12);
        for (const [id, name, role] of [[1, 'owner', 'customer'], [2, 'foreign', 'customer'], [3, 'admin', 'global_admin']]) {
            await connection.execute(`INSERT INTO users (id, username, password, role, email_verified)
                VALUES (?, ?, ?, ?, 1)`, [id, `${name}@restore.invalid`, password, role]);
        }
        await connection.execute(`INSERT INTO rental_products
            (id, product_key, title, price_per_day, deposit, image_path) VALUES
            (1, 'RESTORE-FIXTURE', 'Synthetisches Wiederherstellungsobjekt', 100, 150, 'img/products/restore-fixture.png')`);
        await connection.execute(`INSERT INTO rental_orders
            (id, order_no, user_id, customer_email, signature_data_url, status, total_amount,
             payment_method, payment_status, return_status, return_case_status, returned_at)
            VALUES (1, 'RESTORE-FIXTURE', 1, 'owner@restore.invalid', ?, 'returned', 250,
                    'cash', 'paid', 'returned_ok', 'closed', UTC_TIMESTAMP())`, [`data:image/png;base64,${image.toString('base64')}`]);
        await connection.execute(`INSERT INTO rental_order_items
            (id, order_id, product_id, rental_start, rental_end, price_per_day, deposit,
             item_status, return_status, actual_return_date, returned_at, deposit_decision, deposit_refund_amount)
            VALUES (1, 1, 1, '2020-01-06', '2020-01-06', 100, 150,
                    'returned_ok', 'returned_ok', '2020-01-06', UTC_TIMESTAMP(), 'full_refund', 150)`);
        await connection.execute(`INSERT INTO rental_order_return_images
            (order_id, order_item_id, image_path, uploaded_by_user_id)
            VALUES (1, 1, 'img/returns/restore-fixture.png', 3)`);
        await connection.execute(`INSERT INTO rental_order_payments
            (order_id, order_item_id, payment_type, payment_method, payment_status, amount, paid_at)
            VALUES (1, 1, 'rental', 'cash', 'paid', 100, UTC_TIMESTAMP()),
                   (1, 1, 'deposit', 'cash', 'paid', 150, UTC_TIMESTAMP()),
                   (1, 1, 'deposit_refund', 'cash', 'paid', -150, UTC_TIMESTAMP())`);
        const payload = JSON.stringify({ message: { to: 'owner@restore.invalid', subject: 'Synthetic restore fixture', text: 'Synthetic only' } });
        await connection.execute(`INSERT INTO external_effects_outbox
            (operation_key, effect_type, payload_json, payload_hash)
            VALUES ('restore-fixture-mail', 'mail.send', ?, ?)`, [payload, createHash('sha256').update(payload).digest('hex')]);
        await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { await connection.end(); }
    await require('../../server').startServer();
}
if (require.main === module) main().catch(() => {
    console.error(JSON.stringify({ event: 'restore.fixture.failed' }));
    process.exitCode = 1;
});
