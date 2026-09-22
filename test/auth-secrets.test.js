'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashAuthToken, isAuthToken } = require('../services/authTokenService');
const { isValidPassword, PASSWORD_HASH_ROUNDS } = require('../utils/passwordPolicy');
const { redactSecrets } = require('../utils/redaction');

test('auth tokens have a non-reversible domain-separated storage representation', () => {
    const token = 'ab'.repeat(32);
    assert.equal(isAuthToken(token), true);
    assert.equal(isAuthToken(hashAuthToken(token)), false);
    assert.match(hashAuthToken(token), /^sha256:[a-f0-9]{64}$/u);
    assert.notEqual(hashAuthToken(token), token);
    assert.equal(hashAuthToken(token), hashAuthToken(token));
});

test('admin reset, change and setup policy cannot be weaker than initial setup', () => {
    assert.equal(isValidPassword('klein1!a', 'user'), true);
    for (const role of ['global_admin', 'bearbeiter']) {
        assert.equal(isValidPassword('klein1!a', role), false);
        assert.equal(isValidPassword('SicheresPasswort1!', role), true);
        assert.equal(isValidPassword(`Aa1!${'ä'.repeat(35)}`, role), false);
    }
    assert.equal(PASSWORD_HASH_ROUNDS, 12);
});

test('redaction removes credentials from operation keys, URLs, errors and structured metadata', () => {
    const token = 'ba'.repeat(32);
    const result = redactSecrets({ operation: `mail-password-reset-${token}`, error: `resetToken=${token} token=${token}`, password: 'a-secret', nested: { authorization: 'Bearer usable', signature_data_url: 'data:image/png;base64,usable' } });
    const serialized = JSON.stringify(result);
    for (const secret of [token, 'a-secret', 'Bearer usable', 'base64,usable']) assert.equal(serialized.includes(secret), false);
});
