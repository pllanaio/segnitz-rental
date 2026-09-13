'use strict';

// Immutable migration: do not edit after release. TIMESTAMP already represents
// an instant, DATE a business calendar day; neither is converted here.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { readSqlStatements, removeSqlComments } = require('../sql');

const targets = Object.freeze({
    app_installation: ['setup_token_created_at', 'initialized_at'],
    users: ['verification_expires', 'reset_token_expires'],
    guest_verifications: ['expires_at'],
    rental_orders: ['reserved_until', 'paid_at', 'order_confirmation_sent_at', 'picked_up_at', 'returned_at', 'cancelled_at', 'guest_access_token_expires_at'],
    rental_order_items: ['picked_up_at', 'returned_at', 'return_case_processed_at', 'cancelled_at'],
    rental_order_payments: ['paid_at', 'created_at'],
    mollie_webhook_events: ['processed_at'],
    external_effects_outbox: ['available_at', 'locked_at', 'completed_at', 'created_at', 'updated_at']
});
const progressTableSql = `CREATE TABLE IF NOT EXISTS app_datetime_migration_progress (
    table_name VARCHAR(128) NOT NULL,
    interpretation VARCHAR(16) NOT NULL,
    override_hash CHAR(64) NOT NULL,
    last_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    completed TINYINT(1) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (table_name),
    CONSTRAINT chk_datetime_progress_completed CHECK (completed IN (0, 1)),
    CONSTRAINT chk_datetime_progress_mode CHECK (interpretation IN ('utc', 'berlin'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;
const berlinFormatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function berlinLocalString(date) {
    const parts = Object.fromEntries(berlinFormatter.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function convertLegacyDatetime(stored, { mode, key, overrides = {} }) {
    if (stored === null || stored === undefined) return null;
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(stored)) {
        throw new Error(`UTC-Migration: ungültiges DATETIME bei ${key}; manuelle Bestandsprüfung erforderlich.`);
    }
    const override = overrides[key];
    if (override) {
        if (override.stored !== stored || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(override.utc || '') || !String(override.reason || '').trim()) {
            throw new Error(`UTC-Migration: ungültiger oder veralteter Einzelentscheid bei ${key}.`);
        }
        const instant = new Date(override.utc);
        if (!Number.isFinite(instant.getTime()) || instant.toISOString().replace('.000Z', 'Z') !== override.utc) {
            throw new Error(`UTC-Migration: ungültiger UTC-Einzelentscheid bei ${key}.`);
        }
        return override.utc.replace('T', ' ').slice(0, 19);
    }
    const naive = new Date(`${stored.replace(' ', 'T')}Z`);
    if (!Number.isFinite(naive.getTime()) || naive.toISOString().slice(0, 19).replace('T', ' ') !== stored) {
        throw new Error(`UTC-Migration: ungültiges Kalenderdatum bei ${key}.`);
    }
    if (mode === 'utc') return stored;
    if (mode !== 'berlin') throw new Error('UTC-Migration benötigt DB_LEGACY_DATETIME_MODE=berlin|utc.');
    // Sample offsets on either side of the transition; roundtrip rejects both
    // nonexistent March hours and the two valid instants of an October fold.
    const offsets = new Set();
    for (const delta of [-86400000, 0, 86400000]) {
        const sample = new Date(naive.getTime() + delta);
        offsets.add(new Date(`${berlinLocalString(sample).replace(' ', 'T')}Z`).getTime() - sample.getTime());
    }
    const candidates = [...offsets].map(offset => new Date(naive.getTime() - offset))
        .filter(instant => berlinLocalString(instant) === stored);
    if (candidates.length !== 1) {
        const error = new Error(`UTC-Migration: ${candidates.length ? 'mehrdeutige' : 'nicht existierende'} Berliner Lokalzeit bei ${key}; DB_LEGACY_DATETIME_OVERRIDES_FILE mit gespeichertem Wert, UTC-Instant und Begründung erforderlich.`);
        error.code = 'DB_LEGACY_DATETIME_REVIEW_REQUIRED';
        error.cell = key;
        throw error;
    }
    return candidates[0].toISOString().slice(0, 19).replace('T', ' ');
}

async function migrateUtcInstants(connection, { env = process.env, afterBatch } = {}) {
    const overrides = env.DB_LEGACY_DATETIME_OVERRIDES_FILE
        ? JSON.parse(fs.readFileSync(env.DB_LEGACY_DATETIME_OVERRIDES_FILE, 'utf8')) : {};
    if (!overrides || Array.isArray(overrides) || typeof overrides !== 'object') throw new Error('UTC-Einzelentscheide müssen ein JSON-Objekt sein.');
    const overrideHash = crypto.createHash('sha256').update(JSON.stringify(overrides)).digest('hex');
    await connection.query(progressTableSql);
    const [metadata] = await connection.execute(
        `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
    );
    // Validate every pending value before the first DML. This ensures a fold or
    // gap discovered in a later batch cannot leave a half-converted database.
    // DDL is intentionally separate and idempotent; all old writers must remain stopped.
    await inspectLegacyDatetimes(connection, { env, overrides, overrideHash, metadata });
    for (const [table, targetColumns] of Object.entries(targets)) {
        const columns = targetColumns.filter(column => metadata.some(row => row.tableName === table && row.columnName === column && row.dataType === 'datetime'));
        if (!columns.length) continue;
        const [existingProgress] = await connection.execute('SELECT * FROM app_datetime_migration_progress WHERE table_name = ?', [table]);
        if (Number(existingProgress[0]?.completed) === 1) continue;
        const mode = existingProgress[0]?.interpretation || env.DB_LEGACY_DATETIME_MODE || 'utc';
        if (existingProgress[0] && existingProgress[0].override_hash !== overrideHash) throw new Error(`UTC-Migration: Einzelentscheid-Datei seit Checkpoint für ${table} verändert; unveränderte geprüfte Datei benötigt.`);
        let lastId = String(existingProgress[0]?.last_id || '0');
        let completed = false;
        while (!completed) {
            await connection.beginTransaction();
            try {
                const [rows] = await connection.execute(
                    `SELECT CAST(id AS CHAR) AS id, ${columns.map(column => `CAST(\`${column}\` AS CHAR) AS \`${column}\``).join(', ')} FROM \`${table}\` WHERE id > ? ORDER BY id LIMIT 200 FOR UPDATE`, [lastId]
                );
                if (rows.some(row => columns.some(column => row[column] !== null))) {
                    if (!['berlin', 'utc'].includes(env.DB_LEGACY_DATETIME_MODE) || env.DB_LEGACY_WRITERS_STOPPED !== '1') {
                        throw new Error(`UTC-Migration: bestehende DATETIME in ${table}; Backup und gestoppte alte Writer bestätigen (DB_LEGACY_WRITERS_STOPPED=1) sowie DB_LEGACY_DATETIME_MODE=berlin|utc setzen. DATE/TIMESTAMP bleiben unverändert.`);
                    }
                    if (env.DB_LEGACY_DATETIME_MODE !== mode) throw new Error(`UTC-Migration: Interpretation seit Checkpoint für ${table} verändert.`);
                }
                for (const row of rows) {
                    const assignments = columns.map(column => `\`${column}\` = ?`);
                    // Explicitly preserve ON UPDATE TIMESTAMP audit values.
                    if (!columns.includes('updated_at') && metadata.some(meta => meta.tableName === table && meta.columnName === 'updated_at')) assignments.push('updated_at = updated_at');
                    const values = columns.map(column => convertLegacyDatetime(row[column], { mode, key: `${table}.${row.id}.${column}`, overrides }));
                    await connection.execute(`UPDATE \`${table}\` SET ${assignments.join(', ')} WHERE id = ?`, [...values, row.id]);
                }
                if (rows.length) lastId = rows.at(-1).id;
                completed = rows.length < 200;
                await connection.execute(
                    `INSERT INTO app_datetime_migration_progress (table_name, interpretation, override_hash, last_id, completed)
                     VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE last_id = VALUES(last_id), completed = VALUES(completed)`,
                    [table, mode, overrideHash, lastId, completed ? 1 : 0]
                );
                await connection.commit();
                if (afterBatch) await afterBatch({ table, lastId, completed });
            } catch (error) { await connection.rollback(); throw error; }
        }
    }
}


