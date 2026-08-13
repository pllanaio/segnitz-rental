'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { escapeHtml } = require('../public/js/safe_html');

const root = path.resolve(__dirname, '..');

test('escapeHtml neutralisiert Text-, Attribut- und delegierte Button-Payloads', () => {
    const payload = '<button data-backend-action="mark-item-picked-up" data-item-id=`771`>' +
        "O'Reilly & Partner</button>";

    assert.equal(
        escapeHtml(payload),
        '&lt;button data-backend-action=&quot;mark-item-picked-up&quot; data-item-id=&#96;771&#96;&gt;' +
            'O&#39;Reilly &amp; Partner&lt;/button&gt;'
    );
    assert.doesNotMatch(escapeHtml(payload), /<button|data-item-id=`/);
});

test('escapeHtml behandelt leere Werte und typische Attributausbrüche deterministisch', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(
        escapeHtml('\"><img src=x onerror="alert(1)">'),
        '&quot;&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
    );
});

test('alle betroffenen Seiten laden die zentrale Escape-Hilfe vor ihren Renderern', () => {
    const pages = [
        ['public/index.html', 'js/frontend_config.js'],
        ['public/backend.html', 'js/backend_config.js'],
        ['public/profile.html', 'js/profile_config.js']
    ];

    for (const [pagePath, renderer] of pages) {
        const source = fs.readFileSync(path.join(root, pagePath), 'utf8');
        assert.ok(source.indexOf('js/safe_html.js') > -1, pagePath);
        assert.ok(source.indexOf('js/safe_html.js') < source.indexOf(renderer), pagePath);
    }
});

test('globale API-Hinweise werden als Text statt als HTML gerendert', () => {
    const source = fs.readFileSync(path.join(root, 'public/js/alerts.js'), 'utf8');

    assert.match(source, /messageNode\.textContent = String\(message/);
    assert.doesNotMatch(source, /alertBox\.innerHTML/);
});

test('öffentliche Review-Abfrage enthält keine Kunden-E-Mail oder Bestell-ID', () => {
    const source = fs.readFileSync(path.join(root, 'routes/productRoutes.js'), 'utf8');
    const routeStart = source.indexOf("router.get('/products/:id/reviews'");
    const routeEnd = source.indexOf("router.post('/products/:id/reviews'", routeStart);
    const publicReviewRoute = source.slice(routeStart, routeEnd);
    const publicProjection = publicReviewRoute.match(/`SELECT([\s\S]*?)FROM product_reviews/)?.[1] || '';

    assert.ok(routeStart > -1 && routeEnd > routeStart);
    assert.doesNotMatch(publicProjection, /userEmail|user_email|orderId|order_id/);
    assert.doesNotMatch(publicProjection, /AS firstName|AS lastName/);
    assert.match(publicProjection, /AS displayName/);
    assert.match(publicReviewRoute, /review_text AS reviewText/);
});

test('rollenabhängige Produktlisten dürfen nicht von gemeinsam genutzten Caches vermischt werden', () => {
    const source = fs.readFileSync(path.join(root, 'routes/productRoutes.js'), 'utf8');
    const routeStart = source.indexOf("router.get('/products'");
    const routeEnd = source.indexOf("router.get('/products/:id/availability'", routeStart);
    const productsRoute = source.slice(routeStart, routeEnd);

    assert.ok(routeStart > -1 && routeEnd > routeStart);
    assert.match(productsRoute, /'Cache-Control': 'private, no-store'/);
    assert.match(productsRoute, /Vary: 'Cookie'/);
    assert.match(productsRoute, /req\.session\?\.role === 'global_admin'/);
});
