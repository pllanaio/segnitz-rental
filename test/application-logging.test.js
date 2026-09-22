'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function probe(mode) {
    // The optional local runner's proxy preload emits this bootstrap warning
    // on Node 22. Keep all application log/error output under test; suppress
    // only that unrelated warning code inside this no-network probe process.
    const child = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', path.resolve(__dirname, 'support/log-callsite-probe.js'), mode], {
        encoding: 'utf8', timeout: 5000
    });
    assert.equal(child.status, 0, 'Logging probe must run without app/database startup');
    return { stdout: child.stdout, stderr: child.stderr };
}

test('existing central console serialization keeps untrusted line breaks inside one structured record', () => {
    const { stdout, stderr } = probe('installed-console');
    assert.equal(stderr, '');
    const lines = stdout.trimEnd().split('\n');
    assert.equal(lines.length, 10);
    for (const line of lines) {
        const record = JSON.parse(line);
        assert.equal(record.event === 'forged', false);
    }
});

test('auth and rental callsites emit fixed structured events without relying on global console patching', () => {
    const { stdout, stderr } = probe('direct-structured');
    // Do not echo even synthetic private fixture bodies in assertion diagnostics.
    assert.equal(stderr.length, 0);
    const lines = stdout.trimEnd().split('\n');
    assert.equal(lines.length, 10);
    const records = lines.map(line => JSON.parse(line));
    assert.deepEqual(records.map(record => record.event), [
        'auth.setup.completed', 'auth.login.succeeded', 'auth.logout.succeeded', 'auth.registration.queued',
        'rental.return-mail.failed', 'payment.adjustment.deferred', 'rental.adjustment.failed',
        'payment.return-charge.deferred', 'rental.return.failed', 'payment.cash-record.failed'
    ]);
    for (const privateValue of ['SyntheticPrivateName', 'SyntheticPrivateSurname', 'SyntheticPrivateError',
        'private-fixture@example.invalid', 'synthetic-noncredential', 'synthetic-private-sql', 'synthetic-private-body']) {
        assert.equal(stdout.includes(privateValue), false, 'Private fixture content must not be emitted');
    }
    for (const record of records.filter(record => record.error)) {
        assert.equal(record.error.code, 'FIXTURE_FAILURE');
        assert.deepEqual(Object.keys(record.error).sort(), ['code', 'name']);
    }
    assert.ok(records.slice(0, 4).every(record => /^[A-Za-z0-9_-]{22}$/.test(record.actorRef)));
});
