'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { closeHttpServer, withDeadline } = require('../services/runtimeShutdown');

test('erzwingt HTTP-Shutdown trotz hängendem Request innerhalb der Grace-Period', async () => {
    let markRequestReceived;
    const requestReceived = new Promise(resolve => {
        markRequestReceived = resolve;
    });
    const server = http.createServer(() => {
        markRequestReceived();
        // Intentionally never completes: models a stuck application request.
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const request = http.get({
        host: '127.0.0.1',
        port: server.address().port,
        path: '/hang'
    });
    request.on('error', () => {});
    await requestReceived;

    const startedAt = Date.now();
    await closeHttpServer(server, { graceMs: 1000 });
    const durationMs = Date.now() - startedAt;

    assert.ok(durationMs >= 900, `Shutdown war unerwartet früh: ${durationMs} ms`);
    assert.ok(durationMs < 1800, `Shutdown überschritt Deadline: ${durationMs} ms`);
    assert.equal(server.listening, false);
    request.destroy();
});

test('meldet erfolgreiches Ressourcen-Drain vor der Deadline', async () => {
    assert.equal(await withDeadline(Promise.resolve(), 5000), true);
});
