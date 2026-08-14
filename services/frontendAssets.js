'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEGACY_FRONTEND_PAGES = Object.freeze([
    'index.html',
    'login.html',
    'register.html',
    'setup.html',
    'verify-email.html',
    'email-verified.html',
    'profile.html',
    'backend.html'
]);
const CSP_HASH_PATTERN = /^'sha256-[A-Za-z0-9+/]{43}='$/u;
const CSP_HEADER_BUDGET_BYTES = 6 * 1024;

function getFrontendDirectory(environment = process.env, projectRoot = path.resolve(__dirname, '..')) {
    if (environment.FRONTEND_DIST_DIR) {
        return path.resolve(projectRoot, environment.FRONTEND_DIST_DIR);
    }

    const packagedDirectory = path.join(projectRoot, 'frontend-dist');
    if (fs.existsSync(packagedDirectory)) return packagedDirectory;

    const localBuildDirectory = path.join(projectRoot, 'frontend', 'out');
    if (fs.existsSync(localBuildDirectory)) return localBuildDirectory;

    return packagedDirectory;
}

function getExportedPagePath(frontendDirectory, legacyPage) {
    if (!LEGACY_FRONTEND_PAGES.includes(legacyPage)) {
        throw new Error(`Unbekannte Frontend-Seite: ${legacyPage}`);
    }

    // Die logische Next-Route enthält bewusst ".html". Beim Static Export
    // entsteht daher z. B. login.html.html; nur dieses Mapping hydratisiert
    // unter der historischen Browser-URL /login.html ohne Pfadabweichung.
    return path.join(frontendDirectory, `${legacyPage}.html`);
}

function readFrontendCspHashes(frontendDirectory, { required = false } = {}) {
    const manifestPath = path.join(frontendDirectory, 'csp-script-hashes.json');

    if (!fs.existsSync(manifestPath)) {
        if (required) {
            throw new Error(`CSP-Manifest des Frontends fehlt: ${manifestPath}`);
        }
        return [];
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
        throw new Error(`CSP-Manifest des Frontends ist ungültig: ${error.message}`);
    }

    if (!Array.isArray(manifest.scriptSrc)) {
        throw new Error('CSP-Manifest des Frontends enthält keine scriptSrc-Liste.');
    }

    const hashes = [...new Set(manifest.scriptSrc)];
    if (hashes.some(hash => typeof hash !== 'string' || !CSP_HASH_PATTERN.test(hash))) {
        throw new Error('CSP-Manifest des Frontends enthält einen ungültigen SHA-256-Hash.');
    }
    if (required && hashes.length === 0) {
        throw new Error('CSP-Manifest des Frontends enthält keine Inline-Script-Hashes.');
    }
    if (Buffer.byteLength(hashes.join(' '), 'utf8') > CSP_HEADER_BUDGET_BYTES) {
        throw new Error(`CSP-Hashes überschreiten das Budget von ${CSP_HEADER_BUDGET_BYTES} Bytes.`);
    }

    return hashes;
}

function assertFrontendBuild(frontendDirectory, { required = false } = {}) {
    if (!required && !fs.existsSync(frontendDirectory)) return;

    const missingPages = LEGACY_FRONTEND_PAGES.filter(
        page => !fs.existsSync(getExportedPagePath(frontendDirectory, page))
    );
    if (missingPages.length > 0) {
        throw new Error(`Frontend-Build ist unvollständig; fehlend: ${missingPages.join(', ')}`);
    }

    if (!fs.existsSync(path.join(frontendDirectory, '_next', 'static'))) {
        throw new Error('Frontend-Build enthält keine statischen Next.js-Assets.');
    }

    readFrontendCspHashes(frontendDirectory, { required: true });
}

module.exports = {
    CSP_HEADER_BUDGET_BYTES,
    LEGACY_FRONTEND_PAGES,
    assertFrontendBuild,
    getExportedPagePath,
    getFrontendDirectory,
    readFrontendCspHashes
};
