'use strict';

const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs/promises');
const { redactSecrets } = require('../utils/redaction');
const context = new AsyncLocalStorage();
const sensitiveKey = /password|secret|token|api.?key|db_pw|authorization|cookie|signature|payload|address|email|phone|sql|parameters|bindings/i;
const metrics = { startedAt: new Date().toISOString(), requests: 0, inflight: 0, errors: 0, aborted: 0,
    latencyBucketsMs: { 50: 0, 100: 0, 250: 0, 500: 0, 1000: 0, 5000: 0, infinity: 0 },
    statusCodes: {}, workerLastProgressAt: null, workerProcessed: 0, dbTimeouts: 0 };
let installed = false;
let sink = record => process.stdout.write(`${JSON.stringify(record)}\n`);

function redactString(input, env = process.env) {
    let value = String(input);
    for (const [key, secret] of Object.entries(env)) {
        if (sensitiveKey.test(key) && typeof secret === 'string' && secret.length >= 8) value = value.split(secret).join('[REDACTED]');
    }
    return redactSecrets(value).replace(/data:image\/[^\s"']+/gi, '[IMAGE REDACTED]')
        .replace(/Bearer\s+[^\s,"']+/gi, 'Bearer [REDACTED]')
        .replace(/(mail-(?:password-reset|verification)-)[^\s,]+/gi, '$1[REDACTED]')
        .replace(/([?&](?:token|code|secret|key|password)=)[^&\s"']+/gi, '$1[REDACTED]')
        .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL REDACTED]')
        .replace(/\b[a-f0-9]{32,}\b/gi, '[IDENTIFIER REDACTED]')
        .replace(/\b[A-Za-z0-9+/=_-]{80,}\b/g, '[VALUE REDACTED]')
        .replace(/[\r\n]/g, ' ').slice(0, 2000);
}

function redact(value, key = '', seen = new Set(), depth = 0) {
    if (sensitiveKey.test(key)) return '[REDACTED]';
    if (value instanceof Error) return { name: value.name, code: value.code ? redactString(value.code) : undefined };
    if (typeof value === 'string') return redactString(value);
    if (typeof value === 'bigint') return value.toString();
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value) || depth > 5) return '[OMITTED]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 20).map(item => redact(item, key, seen, depth + 1));
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([name, item]) => [name, redact(item, name, seen, depth + 1)]));
}

function actorReference(identifier) {
    return crypto.createHash('sha256').update(String(identifier || '')).digest('base64url').slice(0, 22);
}

function log(level, event, fields = {}) {
    sink({ timestamp: new Date().toISOString(), level, event: redactString(event), ...redact(context.getStore() || {}), ...redact(fields) });
}

function installConsoleRedaction() {
    if (installed) return;
    installed = true;
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        console[level] = (...values) => log(level === 'log' ? 'info' : level, 'application', { values });
    }
}

function recordWorkerProgress(processed = 0) {
    metrics.workerLastProgressAt = new Date().toISOString();
    metrics.workerProcessed += Math.max(0, Number(processed) || 0);
}

function recordDbTimeout() { metrics.dbTimeouts += 1; }

function requestObservability(req, res, next) {
    // Generate correlation IDs locally: clients cannot inject other users' IDs or logs.
    const requestId = crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    const started = process.hrtime.bigint();
    metrics.requests += 1;
    metrics.inflight += 1;
    let finished = false;
    const complete = aborted => {
        if (finished) return;
        finished = true;
        metrics.inflight -= 1;
        if (aborted) metrics.aborted += 1;
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        for (const bucket of Object.keys(metrics.latencyBucketsMs)) {
            if (bucket === 'infinity' || durationMs <= Number(bucket)) metrics.latencyBucketsMs[bucket] += 1;
        }
        const status = res.statusCode;
        metrics.statusCodes[status] = (metrics.statusCodes[status] || 0) + 1;
        if (status >= 500) metrics.errors += 1;
        const route = typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
        const fields = { requestId, method: req.method, route, status, durationMs: Math.round(durationMs), aborted };
        log(status >= 500 ? 'error' : 'info', 'http.request', fields);
        if (!aborted && status >= 200 && status < 300 && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
            ['global_admin', 'bearbeiter'].includes(req.session?.role)) {
            const actorRef = actorReference(req.session.user);
            const references = Object.fromEntries(Object.entries(req.params || {}).filter(([name, value]) => /^(id|itemId|orderId)$/.test(name) && /^[1-9][0-9]{0,14}$/.test(value)));
            log('info', 'admin.mutation.receipt', { ...fields, actorRef, actorRole: req.session.role, references });
        }
    };
    res.once('finish', () => complete(false));
    res.once('close', () => complete(!res.writableFinished));
    context.run({ requestId }, next);
}

