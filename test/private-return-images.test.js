'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../segnitz_rental.js'), 'utf8');

test('shadows private return images before the public static middleware', () => {
    const protectedRoute = source.indexOf("app.get('/img/returns/:filename'");
    const denyFallback = source.indexOf("app.use('/img/returns'", protectedRoute);
    const staticMiddleware = source.indexOf('app.use(express.static("public"))');

    assert.ok(protectedRoute > -1);
    assert.ok(denyFallback > protectedRoute);
    assert.ok(staticMiddleware > denyFallback);
});

test('authorizes return images by admin role or normalized order-owner email', () => {
    const routeStart = source.indexOf("app.get('/img/returns/:filename'");
    const routeEnd = source.indexOf("app.use('/img/returns'", routeStart);
    const route = source.slice(routeStart, routeEnd);

    assert.match(route, /req\.session\.role === 'global_admin'/);
    assert.match(route, /normalizeEmail\(req\.session\.user\)/);
    assert.match(route, /normalizeEmail\(image\.customerEmail\)/);
    assert.match(route, /RETURN_IMAGE_DIRECTORY/);
    assert.match(route, /return res\.sendStatus\(404\)/);
    assert.doesNotMatch(route, /\bnext\s*\(/);
});

test('marks sensitive account, admin, payment and image responses as non-cacheable', () => {
    assert.match(source, /'Cache-Control': 'private, no-store'/);
    assert.match(source, /pathname\.startsWith\('\/img\/returns\/'\)/);
    assert.match(source, /delete req\.headers\['if-none-match'\]/);
});
