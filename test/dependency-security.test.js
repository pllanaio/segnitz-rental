'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const qs = require('qs');

test('qs rejects bracket/comma arrays beyond the configured limit', () => {
    assert.throws(() => qs.parse('a[]=1,2,3,4', {
        comma: true, arrayLimit: 3, throwOnLimitExceeded: true
    }), RangeError);
});

test('qs safely serializes hostile parsed constructor.isBuffer values', () => {
    const parsed = qs.parse('x[constructor][isBuffer]=y', { plainObjects: true });
    assert.doesNotThrow(() => qs.stringify(parsed));
});

test('session persistence uses the same patched mysql2 installation as the application', () => {
    const fromSessionStore = createRequire(require.resolve('express-mysql-session'));
    assert.equal(fromSessionStore.resolve('mysql2'), require.resolve('mysql2'));
});

test('bounded multipart parser rejects an oversized index without blocking the HTTP process', () => {
    const probe = spawnSync(process.execPath, [path.join(__dirname, 'support/multipart-security-probe.js')], {
        encoding: 'utf8', timeout: 3000, maxBuffer: 4096
    });
    assert.equal(probe.error, undefined);
    assert.equal(probe.status, 0);
    assert.deepEqual(JSON.parse(probe.stdout), { status: 400, code: 'LIMIT_FIELD_ARRAY_INDEX' });
});
