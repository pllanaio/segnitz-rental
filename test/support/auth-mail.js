'use strict';

// Isolated test mailbox: read only the queued test outbox, never a real mail provider.
async function readAuthMailToken(connection, email, kind = 'verification') {
    const prefix = kind === 'reset' ? 'mail-password-reset%' : 'mail-verify%';
    const [rows] = await connection.execute(
        `SELECT payload_json FROM external_effects_outbox
         WHERE effect_type = 'mail.send' AND operation_key LIKE ?
         AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.message.to')) = ?
         ORDER BY id DESC LIMIT 1`, [prefix, email]
    );
    const payload = typeof rows[0]?.payload_json === 'string' ? JSON.parse(rows[0].payload_json) : rows[0]?.payload_json;
    const pattern = kind === 'reset' ? /resetToken=([a-f0-9]{64})/u : /[?&]token=([a-f0-9]{64})/u;
    const token = pattern.exec(String(payload?.message?.text || ''))?.[1];
    if (!token) throw new Error('Isolierte Testmail enthält keinen Authentifizierungscode.');
    return token;
}

module.exports = { readAuthMailToken };
