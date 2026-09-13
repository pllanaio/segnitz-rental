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

async function validateOci(archive, imageDigest) {
    const readJson = name => JSON.parse(execFileSync('tar', ['-xOf', archive, name], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
    const index = readJson('index.json');
    const root = index.manifests?.find(item => item.digest === imageDigest);
    if (!root) throw new Error('OCI root differs from BuildKit metadata');
    const visited = new Set();
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
            if (!platform || (platform.os === 'linux' && platform.architecture === 'amd64')) {
                const config = readJson(`blobs/sha256/${value.config.digest.slice(7)}`);
                if (config.os === 'linux' && config.architecture === 'amd64') configDigest = value.config.digest;
            }
        }
    }
    await verify(root);
    if (!configDigest) throw new Error('No complete linux/amd64 application image');
    return { configDigest, blobs: visited.size };
}

function validateScanReport(scan, configDigest) {
    if (scan.SchemaVersion !== 2 || scan.ArtifactType !== 'container_image' ||
        scan.Metadata?.ImageID !== configDigest || !Array.isArray(scan.Results) || !scan.Results.length) throw new Error('Missing or mismatched container scan identity');
    const os = scan.Results.find(result => result.Class === 'os-pkgs' && result.Type === 'alpine');
    const npm = scan.Results.filter(result => result.Class === 'lang-pkgs' && result.Type === 'npm');
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
        console.log(JSON.stringify({ commit: manifest.commit, imageDigest, archiveSha256: checksum, verifiedBlobs: identity.blobs, scan: 'passed' }));
    } else throw new Error('Expected create or verify');
}
if (require.main === module) main(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { validateManifest, sha256, validateOci, validateScanReport };
