'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const mysql = require('mysql2/promise');
const dbConfig = require('../config/db');
const { migrations } = require('./migrations/automatic');
const { readSqlStatements } = require('./sql');
const { setInstallationState } = require('./installationState');
const { hashSetupToken } = require('../services/setupService');

const schemaPath = path.join(__dirname, 'schema.sql');
const bootstrapLockTimeoutSeconds = 60;
const populationTables = [
    'users',
    'rental_products',
    'rental_orders'
];

function validateDatabaseConfig(config = dbConfig) {
    for (const field of ['host', 'user', 'database']) {
        if (!String(config[field] || '').trim()) {
            throw new Error(`Datenbankkonfiguration unvollständig: ${field} fehlt.`);
        }
    }

    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
        throw new Error('Datenbankkonfiguration ungültig: DB_PORT muss ein gültiger Port sein.');
    }

    if (!/^[A-Za-z0-9_$-]+$/.test(config.database)) {
        throw new Error('DB_NAME enthält nicht unterstützte Zeichen.');
    }
}

function quoteDatabaseName(databaseName) {
    return `\`${databaseName.replace(/`/g, '``')}\``;
}

function quoteIdentifier(identifier) {
    if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
        throw new Error(`Unsicherer SQL-Bezeichner: ${identifier}`);
    }

    return `\`${identifier}\``;
}

async function connectOrCreateDatabase() {
    try {
        return {
            connection: await mysql.createConnection(dbConfig),
            databaseCreated: false
        };
    } catch (error) {
        if (error.code !== 'ER_BAD_DB_ERROR') throw error;

        const { database, ...serverConfig } = dbConfig;
        const serverConnection = await mysql.createConnection(serverConfig);

        try {
            await serverConnection.query(
                `CREATE DATABASE IF NOT EXISTS ${quoteDatabaseName(database)} ` +
                'CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
            );
        } finally {
            await serverConnection.end();
        }

        return {
            connection: await mysql.createConnection(dbConfig),
            databaseCreated: true
        };
    }
}

async function getExistingTableNames(connection) {
    const [rows] = await connection.execute(
        `SELECT TABLE_NAME AS tableName
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_TYPE = 'BASE TABLE'`
    );

    return new Set(rows.map(row => row.tableName));
}

async function isDatabaseUnpopulated(connection, existingTables) {
    for (const tableName of populationTables) {
        if (!existingTables.has(tableName)) continue;

        const [rows] = await connection.query(
            `SELECT 1 FROM ${quoteIdentifier(tableName)} LIMIT 1`
        );

        if (rows.length > 0) return false;
    }

    return true;
}

function makeCreateTableIdempotent(statement) {
    return statement.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
}

async function ensureCanonicalTables(connection) {
    for (const statement of readSqlStatements(schemaPath)) {
        if (!/^CREATE\s+TABLE\b/i.test(statement)) continue;
        await connection.query(makeCreateTableIdempotent(statement));
    }
}

function migrationChecksum(migration) {
    return crypto
        .createHash('sha256')
        .update(migration.checksumSource, 'utf8')
        .digest('hex');
}

async function runAutomaticMigrations(connection) {
    const appliedVersions = [];

    for (const migration of migrations) {
        const checksum = migrationChecksum(migration);
        const [rows] = await connection.execute(
            `SELECT checksum
             FROM app_schema_migrations
             WHERE version = ?
             LIMIT 1`,
            [migration.version]
        );

        if (rows.length > 0) {
            if (rows[0].checksum !== checksum) {
                throw new Error(
                    `Migration ${migration.version} wurde nachträglich verändert. ` +
                    'Der Serverstart wurde zum Schutz der Datenbank abgebrochen.'
                );
            }

            continue;
        }

        console.log(`${new Date().toISOString()} - Starte Datenbankmigration ${migration.version}`);
        await migration.up(connection);
        await connection.execute(
            `INSERT INTO app_schema_migrations (version, checksum)
             VALUES (?, ?)`,
            [migration.version, checksum]
        );
        appliedVersions.push(migration.version);
        console.log(`${new Date().toISOString()} - Datenbankmigration ${migration.version} abgeschlossen`);
    }

    return appliedVersions;
}

