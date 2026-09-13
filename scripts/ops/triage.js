#!/usr/bin/env node
'use strict';
// Read-only: deliberately contains no automatic replay or provider calls.
require('dotenv').config();
const mysql = require('mysql2/promise');

async function triage(connection, { limit = 50, afterId = 0 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(afterId) || afterId < 0) throw new Error('Invalid pagination');
    const [rows] = await connection.execute(`SELECT id, effect_type, status, attempt_count, max_attempts,
        created_at, available_at, locked_at, completed_at
        FROM external_effects_outbox WHERE id > ? AND status <> 'succeeded' ORDER BY id LIMIT ?`, [afterId, limit]);
    const [summary] = await connection.execute(`SELECT status, COUNT(*) AS count,
        COALESCE(MAX(TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP())), 0) AS oldest_seconds
        FROM external_effects_outbox GROUP BY status`);
    return { summary, rows, nextAfterId: rows.length === limit ? Number(rows.at(-1).id) : null };
}

async function main() {
    const connection = await mysql.createConnection(require('../../config/db'));
    try {
        const result = await triage(connection, { limit: 50, afterId: Number(process.argv[2] || 0) });
        console.log(JSON.stringify(result, null, 2));
    } finally { await connection.end(); }
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ event: 'triage.failed', code: error.code || error.name })); process.exitCode = 1; });
module.exports = { triage };
