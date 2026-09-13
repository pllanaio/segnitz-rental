'use strict';

const { assertSecurityEnvironment, isProduction } = require('./security');
const { parseTrustProxy } = require('./proxy');

// Validation deliberately reports setting names, never their supplied values.
// Keep technical timeout values bounded instead of silently clamping typos.
const NUMBER_SETTINGS = Object.freeze({
    PORT: [3000, 1, 65535], DB_PORT: [3306, 1, 65535],
    GRAPH_REQUEST_TIMEOUT_MS: [10000, 1000, 30000],
    MOLLIE_REQUEST_TIMEOUT_MS: [15000, 1000, 30000],
    CLEANUP_INTERVAL_MS: [60000, 1000, 3600000],
    PAYMENT_RECONCILIATION_BATCH_SIZE: [10, 1, 100],
    PAYMENT_RECONCILIATION_INTERVAL_MS: [60000, 1000, 3600000],
    EXTERNAL_EFFECT_INTERVAL_MS: [1000, 250, 60000],
    EXTERNAL_EFFECT_BATCH_SIZE: [20, 1, 100],
    EXTERNAL_EFFECT_LEASE_SECONDS: [60, 31, 3600],
    EXTERNAL_EFFECT_SUCCEEDED_RETENTION_DAYS: [30, 1, 3650],
    EXTERNAL_EFFECT_DEAD_RETENTION_DAYS: [90, 1, 3650],
    EXTERNAL_EFFECT_SHUTDOWN_GRACE_MS: [8000, 1000, 60000],
    APP_SHUTDOWN_HARD_DEADLINE_MS: [25000, 1000, 120000],
    APP_HTTP_SHUTDOWN_GRACE_MS: [8000, 100, 60000],
    APP_CLEANUP_SHUTDOWN_GRACE_MS: [5000, 100, 60000],
    APP_RESOURCE_SHUTDOWN_GRACE_MS: [3000, 100, 60000],
    DB_CONNECTION_LIMIT: [12, 2, 100], DB_QUEUE_LIMIT: [50, 0, 1000],
    DB_ACQUIRE_TIMEOUT_MS: [2000, 50, 60000],
    DB_QUERY_TIMEOUT_MS: [5000, 50, 60000],
    DB_TRANSACTION_TIMEOUT_MS: [15000, 100, 120000],
    DB_MIGRATION_TIMEOUT_MS: [120000, 1000, 900000],
    DB_CONNECT_TIMEOUT_MS: [3000, 100, 60000],
    DB_READINESS_TIMEOUT_MS: [1500, 50, 10000]
});

function requireValue(environment, name) {
    if (typeof environment[name] !== 'string' || !environment[name].trim()) {
        throw new Error(`${name} fehlt in der Laufzeitkonfiguration.`);
    }
    return environment[name];
}

function booleanSetting(environment, name) {
    const value = environment[name];
    if (value !== undefined && value !== '' && value !== '0' && value !== '1') {
        throw new Error(`${name} muss 0 oder 1 sein.`);
    }
    return value === '1';
}

