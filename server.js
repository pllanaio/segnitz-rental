'use strict';

require('dotenv').config();

const dbConfig = require('./config/db');
const mysql = require('mysql2/promise');
const { assertSecurityEnvironment } = require('./config/security');
const { initializeDatabase } = require('./database/bootstrap');
const { runCoordinatedDatabaseCleanup } = require('./utils/cleanup');
const { primeSchemaReadiness } = require('./database/readiness');
const {
    startExternalEffectsWorker,
    stopExternalEffectsWorker
} = require('./services/externalEffectsWorker');

let shutdownPromise;
let applicationRuntime = null;

async function stopRuntime(signal = 'shutdown') {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
        console.log(`${new Date().toISOString()} - ${signal}: Hintergrunddienste werden beendet`);
        if (applicationRuntime) await applicationRuntime.stopApplication();
        await stopExternalEffectsWorker();
    })();

    return shutdownPromise;
}

function installShutdownHandlers() {
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            const hardDeadline = setTimeout(() => {
                console.error('Shutdown-Deadline überschritten; Prozess wird beendet.');
                process.exit(1);
            }, Number(process.env.APP_SHUTDOWN_HARD_DEADLINE_MS || 25000));

            stopRuntime(signal)
                .then(() => {
                    clearTimeout(hardDeadline);
                    process.exit(0);
                })
                .catch(error => {
                    clearTimeout(hardDeadline);
                    console.error('Geordneter Shutdown fehlgeschlagen:', error);
                    process.exit(1);
                });
        });
    }
}

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
    primeSchemaReadiness(bootstrapResult.schema, bootstrapResult.migrationManifest);
    logBootstrapResult(bootstrapResult);

    const cleanupConnection = await mysql.createConnection(dbConfig);

    try {
        const cleanup = await runCoordinatedDatabaseCleanup(cleanupConnection, {
            lockTimeoutSeconds: 10
        });

        if (cleanup.acquired) {
            console.log(`${new Date().toISOString()} - Koordiniertes Startup-Cleanup abgeschlossen`);
        } else {
            console.log(`${new Date().toISOString()} - Startup-Cleanup läuft bereits in einer anderen Replik`);
        }
    } finally {
        await cleanupConnection.end();
    }

    process.env.DB_PORT = String(dbConfig.port);
    applicationRuntime = require('./segnitz_rental');
    await startExternalEffectsWorker();
    installShutdownHandlers();
}

if (require.main === module) {
    startServer().catch(error => {
        console.error('Serverstart wegen eines Bootstrap-Fehlers abgebrochen:', error);
        process.exitCode = 1;
    });
}

module.exports = {
    logBootstrapResult,
    stopRuntime,
    startServer
};
