'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const mysql = require('mysql2/promise');
const dbConfig = require('../../config/db');
const { assertTestDatabaseName } = require('../support/database-schema');
const { businessPeriodBounds, withBusinessPeriod } = require('../../utils/businessPeriod');

test('real UTC MySQL predicates and customer/admin period buckets share Berlin boundaries', async () => {
    assertTestDatabaseName();
    const connection = await mysql.createConnection(dbConfig);
    try {
        await connection.query('CREATE TEMPORARY TABLE order_period_probe (id INT NOT NULL PRIMARY KEY, created_at TIMESTAMP NOT NULL)');
        for (const [year, month] of [['2026', '07'], ['2026', '03'], ['2026', '10'], ['2026', '12'], ['2026', '']]) {
            const { start, end } = businessPeriodBounds(year, month, 'Europe/Berlin');
            await connection.query('DELETE FROM order_period_probe');
            const instants = [new Date(start.getTime() - 1000), start, new Date(end.getTime() - 1000), end];
            for (let index = 0; index < instants.length; index += 1) {
                await connection.execute('INSERT INTO order_period_probe (id, created_at) VALUES (?, ?)', [index + 1, instants[index]]);
            }
            const [selected] = await connection.execute(
                'SELECT id, created_at AS createdAt FROM order_period_probe WHERE created_at >= ? AND created_at < ? ORDER BY id',
                [start, end]
            );
            assert.deepEqual(selected.map(row => row.id), [2, 3]);
            const options = selected.map(row => withBusinessPeriod(row, 'Europe/Berlin'));
            assert.equal(options.every(row => row.year === year), true);
            if (month) assert.equal(options.every(row => row.month === month), true);
            const [[boundary]] = await connection.execute('SELECT created_at AS createdAt FROM order_period_probe WHERE id = 4');
            const nextPeriod = withBusinessPeriod(boundary, 'Europe/Berlin');
            if (month) assert.equal(nextPeriod.year !== year || nextPeriod.month !== month, true);
            else { assert.equal(nextPeriod.year, String(Number(year) + 1)); assert.equal(nextPeriod.month, '01'); }
        }
    } finally {
        await connection.end(); // The temporary fixture disappears with this connection.
    }
});
