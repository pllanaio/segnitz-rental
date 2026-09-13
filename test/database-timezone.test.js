'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_NAME ||= 'segnitz_test';

const dbConfig = require('../config/db');

test('berechnet Europe/Berlin inklusive Sommer- und Winterzeit', () => {
    assert.equal(dbConfig.BUSINESS_TIME_ZONE, 'Europe/Berlin');
    assert.equal(dbConfig.getBusinessUtcOffset(new Date('2026-01-15T12:00:00Z')), '+01:00');
    assert.equal(dbConfig.getBusinessUtcOffset(new Date('2026-07-15T12:00:00Z')), '+02:00');
    assert.equal(process.env.TZ, 'Europe/Berlin');
});

test('weist unbekannte Geschäftszeitzonen zurück', () => {
    assert.throws(
        () => dbConfig.validateBusinessTimeZone('Europe/Definitely-Unknown'),
        /Ungültige BUSINESS_TIME_ZONE/
    );
});

test('setzt für jede neue Verbindung Client- und MySQL-Session-Zeitzone', async () => {
    const observed = [];
    const connection = {
        async execute(sql, params) {
            observed.push({ sql, params });
        },
        async query(sql, params) { observed.push({ sql, params }); },
        async end() {}
    };

    await dbConfig.createTimeZoneAwareConnection(
        async config => {
            observed.push({ config });
            return connection;
        },
        { host: 'db' },
        new Date('2026-01-15T12:00:00Z')
    );

    assert.equal(observed[0].config.timezone, '+00:00');
    assert.deepEqual(observed[1], {
        sql: 'SET SESSION time_zone = ?',
        params: ['+00:00']
    });
});

test('sets integer MySQL system limits via text protocol rather than DOUBLE prepared bindings', async () => {
    const observed = [];
    const connection = {
        async execute(sql, params) {
            if (sql.includes('max_execution_time')) {
                throw Object.assign(new Error("Incorrect argument type to variable 'max_execution_time'"), { code: 'ER_WRONG_TYPE_FOR_VAR' });
            }
            observed.push({ method: 'execute', sql, params });
        },
        async query(sql, params) { observed.push({ method: 'query', sql, params }); },
        async end() {}
    };
    await dbConfig.createTimeZoneAwareConnection(async () => connection, { host: 'db' });
    const limits = observed.find(call => call.sql.includes('max_execution_time'));
    assert.equal(limits.method, 'query');
    assert.deepEqual(limits.params, [5000, 5]);
});
