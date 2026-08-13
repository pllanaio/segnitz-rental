const mysql = require('mysql2/promise');

const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'Europe/Berlin';
const MYSQL_PATCH_MARKER = Symbol.for('segnitz.mysql.session-timezone');

function validateBusinessTimeZone(timeZone = BUSINESS_TIME_ZONE) {
    try {
        new Intl.DateTimeFormat('de-DE', { timeZone }).format(new Date());
    } catch {
        throw new Error(`Ungültige BUSINESS_TIME_ZONE: ${timeZone}`);
    }

    return timeZone;
}

function getBusinessUtcOffset(date = new Date(), timeZone = BUSINESS_TIME_ZONE) {
    validateBusinessTimeZone(timeZone);

    const offsetName = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'longOffset'
    }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value;

    if (offsetName === 'GMT') return '+00:00';

    const match = /^GMT([+-]\d{2}:\d{2})$/u.exec(offsetName || '');
    if (!match) {
        throw new Error(`UTC-Offset für BUSINESS_TIME_ZONE ${timeZone} konnte nicht bestimmt werden.`);
    }

    return match[1];
}

async function createTimeZoneAwareConnection(createConnection, config, date = new Date()) {
    const offset = getBusinessUtcOffset(date);
    const connectionConfig = config && typeof config === 'object'
        ? { ...config, timezone: offset }
        : config;
    const connection = await createConnection(connectionConfig);

    try {
        await connection.execute('SET SESSION time_zone = ?', [offset]);
    } catch (error) {
        await connection.end();
        throw error;
    }

    return connection;
}

function installSessionTimeZone() {
    if (mysql[MYSQL_PATCH_MARKER]) return;

    const createConnection = mysql.createConnection.bind(mysql);

    // mysql2 kennt IANA-Zonen nicht als Connection-Option und setzt seine
    // Client-Zeitzone außerdem nicht als MySQL-Sessionvariable. Die einmalige,
    // symbolmarkierte Kapselung stellt deshalb auch für bestehende Module sicher,
    // dass jede mysql2/promise-Connection den beim Öffnen gültigen Berlin-Offset
    // verwendet. Der Offset wird pro Connection neu berechnet (DST-Wechsel).
    mysql.createConnection = async function createBusinessTimeConnection(config, ...args) {
        return createTimeZoneAwareConnection(
            connectionConfig => createConnection(connectionConfig, ...args),
            config
        );
    };

    Object.defineProperty(mysql, MYSQL_PATCH_MARKER, {
        configurable: false,
        enumerable: false,
        value: true,
        writable: false
    });
}

validateBusinessTimeZone();
process.env.TZ = BUSINESS_TIME_ZONE;
installSessionTimeZone();

module.exports = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PW,
    database: process.env.DB_NAME,
    timezone: getBusinessUtcOffset()
};

Object.defineProperties(module.exports, {
    BUSINESS_TIME_ZONE: { enumerable: false, value: BUSINESS_TIME_ZONE },
    createTimeZoneAwareConnection: { enumerable: false, value: createTimeZoneAwareConnection },
    getBusinessUtcOffset: { enumerable: false, value: getBusinessUtcOffset },
    validateBusinessTimeZone: { enumerable: false, value: validateBusinessTimeZone }
});
