'use strict';

const mysql = require('mysql2/promise');
const dbConfig = require('../config/db');
const { verifyCanonicalSchema } = require('./schemaContract');
const { assertExactAppliedMigrationState } = require('./migrationState');

const defaultDeepCheckIntervalMs = 5 * 60 * 1000;
const defaultFailureRetryIntervalMs = 5 * 1000;
let lastSchemaCheck = null;
let lastSchemaCheckAt = 0;
let lastSchemaError = null;
let lastSchemaErrorAt = 0;
let schemaCheckPromise = null;
let expectedMigrationManifest = [];

async function runDeepSchemaCheck(connectionFactory = () => mysql.createConnection(dbConfig)) {
    const connection = await connectionFactory();

    try {
        const schema = await verifyCanonicalSchema(connection);
        lastSchemaCheck = schema;
        lastSchemaCheckAt = Date.now();
        return schema;
    } finally {
        await connection.end();
    }
}

function primeSchemaReadiness(schema, migrationManifest = []) {
    lastSchemaCheck = schema;
    lastSchemaCheckAt = Date.now();
    lastSchemaError = null;
    lastSchemaErrorAt = 0;
    expectedMigrationManifest = migrationManifest.map(migration => ({ ...migration }));
}

async function getCachedSchemaReadiness({
    connectionFactory,
    deepCheckIntervalMs = defaultDeepCheckIntervalMs,
    failureRetryIntervalMs = defaultFailureRetryIntervalMs,
    now = Date.now()
} = {}) {
    const cacheIsFresh = lastSchemaCheck && now - lastSchemaCheckAt < deepCheckIntervalMs;
    if (cacheIsFresh) return lastSchemaCheck;

    const failureIsFresh = lastSchemaError && now - lastSchemaErrorAt < failureRetryIntervalMs;
    if (failureIsFresh) throw lastSchemaError;

    if (!schemaCheckPromise) {
        schemaCheckPromise = runDeepSchemaCheck(connectionFactory)
            .then(schema => {
                lastSchemaError = null;
                lastSchemaErrorAt = 0;
                return schema;
            })
            .catch(error => {
                lastSchemaError = error;
                lastSchemaErrorAt = Date.now();
                throw error;
            })
            .finally(() => {
                schemaCheckPromise = null;
            });
    }

    return schemaCheckPromise;
}

async function checkDatabaseReadiness({
    connectionFactory,
    deepCheckIntervalMs,
    failureRetryIntervalMs,
    now
} = {}) {
    const createConnection = connectionFactory || (() => mysql.createConnection(dbConfig));
    const connection = await createConnection();
    let sessionTimeZone;

    try {
        const [pingRows] = await connection.query(
            'SELECT 1 AS alive, @@session.time_zone AS sessionTimeZone'
        );

        if (Number(pingRows[0]?.alive) !== 1) {
            throw new Error('Datenbank-Ping ist nicht bereit.');
        }
        sessionTimeZone = pingRows[0].sessionTimeZone;

        if (expectedMigrationManifest.length > 0) {
            const [migrationRows] = await connection.execute(
                `SELECT version, checksum
                 FROM app_schema_migrations
                 ORDER BY version`
            );
            assertExactAppliedMigrationState(migrationRows, expectedMigrationManifest);
        }
    } finally {
        await connection.end();
    }

    // Do not let concurrent public readiness requests retain their individual
    // ping connections while waiting for the shared, potentially slower scan.
    const schema = await getCachedSchemaReadiness({
        connectionFactory: createConnection,
        deepCheckIntervalMs,
        failureRetryIntervalMs,
        now
    });

    return { schema, sessionTimeZone };
}

function resetReadinessCache() {
    lastSchemaCheck = null;
    lastSchemaCheckAt = 0;
    lastSchemaError = null;
    lastSchemaErrorAt = 0;
    schemaCheckPromise = null;
    expectedMigrationManifest = [];
}

module.exports = {
    checkDatabaseReadiness,
    getCachedSchemaReadiness,
    primeSchemaReadiness,
    resetReadinessCache,
    runDeepSchemaCheck
};
