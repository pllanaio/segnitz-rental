'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { verifyBrowserAssets } = require('../scripts/verify-browser-assets');
const manifest = require('../public/vendor/manifest.json');

test('all four browser libraries include deployed code, fonts and full licenses in the checksum gate', () => {
    assert.equal(manifest.signature_pad.version, '2.3.2');
    assert.equal(manifest['bootstrap-icons'].version, '1.11.3');
    assert.equal(manifest.signature_pad.localModifications, 'docs/browser-assets.md#signature-pad');
    assert.deepEqual(Object.keys(manifest['bootstrap-icons'].files).sort(), [
        'LICENSE', 'font/bootstrap-icons.css', 'font/bootstrap-icons.min.css',
        'font/fonts/bootstrap-icons.woff', 'font/fonts/bootstrap-icons.woff2'
    ]);
    assert.equal(verifyBrowserAssets(), 14);
});

test('asset verifier rejects changed or missing bytes and paths outside the public root', () => {
    const publicRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-assets-'));
    const file = path.join(publicRoot, 'asset.js');
    const original = Buffer.from('fixed browser fixture');
    const fixture = { example: { version: '1.2.3', basePath: 'js', files: {
        'asset.js': crypto.createHash('sha256').update(original).digest('hex')
    } } };
    try {
        fs.mkdirSync(path.join(publicRoot, 'js'));
        fs.writeFileSync(file, original);
        fs.copyFileSync(file, path.join(publicRoot, 'js/asset.js'));
        assert.equal(verifyBrowserAssets({ publicRoot, manifest: fixture }), 1);
        fs.appendFileSync(path.join(publicRoot, 'js/asset.js'), ' changed');
        assert.throws(() => verifyBrowserAssets({ publicRoot, manifest: fixture }), /verändert/);
        fs.unlinkSync(path.join(publicRoot, 'js/asset.js'));
        assert.throws(() => verifyBrowserAssets({ publicRoot, manifest: fixture }));
        for (const basePath of ['..', '../outside', '/tmp', 'js/../../outside']) {
            assert.throws(() => verifyBrowserAssets({ publicRoot, manifest: { example: { ...fixture.example, basePath } } }), /Pfad/);
        }
        fs.symlinkSync(file, path.join(publicRoot, 'js/asset.js'));
        assert.throws(() => verifyBrowserAssets({ publicRoot, manifest: fixture }), /Symlink/);
    } finally { fs.rmSync(publicRoot, { recursive: true, force: true }); }
});
