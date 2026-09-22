'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

test('Profil lädt seine Datumsabhängigkeit und rendert Bewertungen mit UTC-Zeit und sicherem Text', () => {
    const html = fs.readFileSync('public/profile.html', 'utf8');
    const context = vm.createContext({});
    context.window = context;
    // Execute exactly the relevant dependencies declared by the actual page.
    for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gu)) {
        if (!/\/(?:safe_html|date_utils)\.js$/u.test(match[1])) continue;
        vm.runInContext(fs.readFileSync(path.join('public', match[1].replace(/^\//u, '')), 'utf8'), context);
    }
    const source = fs.readFileSync('public/js/profile_config.js', 'utf8');
    const start = source.indexOf('function renderReviewCard(');
    const end = source.indexOf('\nfunction renderMyOrderItemCard(', start);
    vm.runInContext(source.slice(start, end), context);
    const payload = '<button class="xss-probe">Nicht ausführen</button>';
    const rendered = context.renderReviewCard({ id: 1, title: 'Produkt', review: { rating: 5, reviewText: payload, createdAt: '2026-09-13T10:00:00Z' } }, 1);
    assert.match(rendered, /12:00/u);
    assert.match(rendered, /&lt;button/u);
    assert.doesNotMatch(rendered, /<button class="xss-probe"/u);
    assert.match(context.renderReviewCard({ id: 1, review: { rating: 5, reviewText: payload, createdAt: payload } }, 1), /&lt;button/u);
});
