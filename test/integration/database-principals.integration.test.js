'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { assertTestDatabaseName } = require('../support/database-schema');

test('real MySQL separates migration DDL from runtime DML with independent owned connections', async () => {
    const suffix = crypto.randomBytes(8).toString('hex');
    const database = `segnitz_principals_test_${suffix}`;
    const runtimeUser = `sr_rt_${suffix}`;
    const migrationUser = `sr_mg_${suffix}`;
    const runtimePassword = crypto.randomBytes(32).toString('base64url');
    const migrationPassword = crypto.randomBytes(32).toString('base64url');
    assertTestDatabaseName(database);
    const previousEnv = [process.env.DB_MIGRATION_USER, process.env.DB_MIGRATION_PW];
    const previousConfig = { user: dbConfig.user, password: dbConfig.password, database: dbConfig.database };
    const { database: unused, ...serverConfig } = dbConfig.connectionConfig({ migration: true });
    const admin = await mysql.createConnection(serverConfig);
    let databaseCreated = false;
    const createdUsers = [];
    let runtime;
    let migration;
    try {
        // Accounts and their schema are unpredictable, newly owned test
        // resources; no existing account, grants or database is modified.
        await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
        databaseCreated = true;
        for (const [user, password] of [[runtimeUser, runtimePassword], [migrationUser, migrationPassword]]) {
            await admin.query("CREATE USER ?@'%' IDENTIFIED BY ?", [user, password]);
            createdUsers.push(user);
        }
        await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO ?@'%'`, [runtimeUser]);
        await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, TRIGGER ON \`${database}\`.* TO ?@'%'`, [migrationUser]);
        Object.assign(dbConfig, { user: runtimeUser, password: runtimePassword, database });
        process.env.DB_MIGRATION_USER = migrationUser;
        process.env.DB_MIGRATION_PW = migrationPassword;
        migration = await mysql.createConnection(dbConfig.connectionConfig({ migration: true }));
        runtime = await mysql.createConnection(dbConfig.connectionConfig());
        assert.equal((await migration.query('SELECT CURRENT_USER() AS principal'))[0][0].principal, `${migrationUser}@%`);
        assert.equal((await runtime.query('SELECT CURRENT_USER() AS principal'))[0][0].principal, `${runtimeUser}@%`);
        await migration.query('CREATE TABLE principal_probe (id INT PRIMARY KEY, value VARCHAR(16) NOT NULL) ENGINE=InnoDB');
        await runtime.execute("INSERT INTO principal_probe VALUES (1, 'isolated')");
        assert.equal((await migration.query('SELECT value FROM principal_probe WHERE id=1'))[0][0].value, 'isolated');
        await assert.rejects(runtime.query('CREATE TABLE forbidden_runtime_ddl (id INT PRIMARY KEY)'), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
        for (const connection of [runtime, migration]) {
            assert.equal((await connection.query('SELECT @@session.time_zone AS zone'))[0][0].zone, '+00:00');
        }
    } finally {
        await Promise.allSettled([runtime?.end(), migration?.end()]);
        Object.assign(dbConfig, previousConfig);
        for (const [index, key] of ['DB_MIGRATION_USER', 'DB_MIGRATION_PW'].entries()) {
            if (previousEnv[index] === undefined) delete process.env[key]; else process.env[key] = previousEnv[index];
        }
        try {
            for (const user of createdUsers) await admin.query("DROP USER ?@'%'", [user]);
            if (databaseCreated) await admin.query(`DROP DATABASE \`${database}\``);
        } finally { await admin.end(); }
    }
});