function validateDocumentLink(value, name) {
    if (/^\/(?!\/)/u.test(value) && !/[\\\s?#]/u.test(value) && !value.split('/').includes('..')) return;
    try {
        const url = new URL(value);
        if (url.protocol === 'https:' && !url.username && !url.password) return;
    } catch { /* Fall through to a value-free configuration error. */ }
    throw new Error(`${name} muss ein lokaler öffentlicher Pfad oder eine HTTPS-URL sein.`);
}

function validateRuntimeConfig(environment = process.env) {
    assertSecurityEnvironment(environment);
    const production = isProduction(environment);
    const trustProxy = parseTrustProxy(environment);
    if (environment.NODE_ENV && !['development', 'test', 'production'].includes(environment.NODE_ENV)) {
        throw new Error('NODE_ENV muss development, test oder production sein.');
    }
    if (environment.DEPLOYMENT_ENV && !['development', 'test', 'staging', 'production'].includes(environment.DEPLOYMENT_ENV)) {
        throw new Error('DEPLOYMENT_ENV muss development, test, staging oder production sein.');
    }

    const numbers = {};
    for (const [name, [fallback, min, max]] of Object.entries(NUMBER_SETTINGS)) {
        const raw = environment[name];
        const value = raw === undefined ? fallback : Number(raw);
        if ((raw !== undefined && !/^\d+$/u.test(raw)) || !Number.isSafeInteger(value) || value < min || value > max) {
            throw new Error(`${name} muss eine Ganzzahl zwischen ${min} und ${max} sein.`);
        }
        numbers[name] = value;
    }
    for (const name of ['DISABLE_PERIODIC_CLEANUP', 'MOLLIE_TEST_MODE', 'DISABLE_EMAILS', 'MAIL_DELIVERY_PAUSED', 'DB_TLS', 'DB_LEGACY_WRITERS_STOPPED', 'SIGNATURE_IMAGE_UPLOAD_ENABLED', 'DISABLE_PAYMENT_RECONCILIATION']) {
        booleanSetting(environment, name);
    }

    for (const name of ['DB_HOST', 'DB_USER', 'DB_NAME', 'SESSION_SECRET', 'BASE_URL']) requireValue(environment, name);
    if (environment.DB_MIGRATION_USER !== undefined || environment.DB_MIGRATION_PW !== undefined) {
        requireValue(environment, 'DB_MIGRATION_USER');
        requireValue(environment, 'DB_MIGRATION_PW');
    }
    if (!/^[A-Za-z0-9_]+$/u.test(environment.DB_NAME)) throw new Error('DB_NAME enthält unzulässige Zeichen.');
    if (production) {
        requireValue(environment, 'DB_PW');
        requireValue(environment, 'ADMIN_SETUP_TOKEN');
    }
    for (const name of ['LEGAL_TERMS_VERSION', 'LEGAL_PRIVACY_VERSION']) {
        if (production) requireValue(environment, name);
        if (environment[name] && (environment[name].length > 100 || /[\x00-\x1f\x7f]/u.test(environment[name]))) {
            throw new Error(`${name} darf höchstens 100 Zeichen ohne Steuerzeichen enthalten.`);
        }
    }
    for (const name of ['LEGAL_TERMS_URL', 'LEGAL_PRIVACY_URL', 'LEGAL_OPERATOR_URL']) {
        if (production) requireValue(environment, name);
        if (environment[name]) validateDocumentLink(environment[name], name);
    }
    if (environment.ADMIN_SETUP_TOKEN && environment.ADMIN_SETUP_TOKEN.length < 32) {
        throw new Error('ADMIN_SETUP_TOKEN muss mindestens 32 Zeichen lang sein.');
    }

    let baseUrl;
    try { baseUrl = new URL(environment.BASE_URL); } catch { throw new Error('BASE_URL muss eine gültige absolute URL sein.'); }
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password ||
        baseUrl.search || baseUrl.hash || (baseUrl.pathname !== '/' && baseUrl.pathname !== '')) {
        throw new Error('BASE_URL muss einen HTTP(S)-Origin ohne Zugangsdaten, Pfad, Query oder Fragment enthalten.');
    }
    if (production && baseUrl.protocol !== 'https:') throw new Error('BASE_URL muss in Produktion HTTPS verwenden.');

    const timeZone = environment.BUSINESS_TIME_ZONE || 'Europe/Berlin';
    try { new Intl.DateTimeFormat('de-DE', { timeZone }).format(new Date()); }
    catch { throw new Error('BUSINESS_TIME_ZONE muss eine gültige IANA-Zeitzone sein.'); }

    const simulatedPayments = booleanSetting(environment, 'MOLLIE_TEST_MODE');
    if (simulatedPayments && !/(^|_)(test|ci)(_|$)/iu.test(environment.DB_NAME)) {
        throw new Error('MOLLIE_TEST_MODE erfordert eine isolierte DB_NAME mit test- oder ci-Segment.');
    }
    if (!simulatedPayments) {
        const key = requireValue(environment, 'MOLLIE_API_KEY');
        if (!/^(test|live)_[A-Za-z0-9]+$/u.test(key)) throw new Error('MOLLIE_API_KEY muss ein gültig formatiertes API-Key-Präfix besitzen.');
        if (production && !key.startsWith('live_')) throw new Error('MOLLIE_API_KEY muss in Produktion ein Live-Key sein.');
    }

    const mailPaused = booleanSetting(environment, 'MAIL_DELIVERY_PAUSED') || booleanSetting(environment, 'DISABLE_EMAILS');
    if (!mailPaused) {
        for (const name of ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'GRAPH_MAIL_USER']) requireValue(environment, name);
        for (const name of ['MS_TENANT_ID', 'MS_CLIENT_ID']) {
            if (!/^[A-Za-z0-9.-]+$/u.test(environment[name])) throw new Error(`${name} enthält unzulässige Zeichen.`);
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(environment.GRAPH_MAIL_USER)) {
            throw new Error('GRAPH_MAIL_USER muss eine E-Mail-Adresse sein.');
        }
    }
    if (booleanSetting(environment, 'DB_TLS')) requireValue(environment, 'DB_TLS_CA_FILE');
    if (environment.DB_LEGACY_DATETIME_MODE && !['berlin', 'utc'].includes(environment.DB_LEGACY_DATETIME_MODE)) {
        throw new Error('DB_LEGACY_DATETIME_MODE muss berlin oder utc sein.');
    }
    const effectCompletionBudget = Math.max(numbers.MOLLIE_REQUEST_TIMEOUT_MS, numbers.GRAPH_REQUEST_TIMEOUT_MS * 2)
        + numbers.DB_ACQUIRE_TIMEOUT_MS + numbers.DB_TRANSACTION_TIMEOUT_MS + 1000;
    if (numbers.EXTERNAL_EFFECT_LEASE_SECONDS * 1000 <= effectCompletionBudget) {
        throw new Error('EXTERNAL_EFFECT_LEASE_SECONDS muss Providerdauer und lokale Abschlussfrist übersteigen.');
    }
    return Object.freeze({ production, trustProxy, baseUrl: baseUrl.origin, businessTimeZone: timeZone,
        simulatedPayments, mailPaused, numbers: Object.freeze(numbers) });
}

module.exports = { NUMBER_SETTINGS, validateRuntimeConfig };
