'use strict';

require('dotenv').config();

const dbConfig = require('./config/db');
const { assertSecurityEnvironment } = require('./config/security');
const { initializeDatabase } = require('./database/bootstrap');

function logBootstrapResult(bootstrapResult) {
    if (bootstrapResult.databaseCreated) {
        console.log(`${new Date().toISOString()} - Datenbank ${dbConfig.database} wurde erstellt`);
    }

    if (bootstrapResult.appliedMigrations.length > 0) {
        console.log(
            `${new Date().toISOString()} - Automatische Migrationen angewendet: ` +
            bootstrapResult.appliedMigrations.join(', ')
        );
    }

    if (bootstrapResult.status !== 'setup_required') return;

    const setupUrl = process.env.BASE_URL
        ? `${process.env.BASE_URL.replace(/\/$/, '')}/setup.html`
        : '/setup.html';

    console.warn('************************************************************');
    console.warn('Segnitz Rental benötigt die Registrierung des ersten Admins.');
    console.warn(`Setup-Seite: ${setupUrl}`);

    if (bootstrapResult.setupTokenSource === 'generated') {
        console.warn(`Einmaliger Setup-Code: ${bootstrapResult.setupToken}`);
        console.warn('Der Code wird nach erfolgreicher Einrichtung ungültig.');
    } else if (bootstrapResult.setupTokenSource === 'environment') {
        console.warn('Als Setup-Code den Wert aus ADMIN_SETUP_TOKEN verwenden.');
    } else {
        console.warn(
            'Der Setup-Code wurde bereits erzeugt. Falls er nicht mehr vorliegt, ' +
            'ADMIN_SETUP_TOKEN setzen und den Container neu starten.'
        );
    }

    console.warn('************************************************************');
}

async function startServer() {
    assertSecurityEnvironment();
    const bootstrapResult = await initializeDatabase();
    logBootstrapResult(bootstrapResult);

    process.env.DB_PORT = String(dbConfig.port);
    require('./segnitz_rental');
}

if (require.main === module) {
    startServer().catch(error => {
        console.error('Serverstart wegen eines Bootstrap-Fehlers abgebrochen:', error);
        process.exitCode = 1;
    });
}

module.exports = {
    logBootstrapResult,
    startServer
};