async function inspectLegacyDatetimes(connection, { env, overrides, overrideHash, metadata }) {
    const issues = [];
    for (const [table, targetColumns] of Object.entries(targets)) {
        const columns = targetColumns.filter(column => metadata.some(row => row.tableName === table && row.columnName === column && row.dataType === 'datetime'));
        if (!columns.length) continue;
        const [checkpoints] = await connection.execute('SELECT * FROM app_datetime_migration_progress WHERE table_name = ?', [table]);
        if (Number(checkpoints[0]?.completed) === 1) continue;
        if (checkpoints[0] && checkpoints[0].override_hash !== overrideHash) throw new Error(`UTC-Migration: geprüfte Einzelentscheid-Datei für ${table} seit Checkpoint verändert.`);
        let after = String(checkpoints[0]?.last_id || '0');
        while (true) {
            const [rows] = await connection.execute(
                `SELECT CAST(id AS CHAR) AS id, ${columns.map(column => `CAST(\`${column}\` AS CHAR) AS \`${column}\``).join(', ')} FROM \`${table}\` WHERE id > ? ORDER BY id LIMIT 200`, [after]
            );
            for (const row of rows) for (const column of columns) {
                if (row[column] === null) continue;
                if (!['berlin', 'utc'].includes(env.DB_LEGACY_DATETIME_MODE) || env.DB_LEGACY_WRITERS_STOPPED !== '1') {
                    throw new Error(`UTC-Migration: bestehende DATETIME in ${table}; DB_LEGACY_WRITERS_STOPPED=1 und DB_LEGACY_DATETIME_MODE=berlin|utc nach Backup/Bestandsprüfung erforderlich.`);
                }
                if (checkpoints[0] && checkpoints[0].interpretation !== env.DB_LEGACY_DATETIME_MODE) throw new Error(`UTC-Migration: Interpretation für ${table} seit Checkpoint verändert.`);
                try { convertLegacyDatetime(row[column], { mode: env.DB_LEGACY_DATETIME_MODE, key: `${table}.${row.id}.${column}`, overrides }); }
                catch (error) { issues.push(error.message); }
            }
            if (issues.length >= 50 || rows.length < 200) break;
            after = rows.at(-1).id;
        }
    }
    if (issues.length) {
        const error = new Error(`UTC-Migration benötigt Einzelentscheide vor Datenänderung: ${issues.slice(0, 50).join('; ')}`);
        error.code = 'DB_LEGACY_DATETIME_REVIEW_REQUIRED';
        throw error;
    }
}

const migration = {
    version: '20260913_01_utc_instants', checksumVersion: 2, runBeforeLegacy: true,
    checksumSource: fs.readFileSync(__filename, 'utf8'),
    checksumDependencies: [readSqlStatements, removeSqlComments],
    async up(connection) { await migrateUtcInstants(connection); }
};

module.exports = { inspectLegacyDatetimes, convertLegacyDatetime, migrateUtcInstants, migration, progressTableSql, targets };
