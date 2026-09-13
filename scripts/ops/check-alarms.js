#!/usr/bin/env node
'use strict';
const fs = require('node:fs');

function evaluateAlarms(snapshot, previous, config, now = Date.now()) {
    for (const key of ['outboxBacklogMax', 'outboxMaxAgeSeconds', 'workerMaxIdleSeconds', 'storageMinFreeBytes', 'httpMinRequests', 'httpErrorRatioMax', 'httpSlowRatioMax', 'paymentMaxAgeSeconds']) {
        if (!Number.isFinite(config[key]) || config[key] < 0) throw new Error('Missing alarm threshold');
    }
    const alarms = [];
    const add = (code, value) => alarms.push({ code, value });
    if (!Array.isArray(snapshot.outbox) || !Array.isArray(snapshot.payments) || !snapshot.dbPool) add('metrics_incomplete', null);
    for (const payment of snapshot.payments || []) {
        if (payment.status === 'charged_back') add('payment_dispute', Number(payment.count));
        else if (payment.oldestSeconds > config.paymentMaxAgeSeconds) add('payment_or_refund_stale', Number(payment.count));
    }
    if (!config.targetRef) add('alarm_target_unconfigured', null);
    if (!Number.isFinite(config.backupMaxAgeSeconds) || config.backupMaxAgeSeconds <= 0) add('backup_rpo_unconfigured', null);
    if (snapshot.backup?.ageSeconds == null) add('backup_evidence_missing', null);
    else if (snapshot.backup.ageSeconds > config.backupMaxAgeSeconds) add('backup_stale', snapshot.backup.ageSeconds);
    if (!snapshot.backup?.restoreVerified) add('restore_not_verified', null);
    const backlog = (snapshot.outbox || []).filter(row => ['pending', 'retry', 'processing'].includes(row.status));
    const count = backlog.reduce((sum, row) => sum + Number(row.count), 0);
    if (count > config.outboxBacklogMax) add('outbox_backlog', count);
    for (const row of backlog) if (row.oldestSeconds > config.outboxMaxAgeSeconds) add('outbox_old', row.oldestSeconds);
    const dead = (snapshot.outbox || []).find(row => row.status === 'dead');
    if (Number(dead?.count) > 0) add('outbox_dead', Number(dead.count));
    const workerAge = (now - Date.parse(snapshot.workerLastProgressAt)) / 1000;
    if (count > 0 && (!Number.isFinite(workerAge) || workerAge > config.workerMaxIdleSeconds)) add('worker_stalled', Number.isFinite(workerAge) ? workerAge : null);
    for (const volume of snapshot.storage || []) if (volume.availableBytes == null || volume.availableBytes < config.storageMinFreeBytes) add('storage_low_or_unknown', volume.volume);
    if (Number(snapshot.dbPool?.quarantined) > 0) add('db_quarantined', Number(snapshot.dbPool.quarantined));
    if (previous && previous.startedAt === snapshot.startedAt) {
        const requests = snapshot.requests - previous.requests;
        const failures = snapshot.errors - previous.errors;
        if (requests >= config.httpMinRequests && failures / requests > config.httpErrorRatioMax) add('http_error_ratio', failures / requests);
        for (const counter of ['acquireTimeouts', 'queryTimeouts', 'transactionTimeouts', 'rejected', 'cancellationFailures']) {
            const delta = Number(snapshot.dbPool?.[counter] || 0) - Number(previous.dbPool?.[counter] || 0);
            if (delta > 0) add(`db_${counter}`, delta);
        }
        const total = snapshot.latencyBucketsMs?.infinity - previous.latencyBucketsMs?.infinity;
        const slow = total - (snapshot.latencyBucketsMs?.[1000] - previous.latencyBucketsMs?.[1000]);
        if (total >= config.httpMinRequests && slow / total > config.httpSlowRatioMax) add('http_slow_ratio', slow / total);
    }
    return { sampledAt: snapshot.sampledAt, state: alarms.length ? 'alert' : 'ok', alarms };
}

if (require.main === module) {
    try {
        const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
        const snapshot = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
        const previous = process.argv[4] ? JSON.parse(fs.readFileSync(process.argv[4], 'utf8')) : null;
        const result = evaluateAlarms(snapshot, previous, config);
        console.log(JSON.stringify(result));
        process.exitCode = result.state === 'ok' ? 0 : 2;
    } catch { console.error('Alarm evaluation failed: invalid or missing input.'); process.exitCode = 1; }
}
module.exports = { evaluateAlarms };
