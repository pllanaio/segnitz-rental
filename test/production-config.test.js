'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertSecurityEnvironment } = require('../config/security');
const { validateRuntimeConfig } = require('../config/runtimeConfig');

function validConfig(changes = {}) {
    return {
        NODE_ENV: 'test', TRUST_PROXY: '0', DB_HOST: '127.0.0.1', DB_NAME: 'config_test', DB_USER: 'fixture',
        SESSION_SECRET: 'unit-test-only-session-secret-long-enough', BASE_URL: 'http://127.0.0.1:3000',
        MOLLIE_TEST_MODE: '1', MAIL_DELIVERY_PAUSED: '1', ...changes
    };
}

for (const key of ['MOLLIE_TEST_MODE', 'DISABLE_EMAILS']) {
    test(`production rejects ${key} before any bootstrap or provider work`, () => {
        assert.throws(() => assertSecurityEnvironment({
            NODE_ENV: 'production', SESSION_SECRET: 'unit-test-only-session-secret-long-enough',
            [key]: '1'
        }), new RegExp(key));
    });
}

test('a deployment override cannot weaken Node production simulator isolation', () => {
    assert.throws(() => assertSecurityEnvironment({
        NODE_ENV: 'production', DEPLOYMENT_ENV: 'test',
        SESSION_SECRET: 'unit-test-only-session-secret-long-enough', MOLLIE_TEST_MODE: '1'
    }), /MOLLIE_TEST_MODE/);
});

test('production deployment also protects a development-mode Node process', () => {
    assert.throws(() => assertSecurityEnvironment({
        NODE_ENV: 'development', DEPLOYMENT_ENV: 'production',
        SESSION_SECRET: 'unit-test-only-session-secret-long-enough', DISABLE_EMAILS: '1'
    }), /DISABLE_EMAILS/);
});

test('isolated runtime accepts safe simulator configuration and freezes normalized settings', () => {
    const config = validateRuntimeConfig(validConfig());
    assert.equal(config.simulatedPayments, true);
    assert.equal(config.mailPaused, true);
    assert.equal(config.numbers.PORT, 3000);
    assert.equal(config.businessTimeZone, 'Europe/Berlin');
    assert.equal(Object.isFrozen(config.numbers), true);
});

test('runtime rejects malformed ports, unsafe URLs, missing credentials and unknown switches', () => {
    for (const [setting, value] of [
        ['PORT', '0'], ['DB_PORT', '3306oops'], ['GRAPH_REQUEST_TIMEOUT_MS', 'Infinity'],
        ['DB_QUERY_TIMEOUT_MS', '-2'], ['BASE_URL', 'https://name:secret@example.invalid'],
        ['BASE_URL', 'https://example.invalid/path'], ['MOLLIE_TEST_MODE', 'true'],
        ['MAIL_DELIVERY_PAUSED', 'yes'], ['DB_NAME', 'customer_production'],
        ['BUSINESS_TIME_ZONE', 'invalid-zone'], ['DB_USER', '']
    ]) assert.throws(() => validateRuntimeConfig(validConfig({ [setting]: value })));
});

test('production HTTPS, secrets and live integrations are checked without exposing values', () => {
    const production = validConfig({ NODE_ENV: 'production', MOLLIE_TEST_MODE: '0', DB_PW: 'fixture-secret',
        ADMIN_SETUP_TOKEN: 'fixture-setup-code-only-not-a-real-credential',
        BASE_URL: 'https://rental.example.invalid', MOLLIE_API_KEY: 'live_fixtureonly',
        LEGAL_TERMS_VERSION: 'fixture-1', LEGAL_PRIVACY_VERSION: 'fixture-1',
        LEGAL_TERMS_URL: '/legal/terms.html', LEGAL_PRIVACY_URL: '/legal/privacy.html',
        LEGAL_OPERATOR_URL: '/legal/operator.html' });
    assert.equal(validateRuntimeConfig(production).production, true);
    for (const changes of [
        { BASE_URL: 'http://rental.example.invalid' }, { MOLLIE_API_KEY: 'test_fixtureonly' },
        { DB_PW: '' }, { ADMIN_SETUP_TOKEN: '' }, { MAIL_DELIVERY_PAUSED: '0' }
    ]) assert.throws(() => validateRuntimeConfig({ ...production, ...changes }), error => {
        assert.equal(error.message.includes('fixture-secret'), false);
        assert.equal(error.message.includes('live_fixtureonly'), false);
        return true;
    });
});

test('a mail maintenance window still requires valid configuration when delivery resumes', () => {
    assert.throws(() => validateRuntimeConfig(validConfig({ MAIL_DELIVERY_PAUSED: '0' })), /MS_TENANT_ID/);
    const config = validateRuntimeConfig(validConfig({ MAIL_DELIVERY_PAUSED: '0',
        MS_TENANT_ID: 'fixture-tenant', MS_CLIENT_ID: 'fixture-client', MS_CLIENT_SECRET: 'fixture-secret',
        GRAPH_MAIL_USER: 'fixture@example.invalid' }));
    assert.equal(config.mailPaused, false);
});

test('provider timeout cannot outlive an outbox lease', () => {
    assert.throws(() => validateRuntimeConfig(validConfig({
        GRAPH_REQUEST_TIMEOUT_MS: '30000', EXTERNAL_EFFECT_LEASE_SECONDS: '60'
    })), /EXTERNAL_EFFECT_LEASE_SECONDS/);
});

test('operator document configuration rejects unsafe links and invalid versions', () => {
    for (const changes of [{ LEGAL_TERMS_URL: '//external.invalid' },
        { LEGAL_PRIVACY_URL: 'javascript:alert(1)' }, { LEGAL_OPERATOR_URL: '/legal/../secrets' },
        { LEGAL_TERMS_VERSION: 'x'.repeat(101) }]) {
        assert.throws(() => validateRuntimeConfig(validConfig(changes)), /LEGAL_/);
    }
});
