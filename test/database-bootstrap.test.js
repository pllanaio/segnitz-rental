'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    makeCreateTableIdempotent,
    migrationChecksum,
    quoteIdentifier,
    validateConfiguredSetupToken,
    validateDatabaseConfig
} = require('../database/bootstrap');
const { migrations } = require('../database/migrations/automatic');
const {
    setupTokenMatches,
    validateAdminInput
} = require('../services/setupService');

test('validiert die für den automatischen Bootstrap nötige Datenbankkonfiguration', () => {
    assert.doesNotThrow(() => validateDatabaseConfig({
        host: '127.0.0.1',
        port: 3306,
        user: 'rental',
        database: 'segnitz-rental_$'
    }));

    assert.throws(
        () => validateDatabaseConfig({ host: '', port: 3306, user: 'rental', database: 'rental' }),
        /host fehlt/
    );
    assert.throws(
        () => validateDatabaseConfig({ host: 'db', port: 0, user: 'rental', database: 'rental' }),
        /DB_PORT/
    );
    assert.throws(
        () => validateDatabaseConfig({ host: 'db', port: 3306, user: 'rental', database: 'bad`name' }),
        /DB_NAME/
    );
});

test('quotiert ausschließlich bekannte sichere SQL-Bezeichner', () => {
    assert.equal(quoteIdentifier('rental_orders'), '`rental_orders`');
    assert.throws(() => quoteIdentifier('rental_orders; DROP TABLE users'), /Unsicherer/);
});

test('macht ausschließlich CREATE-TABLE-Anweisungen idempotent', () => {
    assert.equal(
        makeCreateTableIdempotent('CREATE TABLE users (id INT)'),
        'CREATE TABLE IF NOT EXISTS users (id INT)'
    );
    assert.equal(
        makeCreateTableIdempotent('UPDATE users SET role = role'),
        'UPDATE users SET role = role'
    );
});

test('berechnet für jede automatische Migration eine stabile Prüfsumme', () => {
    for (const migration of migrations) {
        const checksum = migrationChecksum(migration);
        assert.match(checksum, /^[a-f0-9]{64}$/);
        assert.equal(checksum, migrationChecksum(migration));
    }
});

test('validiert optional konfigurierte Setup-Codes', () => {
    assert.equal(validateConfiguredSetupToken(''), null);
    assert.equal(
        validateConfiguredSetupToken('a-secure-setup-token-for-tests'),
        'a-secure-setup-token-for-tests'
    );
    assert.throws(() => validateConfiguredSetupToken('too-short'), /ADMIN_SETUP_TOKEN/);
});

test('vergleicht Setup-Codes über ihre konstante SHA-256-Repräsentation', () => {
    const expectedHash = require('../services/setupService').hashSetupToken('correct-token');
    assert.equal(setupTokenMatches('correct-token', expectedHash), true);
    assert.equal(setupTokenMatches('wrong-token', expectedHash), false);
    assert.equal(setupTokenMatches('correct-token', ''), false);
});

test('erzwingt für den ersten Admin eine starke und normalisierte Anmeldung', () => {
    const input = validateAdminInput({
        setupToken: 'setup-token',
        firstName: ' Leon ',
        lastName: ' Admin ',
        email: ' ADMIN@EXAMPLE.COM ',
        password: 'VerySecure123!'
    });

    assert.deepEqual(input, {
        setupToken: 'setup-token',
        firstName: 'Leon',
        lastName: 'Admin',
        email: 'admin@example.com',
        password: 'VerySecure123!'
    });

    assert.throws(
        () => validateAdminInput({
            setupToken: 'setup-token',
            firstName: 'Leon',
            lastName: 'Admin',
            email: 'admin@example.com',
            password: 'weak123!'
        }),
        /Adminpasswort/
    );
});
