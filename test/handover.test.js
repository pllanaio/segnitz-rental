'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { validateDocument } = require('../services/handoverService');

test('Übergabe: keine Auffälligkeiten muss ausdrücklich bestätigt werden', async () => {
    await assert.rejects(validateDocument({ revision: 0, entries: [] }, false), /Zustand dokumentieren/);
    const draft = await validateDocument({ revision: 0, entries: [], noDamage: true, signature: 'nicht übernehmen' }, false);
    assert.equal(draft.noDamage, true); assert.equal(draft.signature, null);
});
test('Übergabe: widersprüchliche und übergroße Einträge werden abgewiesen', async () => {
    const entry = { itemId: 1, kind: 'damage', text: 'Riss', photos: [] };
    await assert.rejects(validateDocument({ revision: 0, entries: [entry], noDamage: true }, false), /Keine Auffälligkeiten/);
    await assert.rejects(validateDocument({ revision: 0, entries: Array(21).fill(entry) }, false), /20 Einträge/);
    await assert.rejects(validateDocument({ revision: 0, entries: [{ ...entry, text: 'a'.repeat(2001) }] }, false));
    await assert.rejects(validateDocument({ revision: 0, entries: [{ ...entry, photos: Array(7).fill('x') }] }, false));
});
test('Übergabe: ungültige Fotos und leere Unterschriften werden nicht festgeschrieben', async () => {
    const blank = await sharp({ create: { width: 400, height: 120, channels: 3, background: 'white' } }).png().toBuffer();
    await assert.rejects(validateDocument({ revision: 0, noDamage: true, entries: [], confirmed: true, signer: 'Test', signature: `data:image/png;base64,${blank.toString('base64')}` }, true), /Unterschrift/);
    await assert.rejects(validateDocument({ revision: 0, entries: [{ itemId: 1, kind: 'note', text: 'Foto', photos: ['data:image/png;base64,dGVzdA=='] }] }, false), /Bild konnte nicht/);
    await assert.rejects(validateDocument({ revision: 0, entries: [], noDamage: true, confirmed: false, signer: 'Test' }, true), /Bestätigung/);
});
