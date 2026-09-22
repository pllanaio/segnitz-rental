'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('ephemeral restore TLS certificates validate owned identities and reject wrong CA/hostname', () => {
    const result = spawnSync('python3', [path.join(__dirname, 'restore-tls.test.py')], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
});

test('TLS rehearsal verifier refuses execution outside its explicit isolated test environment', () => {
    // Suppress only the optional local proxy preload's experimental warning;
    // every application diagnostic remains part of the strict JSON assertion.
    const result = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', path.join(__dirname, '../scripts/ops/verify-database-tls.js'), 'trusted'], {
        encoding: 'utf8', timeout: 5000,
        env: { ...process.env, NODE_ENV: 'production', RESTORE_SYNTHETIC_REHEARSAL: '0' }
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { event: 'restore.tls.failed' });
});
