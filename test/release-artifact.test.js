'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { validateScanReport } = require('../scripts/release-artifact');

function fixture(root, options = {}) {
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
    const manifests = [{ ...image, platform: { os: 'linux', architecture: 'amd64' } }];
    if (options.extraPlatform) {
        const otherConfig = blob({ os: 'linux', architecture: 'arm64' }, config.mediaType);
        const otherImage = blob({ schemaVersion: 2, config: otherConfig, layers: [layer] }, image.mediaType);
        manifests.push({ ...otherImage, platform: { os: 'linux', architecture: 'arm64' } });
    }
    for (const application of [...manifests]) {
        if (options.missing === 'all' || (options.extraPlatform && application.platform.architecture === 'arm64')) continue;
        const statements = [
            { predicateType: 'https://spdx.dev/Document', predicate: {
                SPDXID: 'SPDXRef-DOCUMENT', spdxVersion: 'SPDX-2.3', name: 'synthetic-image',
                documentNamespace: 'https://example.invalid/sbom/synthetic',
                creationInfo: { created: '2026-09-13T00:00:00Z', creators: ['Tool: synthetic-test'] },
                packages: [{ SPDXID: 'SPDXRef-Package', name: 'synthetic-package', versionInfo: '1.0.0' }]
            } },
            { predicateType: 'https://slsa.dev/provenance/v0.2', predicate: {
                buildType: 'https://mobyproject.org/buildkit@v1', builder: { id: '' },
                invocation: { configSource: { entryPoint: 'Dockerfile' } },
                materials: [{ uri: 'pkg:docker/alpine@synthetic', digest: { sha256: '1'.repeat(64) } }],
                metadata: { buildStartedOn: '2026-09-13T00:00:00Z', buildFinishedOn: '2026-09-13T00:01:00Z' }
            } }
        ].filter(statement => !(options.missing === 'sbom' && statement.predicateType.includes('spdx')) &&
            !(options.missing === 'provenance' && statement.predicateType.includes('slsa')));
        const layers = statements.map(statement => {
            statement._type = options.statementType || 'https://in-toto.io/Statement/v0.1';
            statement.subject = [{ name: '_', digest: { sha256: application.digest.slice(7) } }];
            if (options.provenanceV1 && statement.predicateType.includes('slsa')) {
                statement.predicateType = 'https://slsa.dev/provenance/v1';
                const old = statement.predicate;
                statement.predicate = {
                    buildDefinition: { buildType: 'https://github.com/moby/buildkit/blob/master/docs/attestations/slsa-definitions.md',
                        externalParameters: { configSource: { path: 'Dockerfile' } }, resolvedDependencies: old.materials },
                    runDetails: { builder: old.builder, metadata: { startedOn: old.metadata.buildStartedOn, finishedOn: old.metadata.buildFinishedOn } }
                };
            }
            options.mutateStatement?.(statement);
            const descriptor = { ...blob(options.malformedStatement ? 'SYNTHETIC-PAYLOAD-MUST-NOT-ENTER-LOGS{"invalid":' : statement, 'application/vnd.in-toto+json'), annotations: { 'in-toto.io/predicate-type': statement.predicateType } };
            options.mutateLayer?.(descriptor);
            return descriptor;
        });
        const attestation = { schemaVersion: 2, config: options.artifact ? blob({}, 'application/vnd.oci.empty.v1+json') :
            blob({ os: 'unknown', architecture: 'unknown' }, config.mediaType), layers };
        if (options.artifact) { attestation.artifactType = 'application/vnd.docker.attestation.manifest.v1+json'; attestation.subject = application; }
        options.mutateManifest?.(attestation);
        const descriptor = { ...blob(attestation, image.mediaType), platform: { os: 'unknown', architecture: 'unknown' },
            annotations: { 'vnd.docker.reference.type': 'attestation-manifest', 'vnd.docker.reference.digest': application.digest } };
        options.mutateDescriptor?.(descriptor);
        manifests.push(descriptor);
    }
    const index = blob({ schemaVersion: 2, manifests }, 'application/vnd.oci.image.index.v1+json');
    fs.writeFileSync(path.join(layout, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: [index] }));
    // OCI member paths normally omit ./; GNU tar -C listing here needs explicit names.
    execFileSync('tar', ['-cf', path.join(root, 'image.tar'), '-C', layout, 'index.json', 'blobs']);
    fs.writeFileSync(path.join(root, 'build-metadata.json'), JSON.stringify({ 'containerimage.digest': index.digest }));
    return { config, image, layer, layout };
}
function scan(configDigest) {
    return { SchemaVersion: 2, ArtifactType: 'container_image', Metadata: { ImageID: configDigest }, Results: [
        { Class: 'os-pkgs', Type: 'alpine', Packages: [{ Name: 'alpine-baselayout', Version: 'synthetic' }] },
        { Class: 'lang-pkgs', Type: 'node-pkg', Packages: ['express', 'mysql2', 'multer'].map(Name => ({ Name, Version: 'synthetic' })) }
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

for (const [name, options] of [
    ['all attestations absent', { missing: 'all' }],
    ['SBOM absent', { missing: 'sbom' }],
    ['provenance absent', { missing: 'provenance' }],
    ['unattested second platform', { extraPlatform: true }],
    ['wrong statement subject', { mutateStatement: statement => { statement.subject[0].digest.sha256 = 'f'.repeat(64); } }],
    ['wrong manifest target', { mutateDescriptor: descriptor => { descriptor.annotations['vnd.docker.reference.digest'] = 'sha256:' + 'f'.repeat(64); } }],
    ['contradictory OCI subject', { artifact: true, mutateManifest: manifest => { manifest.subject = { ...manifest.subject, digest: 'sha256:' + 'f'.repeat(64) }; } }],
    ['contradictory predicate annotation', { mutateLayer: descriptor => { descriptor.annotations['in-toto.io/predicate-type'] = 'https://example.invalid/other'; } }],
    ['unsupported statement version', { statementType: 'https://in-toto.io/Statement/v999' }],
    ['empty predicate', { mutateStatement: statement => { statement.predicate = {}; } }],
    ['empty package inventory', { mutateStatement: statement => { if (statement.predicate.packages) statement.predicate.packages = []; } }],
    ['malformed JSON without exposing its content', { malformedStatement: true }],
    ['unknown provenance version', { mutateStatement: statement => { if (statement.predicateType.includes('slsa')) statement.predicateType = 'https://slsa.dev/provenance/v999'; } }]
]) {
    test(`artifact CLI rejects ${name} even when all descriptor hashes are valid`, () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'segnitz-attestation-test-'));
        try {
            fixture(root, options);
            const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/release-artifact.js'), 'create', root],
                { env: { ...process.env, RELEASE_SHA: 'a'.repeat(40) }, encoding: 'utf8' });
            assert.notEqual(result.status, 0, 'Unacceptable attestation must block release creation');
            assert.equal(fs.existsSync(path.join(root, 'release.json')), false);
            assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC-PAYLOAD-MUST-NOT-ENTER-LOGS/);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
}

for (const options of [{}, { artifact: true, statementType: 'https://in-toto.io/Statement/v1' },
    { artifact: true, provenanceV1: true, statementType: 'https://in-toto.io/Statement/v1' }]) {
    test(`artifact CLI accepts complete BuildKit contract ${JSON.stringify(options)}`, () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'segnitz-attestation-test-'));
        try {
            const image = fixture(root, options);
            fs.writeFileSync(path.join(root, 'trivy.json'), JSON.stringify(scan(image.config.digest)));
            for (const mode of ['create', 'verify']) {
                const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/release-artifact.js'), mode, root],
                    { env: { ...process.env, RELEASE_SHA: 'a'.repeat(40) }, encoding: 'utf8' });
                assert.equal(result.status, 0, result.stderr);
                if (mode === 'verify') {
                    const evidence = JSON.parse(result.stdout).attestations;
                    assert.equal(evidence.length, 1);
                    assert.equal(evidence[0].subject, image.image.digest);
                    assert.equal(evidence[0].sbom.length, 1);
                    assert.equal(evidence[0].provenance.length, 1);
                }
            }
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
}

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
