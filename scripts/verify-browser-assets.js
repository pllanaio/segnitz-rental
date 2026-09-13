'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..', 'public', 'vendor');
const manifest = require('../public/vendor/manifest.json');
let checked = 0;
for (const [name, entry] of Object.entries(manifest)) {
    for (const [file, expected] of Object.entries(entry.files)) {
        const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, `${name}-${entry.version}`, file))).digest('hex');
        if (actual !== expected) throw new Error(`Browserasset verändert: ${name}/${file}`);
        checked++;
    }
}
console.log(`Browserassets: ${checked} Dateien, feste Versionen und SHA-256 geprüft.`);
