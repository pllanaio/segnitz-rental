'use strict';

// Immutable migration: keep this file self-contained because its bytes are checksummed.
const fs = require('node:fs');

async function up(connection) {
    for (const [table, column] of [
        ['users', 'reset_token'], ['users', 'verification_token'],
        ['guest_verifications', 'verification_token']
    ]) {
        await connection.query(`UPDATE \`${table}\`
            SET \`${column}\` = CONCAT('sha256:', SHA2(\`${column}\`, 256))
            WHERE \`${column}\` REGEXP '^[a-f0-9]{64}$'`);
    }
    // Only auth-mail secrets are re-keyed. Financial idempotency keys never change.
    await connection.query(`UPDATE external_effects_outbox
        SET operation_key = CONCAT('mail-password-reset-redacted-', SHA2(operation_key, 256)), last_error = NULL
        WHERE effect_type = 'mail.send' AND operation_key REGEXP '^mail-password-reset-[a-f0-9]{64}$'`);
    await connection.query(`UPDATE external_effects_outbox
        SET last_error = NULL,
            result_json = NULL,
            payload_json = CASE WHEN status IN ('succeeded', 'dead')
                THEN JSON_OBJECT('redacted', TRUE) ELSE JSON_SET(payload_json, '$.message.operationKey', operation_key) END
        WHERE effect_type = 'mail.send' AND
            (operation_key LIKE 'mail-password-reset%' OR operation_key LIKE 'mail-verify%')`);
}

module.exports = {
    up,
    migration: {
        version: '20260913_02_auth_secrets', checksumVersion: 2,
        checksumSource: fs.readFileSync(__filename, 'utf8'), up
    }
};
