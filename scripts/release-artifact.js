'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');

function validateManifest(manifest, { sha, digest } = {}) {
    if (manifest.schema !== 1 || !/^[a-f0-9]{40}$/.test(manifest.commit || '') ||
        !/^sha256:[a-f0-9]{64}$/.test(manifest.imageDigest || '') ||
        !/^[a-f0-9]{64}$/.test(manifest.archiveSha256 || '') ||
        (sha && manifest.commit !== sha) || (digest && manifest.imageDigest !== digest)) {
        throw new Error('Release artifact identity mismatch');
    }
    return true;
}

async function sha256(file) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

const ATTESTATION_TYPE = 'application/vnd.docker.attestation.manifest.v1+json';
const SPDX_TYPE = 'https://spdx.dev/Document';
const SLSA_TYPES = new Set(['https://slsa.dev/provenance/v0.2', 'https://slsa.dev/provenance/v1']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0;

function validatePredicate(statement) {
    const predicate = statement.predicate;
    if (!object(predicate)) throw new Error('Missing attestation predicate');
    if (statement.predicateType === SPDX_TYPE) {
        if (predicate.SPDXID !== 'SPDXRef-DOCUMENT' || !['SPDX-2.2', 'SPDX-2.3'].includes(predicate.spdxVersion) ||
            !nonempty(predicate.name) || !nonempty(predicate.documentNamespace) ||
            !Number.isFinite(Date.parse(predicate.creationInfo?.created)) ||
            !Array.isArray(predicate.creationInfo?.creators) || !predicate.creationInfo.creators.length ||
            !predicate.creationInfo.creators.every(nonempty) ||
            !Array.isArray(predicate.packages) || !predicate.packages.length ||
            predicate.packages.some(pkg => !nonempty(pkg?.SPDXID) || !nonempty(pkg?.name))) {
            throw new Error('Incomplete SPDX package inventory');
        }
        return 'sbom';
    }
    if (!SLSA_TYPES.has(statement.predicateType)) return null;
    const v1 = statement.predicateType.endsWith('/v1');
    const definition = v1 ? predicate.buildDefinition : predicate;
    const builder = v1 ? predicate.runDetails?.builder : predicate.builder;
    const metadata = v1 ? predicate.runDetails?.metadata : predicate.metadata;
    const materials = v1 ? definition?.resolvedDependencies : predicate.materials;
    const invocation = v1 ? definition?.externalParameters : predicate.invocation;
    const expectedType = v1 ? 'https://github.com/moby/buildkit/blob/master/docs/attestations/slsa-definitions.md' : 'https://mobyproject.org/buildkit@v1';
    const started = Date.parse(v1 ? metadata?.startedOn : metadata?.buildStartedOn);
    const finished = Date.parse(v1 ? metadata?.finishedOn : metadata?.buildFinishedOn);
    // BuildKit may leave builder.id empty. Identity authentication belongs to the
    // independently gated workflow/signature, not an unsigned predicate field.
    if (definition?.buildType !== expectedType || !object(builder) || typeof builder.id !== 'string' ||
        !object(invocation?.configSource) || !Number.isFinite(started) || !Number.isFinite(finished) || finished < started ||
        !Array.isArray(materials) || !materials.length || materials.some(material =>
            !nonempty(material?.uri) || !object(material.digest) || !Object.values(material.digest).some(nonempty))) {
        throw new Error('Incomplete BuildKit SLSA provenance');
    }
    return 'provenance';
}

async function validateOci(archive, imageDigest) {
    const readJson = (name, maxBuffer = 8 * 1024 * 1024) => {
        try {
            return JSON.parse(execFileSync('tar', ['-xOf', archive, name], { encoding: 'utf8', maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] }));
        } catch {
            // JSON.parse errors can quote the source payload, including build
            // arguments. Expose only a fixed diagnostic to the CI log.
            throw new Error('Missing, oversized or malformed OCI JSON blob');
        }
    };
    const index = readJson('index.json');
    const root = index.manifests?.find(item => item.digest === imageDigest);
    if (!root) throw new Error('OCI root differs from BuildKit metadata');
    const visited = new Set();
    const applications = new Map();
    const attestations = [];
    let configDigest;
    async function verify(descriptor, depth = 0, platform = null) {
        if (!descriptor || !/^sha256:[a-f0-9]{64}$/.test(descriptor.digest || '') ||
            !Number.isSafeInteger(descriptor.size) || descriptor.size < 0 || depth > 8 || visited.size > 1000) throw new Error('Invalid OCI descriptor');
        const name = `blobs/sha256/${descriptor.digest.slice(7)}`;
        if (!visited.has(descriptor.digest)) {
            const child = spawn('tar', ['-xOf', archive, name], { stdio: ['ignore', 'pipe', 'ignore'] });
            const completion = new Promise((resolve, reject) => {
                child.once('error', reject);
                child.once('close', code => code === 0 ? resolve() : reject(new Error('Missing OCI blob')));
            });
            // Attach rejection handler before consuming the stream.
            completion.catch(() => {});
            const hash = crypto.createHash('sha256');
            let bytes = 0;
            for await (const chunk of child.stdout) { hash.update(chunk); bytes += chunk.length; }
            await completion;
            if (`sha256:${hash.digest('hex')}` !== descriptor.digest || bytes !== descriptor.size) throw new Error('OCI blob checksum or size mismatch');
            visited.add(descriptor.digest);
        }
        if (/image\.index|manifest\.list/.test(descriptor.mediaType || '')) {
            const value = readJson(name);
            if (!Array.isArray(value.manifests) || !value.manifests.length) throw new Error('Empty OCI image index');
            for (const child of value.manifests) await verify(child, depth + 1, child.platform);
        } else if (/image\.manifest|manifest\.v2/.test(descriptor.mediaType || '')) {
            const value = readJson(name);
            if (!value.config || !Array.isArray(value.layers) || !value.layers.length) throw new Error('Incomplete OCI image manifest');
            await verify(value.config, depth + 1);
            for (const layer of value.layers) await verify(layer, depth + 1);
            const referenceType = descriptor.annotations?.['vnd.docker.reference.type'];
            if (referenceType === 'attestation-manifest' || value.artifactType === ATTESTATION_TYPE) {
                if (platform?.os !== 'unknown' || platform?.architecture !== 'unknown' ||
                    (referenceType !== undefined && referenceType !== 'attestation-manifest') ||
                    (value.artifactType !== undefined && value.artifactType !== ATTESTATION_TYPE)) throw new Error('Invalid BuildKit attestation manifest');
                attestations.push({ descriptor, value });
            } else {
                const config = readJson(`blobs/sha256/${value.config.digest.slice(7)}`);
                if (!nonempty(config.os) || !nonempty(config.architecture) || config.os === 'unknown' || config.architecture === 'unknown' ||
                    (platform && (config.os !== platform.os || config.architecture !== platform.architecture))) throw new Error('Invalid application image platform');
                applications.set(descriptor.digest, { descriptor, configDigest: value.config.digest, evidence: { sbom: [], provenance: [] } });
                if (config.os === 'linux' && config.architecture === 'amd64') {
                    if (configDigest && configDigest !== value.config.digest) throw new Error('Ambiguous linux/amd64 application images');
                    configDigest = value.config.digest;
                }
            }
        }
    }
    await verify(root);
    if (!configDigest) throw new Error('No complete linux/amd64 application image');
    for (const { descriptor, value } of attestations) {
        const annotatedTarget = descriptor.annotations?.['vnd.docker.reference.digest'];
        const target = annotatedTarget || value.subject?.digest;
        const application = applications.get(target);
        if (!application || (annotatedTarget !== undefined && annotatedTarget !== target) ||
            (value.subject !== undefined && (value.subject.digest !== target || value.subject.size !== application.descriptor.size || value.subject.mediaType !== application.descriptor.mediaType)) ||
            (value.artifactType === ATTESTATION_TYPE && !value.subject)) throw new Error('Attestation target does not match an application manifest');
        for (const layer of value.layers) {
            if (layer.mediaType !== 'application/vnd.in-toto+json') continue;
            // BuildKit bounds an attestation file to 80 MiB before wrapping.
            const statement = readJson(`blobs/sha256/${layer.digest.slice(7)}`, 81 * 1024 * 1024);
            if (!['https://in-toto.io/Statement/v0.1', 'https://in-toto.io/Statement/v1'].includes(statement?._type) ||
                !nonempty(statement.predicateType) || !Array.isArray(statement.subject) || !statement.subject.length ||
                statement.subject.some(subject => !nonempty(subject?.name) || subject.digest?.sha256 !== target.slice(7)) ||
                (layer.annotations?.['in-toto.io/predicate-type'] !== undefined && layer.annotations['in-toto.io/predicate-type'] !== statement.predicateType)) {
                throw new Error('Invalid in-toto statement identity or predicate annotation');
            }
            const kind = validatePredicate(statement);
            if (kind) application.evidence[kind].push({ digest: layer.digest, predicateType: statement.predicateType });
        }
    }
    const evidence = [...applications.entries()].map(([digest, application]) => {
        if (!application.evidence.sbom.length || !application.evidence.provenance.length) throw new Error('Application manifest requires SPDX SBOM and SLSA provenance');
        return { subject: digest, ...application.evidence };
    });
    return { configDigest, blobs: visited.size, attestations: evidence };
}

