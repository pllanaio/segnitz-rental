#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { validateManifest } = require('../release-artifact');

function validateImage(image, manifest) {
    validateManifest(manifest);
    if (image !== `pllanaio/segnitz-rental@${manifest.imageDigest}`) throw new Error('SEGNITZ_IMAGE must equal the reviewed repository@digest');
}

async function probe(baseUrl, { fetchImpl = fetch } = {}) {
    const base = new URL(baseUrl);
    if (base.username || base.password || base.search || base.hash ||
        (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))) {
        throw new Error('Probe URL must use HTTPS or local HTTP without credentials');
    }
    const results = [];
    for (const endpoint of ['/live', '/ready']) {
        const started = Date.now();
        const response = await fetchImpl(new URL(endpoint, base), { redirect: 'error', signal: AbortSignal.timeout(3000) });
        results.push({ endpoint, status: response.status, durationMs: Date.now() - started });
        await response.body?.cancel();
        if (response.status !== 200) throw new Error(`${endpoint} did not return 200`);
    }
    return results;
}

async function main() {
    const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    validateImage(process.env.SEGNITZ_IMAGE, manifest);
    // Both commands are read-only and their unredacted output is suppressed.
    execFileSync('docker', ['compose', '-f', 'compose.yml', 'config', '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
    execFileSync('cosign', ['verify', '--certificate-identity',
        'https://github.com/pllanaio/segnitz-rental/.github/workflows/docker-publish.yml@refs/heads/main',
        '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com', process.env.SEGNITZ_IMAGE],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    const probes = process.argv[3] ? await probe(process.argv[3]) : [];
    console.log(JSON.stringify({ preflight: 'passed', commit: manifest.commit, digest: manifest.imageDigest, probes }));
}
if (require.main === module) main().catch(error => {
    console.error(error.status ? 'Preflight external verification failed; inspect controlled operator diagnostics.' : error.message);
    process.exitCode = 1;
});
module.exports = { validateImage, probe };
