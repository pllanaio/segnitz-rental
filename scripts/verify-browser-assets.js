'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const defaultManifest = require('../public/vendor/manifest.json');

function relativeParts(value) {
    if (typeof value !== 'string' || path.isAbsolute(value) || value.includes('\\') ||
        value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Ungültiger Browserasset-Pfad');
    return value.split('/');
}

function verifyBrowserAssets({ publicRoot = path.resolve(__dirname, '..', 'public'), manifest = defaultManifest } = {}) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !Object.keys(manifest).length) {
        throw new Error('Browserasset-Manifest fehlt');
    }
    let checked = 0;
    for (const [name, entry] of Object.entries(manifest)) {
        if (!entry || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(entry.version) ||
            !entry.files || typeof entry.files !== 'object' || Array.isArray(entry.files) || !Object.keys(entry.files).length) {
            throw new Error('Browserasset benötigt feste Version und Dateiprüfsummen');
        }
        const base = relativeParts(entry.basePath ?? `vendor/${name}-${entry.version}`);
        for (const [file, expected] of Object.entries(entry.files)) {
            if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Ungültige Browserasset-Prüfsumme');
            let target = path.resolve(publicRoot);
            for (const part of [...base, ...relativeParts(file)]) {
                target = path.join(target, part);
                if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Browserasset darf kein Symlink sein');
            }
            const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
            if (actual !== expected) throw new Error(`Browserasset verändert: ${name}/${file}`);
            checked++;
        }
    }
    return checked;
}

if (require.main === module) console.log(`Browserassets: ${verifyBrowserAssets()} Dateien, feste Versionen und SHA-256 geprüft.`);
module.exports = { verifyBrowserAssets };
