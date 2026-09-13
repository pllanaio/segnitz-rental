'use strict';

const { checkDatabaseReadiness } = require('../database/readiness');
const { getInstallationState } = require('../database/installationState');
const rateLimit = require('express-rate-limit');
const { createReadinessLimitOptions } = require('../middleware/requestLimits');

function registerHealthRoutes(app, { readiness = checkDatabaseReadiness, installationState = getInstallationState, environment = process.env } = {}) {
    app.get('/live', (req, res) => res.json({ status: 'alive', installation: installationState() }));
    const readinessOptions = createReadinessLimitOptions(environment);
    const readinessLimiter = rateLimit(readinessOptions);
    const ready = async (req, res) => {
        const installation = installationState();
        try {
            const result = await readiness();
            res.json({ status: installation === 'ready' ? 'ok' : 'setup_required', database: 'ready', schema: 'ready', installation, timeZone: result.sessionTimeZone });
        } catch (error) {
            // Public probes carry no session and disclose neither SQL nor credentials.
            res.status(503).json({ status: 'unavailable', database: 'unavailable', schema: 'unknown', installation });
        }
    };
    app.get('/ready', readinessLimiter, ready);
    app.get('/health', readinessLimiter, ready);
    return () => readinessOptions.store.shutdown();
}

module.exports = { registerHealthRoutes };
