'use strict';

const { getInstallationState } = require('./installationState');

if (getInstallationState() === 'starting') {
    throw new Error('Die Anwendung muss über server.js mit Datenbank-Bootstrap gestartet werden.');
}

module.exports = require('../config/db');