async function operationsSnapshot({ query, storagePaths = ['/app/public/img/products', '/app/uploads/returns'], backupEvidencePath = process.env.BACKUP_EVIDENCE_PATH, dbBudget, reconciliationProgress } = {}) {
    const snapshot = JSON.parse(JSON.stringify(metrics));
    snapshot.sampledAt = new Date().toISOString();
    if (dbBudget) snapshot.dbPool = dbBudget.snapshot();
    if (typeof reconciliationProgress === 'function') snapshot.paymentReconciliation = reconciliationProgress();
    if (query) {
        const [rows] = await query(`SELECT status, COUNT(*) AS count,
            COALESCE(MAX(TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP())), 0) AS oldest_seconds
            FROM external_effects_outbox GROUP BY status`);
        snapshot.outbox = rows.map(row => ({ status: row.status, count: Number(row.count), oldestSeconds: Number(row.oldest_seconds) }));
        const [payments] = await query(`SELECT payment_type AS type, payment_status AS status, COUNT(*) AS count,
            COALESCE(MAX(TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP())), 0) AS oldest_seconds
            FROM rental_order_payments WHERE payment_status IN ('pending', 'open', 'authorized', 'failed', 'charged_back')
            GROUP BY payment_type, payment_status`);
        snapshot.payments = payments.map(row => ({ type: row.type, status: row.status, count: Number(row.count), oldestSeconds: Number(row.oldest_seconds) }));
    }
    snapshot.storage = await Promise.all(storagePaths.map(async (storagePath, index) => {
        try {
            const stat = await fs.statfs(storagePath);
            return { volume: index === 0 ? 'product-images' : 'return-images', availableBytes: Number(stat.bavail) * Number(stat.bsize) };
        } catch { return { volume: index === 0 ? 'product-images' : 'return-images', availableBytes: null }; }
    }));
    snapshot.backup = { lastCompletedAt: null, ageSeconds: null };
    if (backupEvidencePath) {
        try {
            const evidence = JSON.parse(await fs.readFile(backupEvidencePath, 'utf8'));
            const timestamp = Date.parse(evidence.completedAt);
            if (Number.isFinite(timestamp) && timestamp <= Date.now()) snapshot.backup = {
                lastCompletedAt: new Date(timestamp).toISOString(), ageSeconds: Math.floor((Date.now() - timestamp) / 1000),
                restoreVerified: evidence.restoreVerified === true };
        } catch { /* Missing or invalid evidence is unknown, never a successful backup. */ }
    }
    return snapshot;
}

function operationsMetricsHandler(options) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.session?.role !== 'global_admin') return res.status(403).json({ error: 'Administratorrechte erforderlich.' });
        try { return res.json(await operationsSnapshot(options)); }
        catch (error) { log('error', 'operations.snapshot.failed', { error }); return res.status(503).json({ error: 'Betriebsdaten vorübergehend nicht verfügbar.' }); }
    };
}

module.exports = { actorReference, currentRequestId: () => context.getStore()?.requestId || null, log, redact, redactString, installConsoleRedaction, requestObservability, recordWorkerProgress,
    recordDbTimeout, operationsSnapshot, operationsMetricsHandler, setLogSink: value => { sink = value; } };
