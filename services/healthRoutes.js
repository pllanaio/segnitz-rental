'use strict';

const { checkDatabaseReadiness } = require('../database/readiness');
const { getInstallationState } = require('../database/installationState');

function registerHealthRoutes(app, { readiness = checkDatabaseReadiness, installationState = getInstallationState } = {}) {
    app.get('/live', (req, res) => res.json({ status: 'alive', installation: installationState() }));
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
    app.get('/ready', ready);
    app.get('/health', ready);
}

module.exports = { registerHealthRoutes };