function validateScanReport(scan, configDigest) {
    if (scan.SchemaVersion !== 2 || scan.ArtifactType !== 'container_image' ||
        scan.Metadata?.ImageID !== configDigest || !Array.isArray(scan.Results) || !scan.Results.length) throw new Error('Missing or mismatched container scan identity');
    const os = scan.Results.find(result => result.Class === 'os-pkgs' && result.Type === 'alpine');
    // Trivy distinguishes an npm lockfile from installed Node package metadata.
    // The runtime image must contain scanned installed dependencies.
    const npm = scan.Results.filter(result => result.Class === 'lang-pkgs' && result.Type === 'node-pkg');
    if (!Array.isArray(os?.Packages) || !os.Packages.length || !npm.length) throw new Error('OS and npm package coverage required');
    for (const result of [os, ...npm]) {
        if (!Array.isArray(result.Packages) || !result.Packages.length || result.Packages.some(pkg => typeof pkg.Name !== 'string' || !pkg.Name || typeof pkg.Version !== 'string' || !pkg.Version)) throw new Error('Incomplete scanned package inventory');
        if (result.Vulnerabilities !== undefined && !Array.isArray(result.Vulnerabilities)) throw new Error('Malformed vulnerability results');
    }
    const packages = npm.flatMap(result => result.Packages.map(pkg => pkg.Name));
    if (!['express', 'mysql2', 'multer'].every(name => packages.includes(name))) throw new Error('Application dependencies absent from scan');
    for (const result of scan.Results) {
        for (const finding of result.Vulnerabilities || []) {
            if (!['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(finding.Severity)) throw new Error('Invalid vulnerability severity');
            if (['HIGH', 'CRITICAL'].includes(finding.Severity)) throw new Error('Container security gate failed');
        }
    }
    return true;
}

async function main(mode, directory) {
    if (mode === 'scan-summary') {
        const reportPath = path.join(directory, 'trivy.json');
        if (!fs.existsSync(reportPath)) {
            console.log(JSON.stringify({ scanReport: 'absent' }));
            return;
        }
        const scan = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        console.log(JSON.stringify({ imageId: scan.Metadata?.ImageID,
            coverage: (scan.Results || []).map(result => ({ class: result.Class, type: result.Type, packages: result.Packages?.length || 0 })),
            vulnerabilities: (scan.Results || []).flatMap(result => (result.Vulnerabilities || []).map(finding => ({
                id: finding.VulnerabilityID, package: finding.PkgName, installed: finding.InstalledVersion,
                fixed: finding.FixedVersion, severity: finding.Severity
            }))),
            secretFindingCount: (scan.Results || []).reduce((count, result) => count + (result.Secrets || []).length, 0)
        }));
        return;
    }
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'build-metadata.json'), 'utf8'));
    const manifestPath = path.join(directory, 'release.json');
    const checksum = await sha256(path.join(directory, 'image.tar'));
    const imageDigest = metadata['containerimage.digest'];
    const identity = await validateOci(path.join(directory, 'image.tar'), imageDigest);
    if (mode === 'create') {
        const manifest = { schema: 1, commit: process.env.RELEASE_SHA, imageDigest, archiveSha256: checksum,
            platform: 'linux/amd64', ciRunId: process.env.GITHUB_RUN_ID, createdAt: new Date().toISOString() };
        validateManifest(manifest);
        fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    } else if (mode === 'verify') {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        validateManifest(manifest, { sha: process.env.RELEASE_SHA, digest: process.env.RELEASE_DIGEST });
        if (checksum !== manifest.archiveSha256 || imageDigest !== manifest.imageDigest) throw new Error('Artifact bytes or image digest changed');
        validateScanReport(JSON.parse(fs.readFileSync(path.join(directory, 'trivy.json'), 'utf8')), identity.configDigest);
        console.log(JSON.stringify({ commit: manifest.commit, imageDigest, archiveSha256: checksum, verifiedBlobs: identity.blobs,
            attestations: identity.attestations, scan: 'passed' }));
    } else throw new Error('Expected create or verify');
}
if (require.main === module) main(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { validateManifest, sha256, validateOci, validateScanReport };
