'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { registerHealthRoutes } = require('../services/healthRoutes');

test('live and ready bypass a broken session store with and without a session cookie', async () => {
    const app = express();
    let sessionReads = 0;
    const closeHealth = registerHealthRoutes(app, { installationState: () => 'ready', readiness: async () => { throw new Error('database down'); } });
    app.use((req, res) => { sessionReads += 1; res.status(500).json({ error: 'session unavailable' }); });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        for (const headers of [{}, { cookie: 'segnitz.sid=s%3Atest.invalid' }]) {
            const live = await fetch(`${base}/live`, { headers });
            assert.equal(live.status, 200);
            assert.equal((await live.json()).status, 'alive');
            const ready = await fetch(`${base}/ready`, { headers });
            assert.equal(ready.status, 503);
            assert.deepEqual(await ready.json(), { status: 'unavailable', database: 'unavailable', schema: 'unknown', installation: 'ready' });
        }
        assert.equal(sessionReads, 0);
    } finally {
        await new Promise(resolve => server.close(resolve));
        closeHealth();
    }
});
