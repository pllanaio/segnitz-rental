#!/usr/bin/env node
'use strict';
// This verifier never starts the app, claims outbox jobs or contacts a provider.
require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { verifyCanonicalSchema } = require('../../database/schemaContract');
const { assertExactAppliedMigrationState } = require('../../database/migrationState');
const { buildMigrationManifest } = require('../../database/bootstrap');

function safeReference(reference, prefix, root) {
    const normalized = String(reference || '').replace(/^\//, '');
    if (!normalized.startsWith(prefix)) throw new Error('Unexpected image reference');
    const relative = normalized.slice(prefix.length);
    if (!relative || !/^[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i.test(relative) || relative !== path.basename(relative)) throw new Error('Unsafe image reference');
    return path.join(root, relative);
}

async function verifyRestoredData(connection, { products, returns }) {
    const schema = await verifyCanonicalSchema(connection);
    const [migrations] = await connection.execute('SELECT version, checksum FROM app_schema_migrations ORDER BY version');
    assertExactAppliedMigrationState(migrations, buildMigrationManifest());
    let checked = 0;
    const queries = [
        ['SELECT image_path FROM rental_products WHERE image_path IS NOT NULL AND image_path <> ?', 'img/products/', products],
        ['SELECT image_path FROM rental_product_images WHERE image_path <> ?', 'img/products/', products],
        ['SELECT image_path FROM rental_order_return_images WHERE image_path <> ?', 'img/returns/', returns]
    ];
    for (const [sql, prefix, root] of queries) {
        const [rows] = await connection.execute(sql, ['']);
        for (const row of rows) {
            const file = safeReference(row.image_path, prefix, root);
            const stat = await fs.lstat(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error('Missing, empty or unsafe referenced image');
            checked += 1;
        }
    }
    const [signatures] = await connection.execute(`SELECT COUNT(*) AS count,
        SUM(signature_data_url NOT REGEXP '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$') AS invalid
        FROM rental_orders WHERE signature_data_url IS NOT NULL AND signature_data_url <> ''`);
    if (Number(signatures[0].invalid || 0)) throw new Error('Invalid stored signature format; inspect only in the private restore probe');
    const [ledger] = await connection.execute(`SELECT payment_type, payment_status, COUNT(*) AS count, SUM(amount) AS total
        FROM rental_order_payments GROUP BY payment_type, payment_status ORDER BY payment_type, payment_status`);
    const [outbox] = await connection.execute('SELECT status, COUNT(*) AS count FROM external_effects_outbox GROUP BY status');
    return { schema, migrationCount: migrations.length, referencedImagesChecked: checked,
        signatureCount: Number(signatures[0].count), ledger, outbox, providersContacted: false,
        applicationSmokeVerified: false };
}

async function main() {
    const config = require('../../config/db');
    if (!/^segnitz_restore_(test|probe)_[A-Za-z0-9_]+$/.test(config.database || '') ||
        !['127.0.0.1', 'localhost', '::1'].includes(config.host)) throw new Error('Only a local isolated restore database is allowed');
    const connection = await mysql.createConnection(config);
    try {
        const result = await verifyRestoredData(connection, { products: process.argv[2], returns: process.argv[3] });
        console.log(JSON.stringify(result, null, 2));
    } finally { await connection.end(); }
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ event: 'restore.verify.failed', code: error.code || error.name })); process.exitCode = 1; });
module.exports = { safeReference, verifyRestoredData };
