'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const mysql = require('mysql2/promise');
const dbConfig = require('../config/db');
const { connectOrCreateDatabase } = require('../database/bootstrap');

test('migration principal is isolated from runtime config and retains connection safety options', () => {
    const previous = [process.env.DB_MIGRATION_USER, process.env.DB_MIGRATION_PW];
    try {
        process.env.DB_MIGRATION_USER = 'isolated_migrator';
        process.env.DB_MIGRATION_PW = 'synthetic-test-password';
        const runtime = dbConfig.connectionConfig();
        const migration = dbConfig.connectionConfig({ migration: true });
        assert.equal(migration.user, 'isolated_migrator');
        assert.equal(migration.password, 'synthetic-test-password');
        assert.equal(runtime.user, dbConfig.user);
        assert.equal(runtime.password, dbConfig.password);
        for (const key of ['host', 'port', 'database', 'timezone', 'ssl', 'connectTimeout']) assert.equal(migration[key], runtime[key]);
        assert.equal(migration[Symbol.for('segnitz.mysql.connection-options')].migration, true);
        delete process.env.DB_MIGRATION_USER;
        delete process.env.DB_MIGRATION_PW;
        assert.equal(dbConfig.connectionConfig({ migration: true }).user, dbConfig.user);
    } finally {
        for (const [index, key] of ['DB_MIGRATION_USER', 'DB_MIGRATION_PW'].entries()) {
            if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
        }
    }
});

test('missing-database bootstrap uses migration principal for server creation and reconnect', async () => {
    const previous = [process.env.DB_MIGRATION_USER, process.env.DB_MIGRATION_PW];
    const originalConnect = mysql.createConnection;
    const originalDatabase = dbConfig.database;
    const observed = [];
    let serverClosed = false;
    try {
        process.env.DB_MIGRATION_USER = 'isolated_migrator';
        process.env.DB_MIGRATION_PW = 'synthetic-test-password';
        dbConfig.database = 'isolated_credential_contract';
        const finalConnection = {};
        mysql.createConnection = async config => {
            observed.push(config);
            if (observed.length === 1) throw Object.assign(new Error('Unknown isolated database'), { code: 'ER_BAD_DB_ERROR' });
            if (observed.length === 2) return { query: async sql => assert.match(sql, /^CREATE DATABASE IF NOT EXISTS `isolated_credential_contract`/u), end: async () => { serverClosed = true; } };
            return finalConnection;
        };
        assert.deepEqual(await connectOrCreateDatabase(), { connection: finalConnection, databaseCreated: true });
        assert.equal(observed.length, 3);
        for (const config of observed) {
            assert.equal(config.user, 'isolated_migrator');
            assert.equal(config.password, 'synthetic-test-password');
            assert.equal(config[Symbol.for('segnitz.mysql.connection-options')].migration, true);
        }
        assert.equal(observed[1].database, undefined);
        assert.equal(serverClosed, true);
    } finally {
        mysql.createConnection = originalConnect;
        dbConfig.database = originalDatabase;
        for (const [index, key] of ['DB_MIGRATION_USER', 'DB_MIGRATION_PW'].entries()) {
            if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
        }
    }
});
