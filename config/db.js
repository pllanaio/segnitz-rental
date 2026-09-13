const fs = require('node:fs');
const net = require('node:net');
const { ServerCancellation } = require('../database/serverCancellation');
const mysql = require('mysql2/promise');
const mysqlDriver = require('mysql2');
const { ConnectionBudget, boundConnection, databaseError } = require('../database/connectionBudget');
const CONNECTION_OPTIONS = Symbol.for('segnitz.mysql.connection-options');
const budget = new ConnectionBudget({
    limit: Number(process.env.DB_CONNECTION_LIMIT || 12) - 1,
    queueLimit: Number(process.env.DB_QUEUE_LIMIT ?? 50),
    acquireTimeoutMs: Number(process.env.DB_ACQUIRE_TIMEOUT_MS || 2000)
});

const cancellation = new ServerCancellation({ connect: (config, signal) => connectDriver(config, signal, false) });

const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'Europe/Berlin';
const MYSQL_PATCH_MARKER = Symbol.for('segnitz.mysql.session-timezone');

function validateBusinessTimeZone(timeZone = BUSINESS_TIME_ZONE) {
    try {
        new Intl.DateTimeFormat('de-DE', { timeZone }).format(new Date());
    } catch {
        throw new Error(`Ungültige BUSINESS_TIME_ZONE: ${timeZone}`);
    }

    return timeZone;
}

function getBusinessUtcOffset(date = new Date(), timeZone = BUSINESS_TIME_ZONE) {
    validateBusinessTimeZone(timeZone);

    const offsetName = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'longOffset'
    }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value;

    if (offsetName === 'GMT') return '+00:00';

    const match = /^GMT([+-]\d{2}:\d{2})$/u.exec(offsetName || '');
    if (!match) {
        throw new Error(`UTC-Offset für BUSINESS_TIME_ZONE ${timeZone} konnte nicht bestimmt werden.`);
    }

    return match[1];
}

async function createTimeZoneAwareConnection(createConnection, config, options = {}) {
    const connection = await createConnection({ ...config, timezone: '+00:00', dateStrings: ['DATE'] });
    try {
        await connection.execute('SET SESSION time_zone = ?', ['+00:00']);
        const queryMs = options.migration ? Number(process.env.DB_MIGRATION_TIMEOUT_MS || 120000) : Number(process.env.DB_QUERY_TIMEOUT_MS || 5000);
        // mysql2's prepared protocol encodes JS Numbers as DOUBLE. MySQL integer
        // system variables reject that type; text protocol emits escaped integer
        // literals while preserving parameterization.
        await connection.query('SET SESSION max_execution_time = ?, innodb_lock_wait_timeout = ?', [queryMs, Math.max(1, Math.ceil(queryMs / 1000))]);
    } catch (error) {
        await connection.end();
        throw error;
    }
    return connection;
}

function connectDriver(config, signal, register = true) {
    return new Promise((resolve, reject) => {
        const core = mysqlDriver.createConnection(config);
        let settled = false;
        const abort = () => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', abort);
            budget.connections.delete(pendingConnection);
            core.destroy();
            reject(databaseError('DB_UNAVAILABLE'));
        };
        const pendingConnection = { destroy: abort };
        if (register) budget.connections.add(pendingConnection);
        signal?.addEventListener('abort', abort, { once: true });
        core.connect(error => {
            signal?.removeEventListener('abort', abort);
            budget.connections.delete(pendingConnection);
            if (settled) return;
            settled = true;
            if (error) { core.destroy(); reject(error); }
            else resolve(core.promise());
        });
        if (signal?.aborted || (register && budget.closed)) abort();
    });
}

async function createManagedConnection(config) {
    const options = config?.[CONNECTION_OPTIONS] || {};
    const release = await budget.acquire(options.signal);
    let lifecycleOwnsRelease = false;
    try {
        const driverConfig = { ...config };
        delete driverConfig[CONNECTION_OPTIONS];
        return await createTimeZoneAwareConnection(async connectionConfig => {
            const connection = await connectDriver(connectionConfig, options.signal);
            lifecycleOwnsRelease = true;
            return boundConnection(connection, release, {
                budget,
                queryTimeoutMs: options.migration ? Number(process.env.DB_MIGRATION_TIMEOUT_MS || 120000) : Number(process.env.DB_QUERY_TIMEOUT_MS || 5000),
                transactionTimeoutMs: options.migration ? Number(process.env.DB_MIGRATION_TIMEOUT_MS || 120000) : Number(process.env.DB_TRANSACTION_TIMEOUT_MS || 15000),
                signal: options.signal,
                cancelServer: () => cancellation.cancel(connectionConfig, connection.threadId)
            });
        }, driverConfig, options);
    } catch (error) { if (!lifecycleOwnsRelease) release(); throw error; }
}

function installSessionTimeZone() {
    if (mysql[MYSQL_PATCH_MARKER]) return;
    mysql.createConnection = createManagedConnection;
    Object.defineProperty(mysql, MYSQL_PATCH_MARKER, { value: true });
}

function connectionConfig(options = {}) {
    return { ...module.exports, [CONNECTION_OPTIONS]: options };
}

function createSessionConnection() {
    return {
        async query(sql, values) {
            const connection = await mysql.createConnection(module.exports);
            try { return await connection.query(sql, values); }
            finally { await connection.end(); }
        }
    };
}

function tlsConfig() {
    if (process.env.DB_TLS !== '1') return undefined;
    if (net.isIP(process.env.DB_HOST || '')) throw new Error('DB_TLS benötigt für verifizierte Serveridentität einen DNS-Hostnamen als DB_HOST.');
    if (!process.env.DB_TLS_CA_FILE) throw new Error('DB_TLS=1 benötigt DB_TLS_CA_FILE.');
    return { ca: fs.readFileSync(process.env.DB_TLS_CA_FILE, 'utf8'), rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' };
}

validateBusinessTimeZone();
process.env.TZ = BUSINESS_TIME_ZONE;
installSessionTimeZone();

module.exports = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PW,
    database: process.env.DB_NAME,
    timezone: '+00:00',
    dateStrings: ['DATE'],
    supportBigNumbers: true,
    // Preserve numeric COUNT/safe IDs; mysql2 still returns unsafe BIGINT as
    // strings when supportBigNumbers is enabled.
    bigNumberStrings: false,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 3000),
    ssl: tlsConfig()
};

Object.defineProperties(module.exports, {
    connectionConfig: { enumerable: false, value: connectionConfig },
    createSessionConnection: { enumerable: false, value: createSessionConnection },
    connectionBudget: { enumerable: false, value: budget },
    closeConnections: { enumerable: false, value: async () => {
        budget.close();
        // destroy() schedules cancellation dispatch in the next microtask.
        await Promise.resolve();
        await cancellation.drainAndClose();
    } },
    BUSINESS_TIME_ZONE: { enumerable: false, value: BUSINESS_TIME_ZONE },
    createTimeZoneAwareConnection: { enumerable: false, value: createTimeZoneAwareConnection },
    getBusinessUtcOffset: { enumerable: false, value: getBusinessUtcOffset },
    validateBusinessTimeZone: { enumerable: false, value: validateBusinessTimeZone }
});
