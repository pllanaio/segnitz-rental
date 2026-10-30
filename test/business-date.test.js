'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { addIsoCalendarDays, formatDateInTimeZone } = require('../utils/businessDate');
const browserDate = require('../frontend/lib/dateUtils.js');

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

test('Frontend verwendet für lokale Kalendertage den Datumshelper statt UTC-Datumsstrings', () => {
    const frontendRoot = path.resolve(__dirname, '../frontend');
    const sources = ['components/shop/ProductDetailsModal.jsx', 'components/admin/OrderModals.jsx']
        .map(file => fs.readFileSync(path.join(frontendRoot, file), 'utf8'));

    for (const source of sources) {
        assert.match(source, /formatLocalDate\(\)/);
    }

    for (const directory of ['pages', 'components', 'lib']) {
        for (const file of listSources(path.join(frontendRoot, directory))) {
            assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /new Date\(\)\.toISOString\(\)/, file);
        }
    }
});

function listSources(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return listSources(entryPath);
        return /\.(?:js|jsx)$/.test(entry.name) ? [entryPath] : [];
    });
}
