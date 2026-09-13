'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { validateScanReport } = require('../scripts/release-artifact');

function fixture(root) {
    const layout = path.join(root, 'layout');
    fs.mkdirSync(path.join(layout, 'blobs', 'sha256'), { recursive: true });
    const blob = (value, mediaType) => {
        const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        fs.writeFileSync(path.join(layout, 'blobs', 'sha256', digest), bytes);
        return { mediaType, size: bytes.length, digest: `sha256:${digest}` };
    };
    const config = blob({ os: 'linux', architecture: 'amd64' }, 'application/vnd.oci.image.config.v1+json');
    const layer = blob('synthetic layer bytes, not a production container', 'application/vnd.oci.image.layer.v1.tar');
    const image = blob({ schemaVersion: 2, config, layers: [layer] }, 'application/vnd.oci.image.manifest.v1+json');
    fs.writeFileSync(path.join(layout, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: [image] }));
    execFileSync('tar', ['-cf', path.join(root, 'image.tar'), '-C', layout, '.']);
    // OCI member paths normally omit ./; GNU tar -C listing here needs explicit names.
    execFileSync('tar', ['-cf', path.join(root, 'image.tar'), '-C', layout, 'index.json', 'blobs']);
    fs.writeFileSync(path.join(root, 'build-metadata.json'), JSON.stringify({ 'containerimage.digest': image.digest }));
    return { config, image, layer, layout };
}
function scan(configDigest) {
    return { SchemaVersion: 2, ArtifactType: 'container_image', Metadata: { ImageID: configDigest }, Results: [
        { Class: 'os-pkgs', Type: 'alpine', Packages: [{ Name: 'alpine-baselayout', Version: 'synthetic' }] },
        { Class: 'lang-pkgs', Type: 'npm', Packages: ['express', 'mysql2', 'multer'].map(Name => ({ Name, Version: 'synthetic' })) }
    ] };
}

test('scan gate requires image identity and both OS and application package coverage', () => {
    const digest = 'sha256:' + '1'.repeat(64);
    assert.equal(validateScanReport(scan(digest), digest), true);
    for (const report of [{ Results: [{}] }, { ...scan(digest), Results: [] }, { ...scan(digest), Metadata: {} },
        { ...scan(digest), Results: [scan(digest).Results[0]] }]) assert.throws(() => validateScanReport(report, digest));
    const bad = scan(digest);
    bad.Results[1].Vulnerabilities = [{ Severity: 'HIGH' }];
    assert.throws(() => validateScanReport(bad, digest));
});

test('real artifact CLI rejects missing/corrupt OCI blobs and empty scan reports', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'segnitz-oci-test-'));
    try {
        const image = fixture(root);
        const command = mode => spawnSync(process.execPath, [path.join(__dirname, '../scripts/release-artifact.js'), mode, root],
            { env: { ...process.env, RELEASE_SHA: 'a'.repeat(40) }, encoding: 'utf8' });
        assert.equal(command('create').status, 0);
        fs.writeFileSync(path.join(root, 'trivy.json'), JSON.stringify({ Results: [{}] }));
        assert.notEqual(command('verify').status, 0);
        fs.writeFileSync(path.join(root, 'trivy.json'), JSON.stringify(scan(image.config.digest)));
        assert.equal(command('verify').status, 0);
        const blob = path.join(image.layout, 'blobs', 'sha256', image.layer.digest.slice(7));
        fs.writeFileSync(blob, 'tampered layer');
        execFileSync('tar', ['-cf', path.join(root, 'image.tar'), '-C', image.layout, 'index.json', 'blobs']);
        assert.notEqual(command('create').status, 0);
        fs.unlinkSync(blob);
        execFileSync('tar', ['-cf', path.join(root, 'image.tar'), '-C', image.layout, 'index.json', 'blobs']);
        assert.notEqual(command('create').status, 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
