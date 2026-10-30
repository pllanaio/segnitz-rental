'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const frontendDirectory = path.join(root, 'frontend');
const buildDirectory = path.join(frontendDirectory, 'out');
const excludedScripts = new Set(['bootstrap.bundle.min.js', 'signature_pad.js']);

function collectFiles(directory, extensions) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectFiles(entryPath, extensions);
        if (!extensions.some(extension => entry.name.endsWith(extension)) || excludedScripts.has(entry.name)) return [];
        return [entryPath];
    });
}

// First-party UI: React sources and whatever static HTML/JS remains in public/.
const uiFiles = [
    ...['pages', 'components', 'lib'].flatMap(directory => collectFiles(path.join(frontendDirectory, directory), ['.js', '.jsx'])),
    ...collectFiles(path.join(root, 'public'), ['.html', '.js'])
];
const builtPages = collectFiles(buildDirectory, ['.html']);

test('first-party UI contains no inline HTML event handlers', () => {
    const inlineAttribute = /\son[a-z][a-z0-9]*\s*=\s*["']/i;

    assert.ok(uiFiles.length > 20);
    for (const file of uiFiles) {
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), inlineAttribute, path.relative(root, file));
    }
});

test('first-party UI uses React handlers or addEventListener instead of DOM event properties', () => {
    const eventProperty = /\.(?:onclick|onchange|oninput|onsubmit|onkeyup|onkeydown|onerror|onload)\s*=/i;
    const eventAttributeMutation = /setAttribute\(\s*["']on[a-z][a-z0-9]*["']/i;

    for (const file of uiFiles) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, eventProperty, path.relative(root, file));
        assert.doesNotMatch(source, eventAttributeMutation, path.relative(root, file));
    }
});

test('first-party UI contains no javascript URLs', () => {
    for (const file of uiFiles) {
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\bjavascript\s*:/i, path.relative(root, file));
    }
});

test('built HTML pages load scripts externally and need no inline-script CSP exception', {
    skip: builtPages.length === 0 && 'Frontend-Build fehlt (npm run build:frontend)'
}, () => {
    const executableInlineScript = /<script\b(?![^>]*\bsrc\s*=)(?![^>]*type="application\/json")[^>]*>[\s\S]*?<\/script>/i;
    const expectedPages = ['index', 'login', 'register', 'profile', 'backend', 'setup', 'verify-email', 'email-verified', 'widerruf'];

    for (const page of expectedPages) {
        assert.ok(builtPages.includes(path.join(buildDirectory, `${page}.html`)), `${page}.html fehlt im Build`);
    }
    for (const file of builtPages) {
        const html = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(html, executableInlineScript, path.relative(root, file));
        assert.doesNotMatch(html, /\son[a-z][a-z0-9]*\s*=\s*["']/i, path.relative(root, file));
        assert.doesNotMatch(html, /<script[^>]+src="https?:/i, path.relative(root, file));
    }
});
