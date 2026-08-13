'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publicDirectory = path.resolve(__dirname, '../public');
const excludedScripts = new Set([
    'bootstrap.bundle.min.js',
    'signature_pad.js'
]);

function collectFirstPartyUiFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true })
        .flatMap(entry => {
            const entryPath = path.join(directory, entry.name);

            if (entry.isDirectory()) {
                return collectFirstPartyUiFiles(entryPath);
            }

            if (!entry.name.endsWith('.html') && !entry.name.endsWith('.js')) {
                return [];
            }

            if (excludedScripts.has(entry.name)) {
                return [];
            }

            return [entryPath];
        });
}

const uiFiles = collectFirstPartyUiFiles(publicDirectory);

test('first-party UI contains no inline HTML event handlers', () => {
    const inlineAttribute = /\son[a-z][a-z0-9]*\s*=\s*["']/i;

    for (const file of uiFiles) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, inlineAttribute, path.relative(publicDirectory, file));
    }
});

test('first-party UI uses addEventListener instead of DOM event properties', () => {
    const eventProperty = /\.(?:onclick|onchange|oninput|onsubmit|onkeyup|onkeydown|onerror|onload)\s*=/i;
    const eventAttributeMutation = /setAttribute\(\s*["']on[a-z][a-z0-9]*["']/i;

    for (const file of uiFiles) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, eventProperty, path.relative(publicDirectory, file));
        assert.doesNotMatch(source, eventAttributeMutation, path.relative(publicDirectory, file));
    }
});

test('HTML pages load scripts externally', () => {
    const inlineScript = /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/i;

    for (const file of uiFiles.filter(file => file.endsWith('.html'))) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, inlineScript, path.relative(publicDirectory, file));
    }
});

test('first-party UI contains no javascript URLs', () => {
    for (const file of uiFiles) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, /\bjavascript\s*:/i, path.relative(publicDirectory, file));
    }
});
