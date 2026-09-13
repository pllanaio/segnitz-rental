'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { acceptedDocumentSnapshot, safeDocumentUrl } = require('../services/legalDocumentService');
const env = { LEGAL_TERMS_VERSION: 'test-terms-v1', LEGAL_TERMS_URL: '/terms', LEGAL_PRIVACY_VERSION: 'test-privacy-v1', LEGAL_PRIVACY_URL: '/privacy', LEGAL_OPERATOR_URL: '/operator' };
test('fehlende Freigabe oder veraltete Einwilligung verhindert Abschluss', () => {
    assert.equal(acceptedDocumentSnapshot({}, {}).status, 503);
    assert.equal(acceptedDocumentSnapshot({ termsVersion: 'v0' }, env).status, 409);
});
test('akzeptierte URLs und Versionen werden mit UTC-Zeitpunkt unveränderlich gesnapshottet', () => {
    const result = acceptedDocumentSnapshot({ termsVersion: 'test-terms-v1', privacyVersion: 'test-privacy-v1' }, env, new Date('2026-09-13T12:00:00Z'));
    env.LEGAL_TERMS_VERSION = 'test-terms-v2';
    assert.equal(result.snapshot.terms.version, 'test-terms-v1');
    assert.equal(result.snapshot.acceptedAt, '2026-09-13T12:00:00.000Z');
});
test('Dokumentlinks erlauben weder Skript- noch Protokollrelative URLs', () => {
    for (const url of ['javascript:alert(1)', '//evil.example', '/\\evil.example', 'https://user:password@example.com']) assert.equal(safeDocumentUrl(url), null);
});
