'use strict';
const crypto = require('node:crypto');

function isAuthToken(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function hashAuthToken(value) {
    if (!isAuthToken(value)) throw new TypeError('Ungültiger Authentifizierungscode.');
    return `sha256:${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

async function recoverQueuedVerificationToken(connection, email, expectedHash) {
    const [rows] = await connection.execute(
        `SELECT payload_json FROM external_effects_outbox
         WHERE effect_type = 'mail.send' AND operation_key LIKE 'mail-verify%'
           AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.message.to')) = ?
         ORDER BY id DESC LIMIT 5`, [email]
    );
    for (const row of rows) {
        const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
        const token = /[?&]token=([a-f0-9]{64})/u.exec(String(payload?.message?.text || ''))?.[1];
        if (token && hashAuthToken(token) === expectedHash) return token;
    }
    return null;
}

module.exports = { hashAuthToken, isAuthToken, recoverQueuedVerificationToken };
