'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    assertTestDatabaseName,
    readSchemaStatements,
    tableNames
} = require('./support/database-schema');

const schema = readSchemaStatements().join('\n');

test('defines every application table in the canonical schema', () => {
    for (const table of tableNames) {
        assert.match(schema, new RegExp(`CREATE TABLE ${table} \\(`));
    }
});

test('keeps evolving lifecycle states out of restrictive ENUM columns', () => {
    const lifecycleColumns = [
        'status VARCHAR(50)',
        'return_status VARCHAR(50)',
        'return_case_status VARCHAR(50)',
        'item_status VARCHAR(50)',
        'payment_type VARCHAR(80)',
        'payment_method VARCHAR(50)',
        'payment_status VARCHAR(50)'
    ];

    for (const definition of lifecycleColumns) {
        assert.equal(schema.includes(definition), true, definition);
    }

    assert.doesNotMatch(schema, /\bENUM\s*\(/i);
});

test('matches the token and webhook columns used by the server', () => {
    assert.match(schema, /verification_token VARCHAR\(128\)/);
    assert.match(schema, /verification_expires DATETIME/);
    assert.match(schema, /reset_token VARCHAR\(255\)/);
    assert.match(schema, /reset_token_expires DATETIME/);
    assert.match(schema, /processed_at DATETIME/);
    assert.match(schema, /guest_verifications[\s\S]*verified TINYINT\(1\)/);
});

test('refuses destructive resets for non-test database names', () => {
    assert.doesNotThrow(() => assertTestDatabaseName('segnitz_test'));
    assert.doesNotThrow(() => assertTestDatabaseName('ci-rental'));
    assert.throws(() => assertTestDatabaseName('db_segnitz'), /Unsicherer Datenbankname/);
    assert.throws(() => assertTestDatabaseName(''), /Unsicherer Datenbankname/);
});
