'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { addIsoCalendarDays, formatDateInTimeZone } = require('../utils/businessDate');
const browserDate = require('../public/js/date_utils');

test('liefert nachts das Berliner Kalenderdatum statt des vorherigen UTC-Tags', () => {
    assert.equal(
        formatDateInTimeZone(new Date('2026-03-28T23:30:00.000Z'), 'Europe/Berlin'),
        '2026-03-29'
    );
    assert.equal(
        formatDateInTimeZone(new Date('2026-10-24T22:30:00.000Z'), 'Europe/Berlin'),
        '2026-10-25'
    );
});

test('addiert reine Kalendertage stabil über Sommer- und Winterzeitwechsel', () => {
    for (const addDays of [addIsoCalendarDays, browserDate.addIsoCalendarDays]) {
        assert.equal(addDays('2026-03-28', 1), '2026-03-29');
        assert.equal(addDays('2026-03-29', 1), '2026-03-30');
        assert.equal(addDays('2026-10-25', 1), '2026-10-26');
    }
});

test('Frontendpfade laden den lokalen Datumshelper vor ihren Konfigurationen', () => {
    const publicRoot = path.resolve(__dirname, '../public');

    for (const [htmlFile, scriptFile] of [
        ['index.html', 'frontend_config.js'],
        ['backend.html', 'backend_config.js']
    ]) {
        const html = fs.readFileSync(path.join(publicRoot, htmlFile), 'utf8');
        assert.ok(html.indexOf('js/date_utils.js') < html.indexOf(`js/${scriptFile}`));
    }

    const frontend = fs.readFileSync(path.join(publicRoot, 'js/frontend_config.js'), 'utf8');
    const backend = fs.readFileSync(path.join(publicRoot, 'js/backend_config.js'), 'utf8');
    assert.doesNotMatch(frontend, /new Date\(\)\.toISOString\(\)/);
    assert.doesNotMatch(backend, /new Date\(\)\.toISOString\(\)/);
});
