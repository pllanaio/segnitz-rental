#!/usr/bin/env node
'use strict';

async function verifyDatabaseTls(mode = process.argv[2]) {
    if (process.env.NODE_ENV !== 'test' || process.env.RESTORE_SYNTHETIC_REHEARSAL !== '1' ||
        process.env.DB_TLS !== '1' || process.env.DB_TLS_CA_FILE !== '/run/rehearsal-ca.pem' ||
        !/^segnitz_restore_test_source_[a-f0-9]{12}$/u.test(process.env.DB_NAME || '') ||
        !['trusted', 'untrusted-ca', 'wrong-hostname'].includes(mode) ||
        process.env.DB_HOST !== (mode === 'wrong-hostname' ? 'restore-mysql-wrong-host' : 'restore-mysql')) {
        throw new Error('TLS_REHEARSAL_ISOLATION_REQUIRED');
    }
    const db = require('../../config/db');
    const mysql = require('mysql2/promise');
    if (db.ssl?.rejectUnauthorized !== true || db.ssl.verifyIdentity !== true || db.ssl.minVersion !== 'TLSv1.2') {
        throw new Error('TLS_REHEARSAL_VERIFICATION_REQUIRED');
    }
    let connection;
    try {
        try { connection = await mysql.createConnection(db.connectionConfig()); }
        catch (error) {
            if (mode !== 'trusted' && error.code === 'HANDSHAKE_SSL_ERROR') return { mode, tlsHandshakeRejected: true };
            throw new Error('TLS_REHEARSAL_UNEXPECTED_CONNECTION_FAILURE');
        }
        if (mode !== 'trusted') throw new Error('TLS_REHEARSAL_INVALID_CERTIFICATE_ACCEPTED');
        const [[session]] = await connection.query('SELECT 1 AS alive, @@session.time_zone AS zone');
        const [[cipher]] = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
        const [[version]] = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_version'");
        if (session.alive !== 1 || session.zone !== '+00:00' || !cipher.Value ||
            !['TLSv1.2', 'TLSv1.3'].includes(version.Value)) throw new Error('TLS_REHEARSAL_ENCRYPTED_UTC_SESSION_REQUIRED');
        return { mode, encryptedSqlVerified: true, utcSessionVerified: true, protocol: version.Value };
    } finally {
        if (connection) await connection.end();
        await db.closeConnections();
    }
}

if (require.main === module) verifyDatabaseTls().then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error(JSON.stringify({ event: 'restore.tls.failed' }));
    process.exitCode = 1;
});
module.exports = { verifyDatabaseTls };
