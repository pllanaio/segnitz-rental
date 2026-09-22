#!/usr/bin/env node
'use strict';
// This verifier never starts the app, claims outbox jobs or contacts a provider.
require('dotenv').config();
const path = require('node:path');
const mysql = require('mysql2/promise');
const { verifyCanonicalSchema } = require('../../database/schemaContract');
const { assertExactAppliedMigrationState } = require('../../database/migrationState');
const { buildMigrationManifest } = require('../../database/bootstrap');
const { failure, verifyImageFile, verifySignature, IMAGE_LIMITS, SIGNATURE_LIMITS } = require('./restore-images');

function safeReference(reference, prefix, root) {
    const normalized = String(reference || '').replace(/^\//, '');
    if (!normalized.startsWith(prefix)) throw new Error('Unexpected image reference');
    const relative = normalized.slice(prefix.length);
    if (!relative || !/^[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i.test(relative) || relative !== path.basename(relative)) throw new Error('Unsafe image reference');
    return path.join(root, relative);
}

// Keyset pages avoid loading the entire signature LONGTEXT column or image
// catalog into memory. At most two bounded image decoders execute at once.
async function verifyBatches(connection, table, field, verify, { batchSize = 25, maxRecords = 100_000, deadlineMs = 15 * 60_000 } = {}) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100 ||
        !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 1_000_000 ||
        !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60 * 60_000) throw failure('RESTORE_VERIFY_LIMIT');
    if (!['rental_products', 'rental_product_images', 'rental_order_return_images', 'rental_orders'].includes(table) ||
        !['image_path', 'signature_data_url'].includes(field)) throw failure('RESTORE_VERIFY_QUERY');
    const deadline = Date.now() + deadlineMs;
    let lastId = 0;
    let count = 0;
    while (true) {
        if (Date.now() >= deadline) throw failure('RESTORE_VERIFY_DEADLINE');
        const valueSql = field === 'signature_data_url'
            ? `IF(OCTET_LENGTH(${field}) <= ${32 + 4 * Math.ceil(SIGNATURE_LIMITS.maxBytes / 3)}, ${field}, NULL)`
            : field;
        const [rows] = await connection.execute(`SELECT id, ${valueSql} AS value FROM ${table}
            WHERE id > ? AND ${field} IS NOT NULL AND ${field} <> '' ORDER BY id LIMIT ${batchSize}`, [lastId]);
        if (!rows.length) return count;
        if (count + rows.length > maxRecords) throw failure('RESTORE_VERIFY_LIMIT');
        for (let index = 0; index < rows.length; index += 2) {
            if (Date.now() >= deadline) throw failure('RESTORE_VERIFY_DEADLINE');
            await Promise.all(rows.slice(index, index + 2).map(row => verify(row.value)));
        }
        count += rows.length;
        lastId = rows.at(-1).id;
    }
}

async function verifyRestoredData(connection, { products, returns, limits }) {
    const schema = await verifyCanonicalSchema(connection);
    const [migrations] = await connection.execute('SELECT version, checksum FROM app_schema_migrations ORDER BY version');
    assertExactAppliedMigrationState(migrations, buildMigrationManifest());
    let checked = 0;
    const queries = [
        ['rental_products', 'img/products/', products],
        ['rental_product_images', 'img/products/', products],
        ['rental_order_return_images', 'img/returns/', returns]
    ];
    for (const [table, prefix, root] of queries) {
        checked += await verifyBatches(connection, table, 'image_path', value => verifyImageFile(safeReference(value, prefix, root)), limits);
    }
    const signatureCount = await verifyBatches(connection, 'rental_orders', 'signature_data_url', value => verifySignature(value), limits);
    const [ledger] = await connection.execute(`SELECT payment_type, payment_status, COUNT(*) AS count, SUM(amount) AS total
        FROM rental_order_payments GROUP BY payment_type, payment_status ORDER BY payment_type, payment_status`);
    const [outbox] = await connection.execute('SELECT status, COUNT(*) AS count FROM external_effects_outbox GROUP BY status');
    return { schema, migrationCount: migrations.length, referencedImagesChecked: checked,
        signatureCount, imageContentDecoded: true, signatureContentDecoded: true,
        decodeLimits: { images: IMAGE_LIMITS, signatures: SIGNATURE_LIMITS }, ledger, outbox, providersContacted: false,
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
module.exports = { safeReference, verifyBatches, verifyRestoredData };
