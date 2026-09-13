'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const { validateImage, probe } = require('../scripts/ops/preflight');
const { validateManifest } = require('../scripts/release-artifact');
const { redact, redactString, requestObservability, operationsSnapshot, operationsMetricsHandler, setLogSink } = require('../services/observability');

test('logs redact nested auth data, error SQL, images and known environment secrets', () => {
    const secret = 'synthetic-operations-secret-not-a-credential';
    process.env.TEST_PASSWORD = secret;
    try {
        const error = Object.assign(new Error(`SQL with ${secret}`), { sql: 'private customer', code: 'ECONNRESET' });
        const result = JSON.stringify(redact({ nested: { reset_token: 'synthetic-token', password: secret,
            value: `Bearer synthetic-bearer ${secret}`, error }, signature: 'data:image/png;base64,abcd' }));
        for (const privateValue of [secret, 'synthetic-token', 'synthetic-bearer', 'private customer', 'data:image']) assert.ok(!result.includes(privateValue));
        assert.match(result, /ECONNRESET/);
        assert.equal(redactString('mail-password-reset-' + 'f'.repeat(64)), 'mail-password-reset-[REDACTED]');
        assert.ok(!redactString('https://example.invalid/reset?token=secret-value').includes('secret-value'));
    } finally { delete process.env.TEST_PASSWORD; }
});

test('HTTP correlation and admin mutation receipt contain no query, body or cookie', async () => {
    const records = [];
    setLogSink(value => records.push(value));
    const server = http.createServer((req, res) => requestObservability(req, res, () => {
        req.route = { path: '/admin/orders/:id' };
        req.params = { id: '42' };
        req.session = { role: 'global_admin', user: 'synthetic@example.invalid' };
        res.end('ok');
    }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/orders/42?token=private`, {
            method: 'PUT', headers: { Cookie: 'secret-cookie', 'X-Request-ID': 'untrusted-client-id' } });
        assert.match(response.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
        await response.text();
        assert.equal(records.length, 2);
        assert.equal(records[1].event, 'admin.mutation.receipt');
        assert.equal(records[1].references.id, '42');
        for (const value of ['secret-cookie', 'private', 'synthetic@example.invalid', 'untrusted-client-id']) assert.ok(!JSON.stringify(records).includes(value));
    } finally { await new Promise(resolve => server.close(resolve)); setLogSink(() => {}); }
});

test('metrics expose missing backup evidence as unknown and require global admin', async () => {
    const snapshot = await operationsSnapshot({ storagePaths: [], backupEvidencePath: '/nonexistent/segnitz-test-evidence' });
    assert.deepEqual(snapshot.backup, { lastCompletedAt: null, ageSeconds: null });
    let status;
    await operationsMetricsHandler({})({ session: { role: 'customer' } }, { setHeader() {}, status(code) { status = code; return this; }, json() {} });
    assert.equal(status, 403);
});

test('preflight rejects tags, changed digests and mismatched reviewed image', () => {
    const manifest = { schema: 1, commit: 'a'.repeat(40), imageDigest: 'sha256:' + 'b'.repeat(64), archiveSha256: 'c'.repeat(64) };
    validateImage(`pllanaio/segnitz-rental@${manifest.imageDigest}`, manifest);
    for (const image of ['pllanaio/segnitz-rental:latest', `other/repo@${manifest.imageDigest}`]) assert.throws(() => validateImage(image, manifest));
    assert.throws(() => validateManifest(manifest, { digest: 'sha256:' + 'd'.repeat(64) }));
});

test('smoke preflight rejects unavailable readiness and unsafe remote HTTP', async () => {
    await assert.rejects(probe('http://example.invalid'), /HTTPS/);
    await assert.rejects(probe('http://127.0.0.1', { fetchImpl: async url => ({ status: url.pathname === '/live' ? 200 : 503 }) }), /ready/);
    assert.equal((await probe('http://127.0.0.1', { fetchImpl: async () => ({ status: 200 }) })).length, 2);
});


test('alarm evaluator reports real deltas, stalled work and missing recovery evidence without sending', () => {
    const { evaluateAlarms } = require('../scripts/ops/check-alarms');
    const config = { ...require('../docs/monitoring.example.json'), targetRef: 'existing-operator-monitor', backupMaxAgeSeconds: 3600 };
    const previous = { startedAt: 'same', requests: 10, errors: 0, dbPool: { queryTimeouts: 0 }, latencyBucketsMs: { 1000: 10, infinity: 10 } };
    const current = { startedAt: 'same', requests: 110, errors: 10, dbPool: { queryTimeouts: 2, quarantined: 1 },
        latencyBucketsMs: { 1000: 100, infinity: 110 }, backup: { ageSeconds: 4000, restoreVerified: false },
        outbox: [{ status: 'pending', count: 3, oldestSeconds: 2000 }, { status: 'dead', count: 1 }],
        payments: [{ status: 'pending', count: 1, oldestSeconds: 2000 }], storage: [{ volume: 'returns', availableBytes: 0 }] };
    const result = evaluateAlarms(current, previous, config);
    assert.equal(result.state, 'alert');
    for (const code of ['http_error_ratio', 'http_slow_ratio', 'db_queryTimeouts', 'db_quarantined', 'backup_stale',
        'restore_not_verified', 'outbox_old', 'outbox_dead', 'worker_stalled', 'storage_low_or_unknown', 'payment_or_refund_stale']) {
        assert.ok(result.alarms.some(alarm => alarm.code === code), code);
    }
    assert.throws(() => evaluateAlarms(current, previous, {}));
});
