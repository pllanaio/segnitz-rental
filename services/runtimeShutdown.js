'use strict';

function normalizeGraceMs(value, fallback = 10000) {
    const numeric = Number(value);
    return Number.isFinite(numeric)
        ? Math.min(Math.max(numeric, 1000), 20000)
        : fallback;
}

async function closeHttpServer(server, options = {}) {
    if (!server?.listening) return;

    const graceMs = normalizeGraceMs(options.graceMs);
    await new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(forceTimer);
            if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
            else resolve();
        };
        const forceTimer = setTimeout(() => {
            server.closeAllConnections?.();
            finish();
        }, graceMs);
        forceTimer.unref?.();

        server.close(finish);
        server.closeIdleConnections?.();
    });
}

async function withDeadline(promise, timeoutMs) {
    const boundedMs = normalizeGraceMs(timeoutMs, 5000);
    let timer;

    try {
        return await Promise.race([
            Promise.resolve(promise).then(() => true),
            new Promise(resolve => {
                timer = setTimeout(() => resolve(false), boundedMs);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    closeHttpServer,
    normalizeGraceMs,
    withDeadline
};