function validateConfiguredSetupToken(token) {
    const normalizedToken = String(token || '');

    if (!normalizedToken) return null;

    const minimumLength = process.env.NODE_ENV === 'production' ? 32 : 16;

    if (normalizedToken.length < minimumLength || normalizedToken.length > 512) {
        throw new Error(
            `ADMIN_SETUP_TOKEN muss ${minimumLength} bis 512 Zeichen lang sein.`
        );
    }

    return normalizedToken;
}

async function initializeInstallation(connection) {
    const configuredSetupToken = validateConfiguredSetupToken(process.env.ADMIN_SETUP_TOKEN);

    await connection.beginTransaction();

    try {
        const [installationRows] = await connection.execute(
            `SELECT status, setup_token_hash
             FROM app_installation
             WHERE id = 1
             FOR UPDATE`
        );
        const [adminRows] = await connection.execute(
            `SELECT id
             FROM users
             WHERE role = 'global_admin'
             LIMIT 1`
        );
        const adminExists = adminRows.length > 0;
        let setupToken = null;
        let setupTokenSource = null;
        let status;

        if (installationRows.length === 0) {
            status = adminExists ? 'ready' : 'setup_required';

            if (status === 'setup_required') {
                setupToken = configuredSetupToken || crypto.randomBytes(32).toString('base64url');
                setupTokenSource = configuredSetupToken ? 'environment' : 'generated';
            }

            await connection.execute(
                `INSERT INTO app_installation
                 (id, status, setup_token_hash, setup_token_created_at, initialized_at)
                 VALUES (
                    1,
                    ?,
                    ?,
                    CASE WHEN ? IS NULL THEN NULL ELSE NOW() END,
                    CASE WHEN ? = 'ready' THEN NOW() ELSE NULL END
                 )`,
                [
                    status,
                    setupToken ? hashSetupToken(setupToken) : null,
                    setupToken,
                    status
                ]
            );
        } else {
            status = installationRows[0].status;

            if (status === 'setup_required' && adminExists) {
                status = 'ready';
                await connection.execute(
                    `UPDATE app_installation
                     SET status = 'ready',
                         setup_token_hash = NULL,
                         setup_token_created_at = NULL,
                         initialized_at = COALESCE(initialized_at, NOW())
                     WHERE id = 1`
                );
            } else if (status === 'setup_required' && configuredSetupToken) {
                setupToken = configuredSetupToken;
                setupTokenSource = 'environment';
                await connection.execute(
                    `UPDATE app_installation
                     SET setup_token_hash = ?, setup_token_created_at = NOW()
                     WHERE id = 1`,
                    [hashSetupToken(setupToken)]
                );
            } else if (status === 'ready' && !adminExists) {
                throw new Error(
                    'Die Installation ist als abgeschlossen markiert, enthält aber kein globales Adminkonto.'
                );
            }
        }

        await connection.commit();
        setInstallationState(status);

        return {
            setupToken,
            setupTokenSource,
            status
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function acquireBootstrapLock(connection) {
    const lockName = `segnitz-bootstrap:${dbConfig.database}`.slice(0, 64);
    const [rows] = await connection.execute(
        'SELECT GET_LOCK(?, ?) AS acquired',
        [lockName, bootstrapLockTimeoutSeconds]
    );

    if (Number(rows[0]?.acquired) !== 1) {
        throw new Error('Der Datenbank-Bootstrap-Lock konnte nicht rechtzeitig erworben werden.');
    }

    return lockName;
}

async function initializeDatabase() {
    validateDatabaseConfig();

    const { connection, databaseCreated } = await connectOrCreateDatabase();
    let lockName;

    try {
        lockName = await acquireBootstrapLock(connection);
        const existingTables = await getExistingTableNames(connection);
        const databaseWasUnpopulated = await isDatabaseUnpopulated(connection, existingTables);

        await ensureCanonicalTables(connection);
        const appliedMigrations = await runAutomaticMigrations(connection);
        const installation = await initializeInstallation(connection);

        return {
            appliedMigrations,
            databaseCreated,
            databaseWasUnpopulated,
            ...installation
        };
    } finally {
        if (lockName) {
            try {
                await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]);
            } catch (error) {
                console.error('Bootstrap-Lock konnte nicht freigegeben werden:', error);
            }
        }

        await connection.end();
    }
}

module.exports = {
    ensureCanonicalTables,
    initializeDatabase,
    makeCreateTableIdempotent,
    migrationChecksum,
    quoteIdentifier,
    runAutomaticMigrations,
    validateConfiguredSetupToken,
    validateDatabaseConfig
};
