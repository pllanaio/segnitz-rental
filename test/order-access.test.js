'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
    ORDER_ACCESS_COOKIE,
    createOrderAccessGrant,
    hasValidOrderAccessCookie,
    hashOrderAccessToken,
    setOrderAccessCookie
} = require('../services/orderAccessService');

test('erstellt einen zufälligen Order-Access-Token und speichert nur dessen SHA-256-Hash', () => {
    const now = new Date('2026-08-13T12:00:00.000Z');
    const first = createOrderAccessGrant(now);
    const second = createOrderAccessGrant(now);

    assert.notEqual(first.token, second.token);
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(first.tokenHash, hashOrderAccessToken(first.token));
    assert.notEqual(first.tokenHash, first.token);
    assert.equal(first.expiresAt.toISOString(), '2026-09-12T12:00:00.000Z');
});

test('prüft Order-Access-Cookies zeitkonstant und lehnt falsche oder abgelaufene Werte ab', () => {
    const now = new Date('2026-08-13T12:00:00.000Z');
    const grant = createOrderAccessGrant(now);
    const order = {
        guestAccessTokenHash: grant.tokenHash,
        guestAccessTokenExpiresAt: grant.expiresAt
    };

    assert.equal(hasValidOrderAccessCookie({
        headers: { cookie: `${ORDER_ACCESS_COOKIE}=${grant.token}` }
    }, order, now), true);
    assert.equal(hasValidOrderAccessCookie({
        headers: { cookie: `${ORDER_ACCESS_COOKIE}=falsch` }
    }, order, now), false);
    assert.equal(hasValidOrderAccessCookie({
        headers: { cookie: `${ORDER_ACCESS_COOKIE}=${grant.token}` }
    }, order, new Date(grant.expiresAt.getTime() + 1)), false);
});

test('setzt das Token ausschließlich als HttpOnly-Cookie auf dem bestellspezifischen Pfad', () => {
    const grant = createOrderAccessGrant();
    let captured;
    const response = {
        cookie(name, value, options) {
            captured = { name, value, options };
        }
    };

    setOrderAccessCookie(response, 42, grant);

    assert.equal(captured.name, ORDER_ACCESS_COOKIE);
    assert.equal(captured.value, grant.token);
    assert.equal(captured.options.httpOnly, true);
    assert.equal(captured.options.sameSite, 'lax');
    assert.equal(captured.options.path, '/orders/42');
    assert.equal(Object.hasOwn(captured.options, 'domain'), false);
});
