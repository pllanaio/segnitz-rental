'use strict';

const { MemoryStore } = require('express-rate-limit');
const { numberSetting } = require('../config/runtimeConfig');

function rejectLimitedRequest(req, res, next, options) {
    res.set('Cache-Control', 'no-store');
    return res.status(options.statusCode).json(options.message);
}

function createRequestLimitOptions(environment = process.env) {
    const windowMs = numberSetting(environment, 'HTTP_RATE_LIMIT_WINDOW_MS');
    const globalLimit = numberSetting(environment, 'HTTP_RATE_LIMIT_GLOBAL_MAX');
    const clientLimit = numberSetting(environment, 'HTTP_RATE_LIMIT_MAX');
    const globalStore = new MemoryStore();
    const clientStore = new MemoryStore();
    const common = { windowMs, standardHeaders: 'draft-8', legacyHeaders: false,
        handler: rejectLimitedRequest, statusCode: 429,
        message: { error: 'Zu viele Anfragen. Bitte nach der angegebenen Wartezeit erneut versuchen.', code: 'REQUEST_RATE_LIMITED' } };
    return {
        // Mount this constant-key limiter FIRST. Apart from bounding admitted
        // work it bounds new client keys in the following in-memory store.
        global: { ...common, limit: globalLimit, keyGenerator: () => 'application',
            identifier: 'application', requestPropertyName: 'globalRequestRateLimit', store: globalStore },
        // express-rate-limit uses Express req.ip and its IPv6 /56 grouping.
        // Express has already applied the explicitly configured proxy policy.
        client: { ...common, limit: clientLimit, ipv6Subnet: 56,
            identifier: 'client', requestPropertyName: 'clientRequestRateLimit', store: clientStore },
        shutdown() { globalStore.shutdown(); clientStore.shutdown(); }
    };
}

function createReadinessLimitOptions(environment = process.env) {
    return { windowMs: 60000, limit: numberSetting(environment, 'READINESS_RATE_LIMIT_MAX'),
        keyGenerator: () => 'readiness', store: new MemoryStore(),
        identifier: 'readiness', requestPropertyName: 'readinessRateLimit',
        standardHeaders: 'draft-8', legacyHeaders: false, handler: rejectLimitedRequest,
        statusCode: 503,
        message: { status: 'unavailable', error: 'Die Bereitschaftsprüfung ist vorübergehend ausgelastet.', code: 'READINESS_RATE_LIMITED' } };
}

module.exports = { createRequestLimitOptions, createReadinessLimitOptions };
