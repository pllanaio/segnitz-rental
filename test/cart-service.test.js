'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
    getCartSessionKey,
    getOrCreateActiveCart
} = require('../services/cartService');

test('parallele erste Requests derselben Session erhalten denselben pseudonymen Cart-Key', async () => {
    const sessionID = 'hoch-entropische-rohe-session-id';
    const requests = [
        { sessionID, session: {} },
        { sessionID, session: {} }
    ];

    const [firstKey, secondKey] = await Promise.all(
        requests.map(request => Promise.resolve().then(() => getCartSessionKey(request)))
    );

    assert.equal(firstKey, secondKey);
    assert.match(firstKey, /^guest:v1:[a-f0-9]{64}$/);
    assert.ok(firstKey.length <= 255);
    assert.ok(!firstKey.includes(sessionID));
    assert.equal(requests[0].session.cartKey, firstKey);
    assert.equal(requests[1].session.cartKey, firstKey);
});

test('verschiedene Sessions erhalten verschiedene Cart-Keys', () => {
    const firstKey = getCartSessionKey({ sessionID: 'session-a', session: {} });
    const secondKey = getCartSessionKey({ sessionID: 'session-b', session: {} });

    assert.notEqual(firstKey, secondKey);
});

test('parallele Cart-Erzeugung konvergiert über den Unique-Key auf denselben Datensatz', async () => {
    const carts = new Map();
    const insertedKeys = [];
    let initialLookups = 0;
    let releaseInitialLookups;
    const bothInitialLookupsReached = new Promise(resolve => {
        releaseInitialLookups = resolve;
    });
    const connection = {
        async execute(sql, params) {
            if (/FROM rental_carts/.test(sql)) {
                const existingCartId = carts.get(params[0]) || null;
                initialLookups += 1;

                if (initialLookups <= 2) {
                    if (initialLookups === 2) releaseInitialLookups();
                    await bothInitialLookupsReached;
                }

                return [existingCartId ? [{ id: existingCartId }] : []];
            }

            if (/INSERT INTO rental_carts/.test(sql)) {
                const sessionKey = params[0];
                insertedKeys.push(sessionKey);

                if (carts.has(sessionKey)) {
                    const error = new Error('duplicate');
                    error.code = 'ER_DUP_ENTRY';
                    throw error;
                }

                carts.set(sessionKey, 91);
                return [{ insertId: 91 }];
            }

            throw new Error(`Unerwartetes SQL im Test: ${sql}`);
        }
    };
    const sessionID = 'eine-gemeinsame-express-session';

    const cartIds = await Promise.all([
        getOrCreateActiveCart(connection, { sessionID, session: {} }),
        getOrCreateActiveCart(connection, { sessionID, session: {} })
    ]);

    assert.deepEqual(cartIds, [91, 91]);
    assert.equal(carts.size, 1);
    assert.equal(new Set(insertedKeys).size, 1);
});

test('bestehende Cart-Keys bleiben für laufende Sessions und den Login-Merge erhalten', () => {
    const legacyKey = 'bestehender-cart-key';
    const request = {
        sessionID: 'neue-ableitung-darf-nicht-greifen',
        session: { cartKey: legacyKey }
    };

    assert.equal(getCartSessionKey(request), legacyKey);
    assert.equal(request.session.cartKey, legacyKey);
});

test('Cart-Key-Erzeugung schlägt ohne gültige Express-Session-ID geschlossen fehl', () => {
    assert.throws(
        () => getCartSessionKey({ session: {} }),
        /nicht ohne Session-ID/
    );
});
