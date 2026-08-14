'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  LEGACY_FRONTEND_PAGES,
  assertFrontendBuild,
  getExportedPagePath,
  getFrontendDirectory,
  readFrontendCspHashes
} = require('../services/frontendAssets');

function createExport() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'segnitz-frontend-'));
  fs.mkdirSync(path.join(directory, '_next', 'static'), { recursive: true });
  for (const page of LEGACY_FRONTEND_PAGES) {
    fs.writeFileSync(getExportedPagePath(directory, page), '<!doctype html>', 'utf8');
  }
  fs.writeFileSync(path.join(directory, 'csp-script-hashes.json'), JSON.stringify({
    scriptSrc: ["'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='"]
  }), 'utf8');
  return directory;
}

test('resolves an explicitly configured immutable frontend directory', () => {
  assert.equal(
    getFrontendDirectory({ FRONTEND_DIST_DIR: './custom-dist' }, '/tmp/project'),
    path.resolve('/tmp/project/custom-dist')
  );
});

test('maps logical legacy routes to the matching double-extension export', () => {
  assert.equal(
    getExportedPagePath('/app/frontend-dist', 'login.html'),
    path.join('/app/frontend-dist', 'login.html.html')
  );
  assert.throws(() => getExportedPagePath('/app/frontend-dist', '../secret'), /Unbekannte/);
});

test('accepts only complete exports with valid CSP hashes', t => {
  const directory = createExport();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  assert.doesNotThrow(() => assertFrontendBuild(directory, { required: true }));
  assert.deepEqual(readFrontendCspHashes(directory, { required: true }), [
    "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='"
  ]);

  fs.unlinkSync(getExportedPagePath(directory, 'backend.html'));
  assert.throws(
    () => assertFrontendBuild(directory, { required: true }),
    /backend\.html/
  );
});

test('fails closed for malformed or empty production CSP manifests', t => {
  const directory = createExport();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  fs.writeFileSync(
    path.join(directory, 'csp-script-hashes.json'),
    JSON.stringify({ scriptSrc: ["'unsafe-inline'"] }),
    'utf8'
  );
  assert.throws(() => readFrontendCspHashes(directory, { required: true }), /ungültigen/);

  fs.writeFileSync(
    path.join(directory, 'csp-script-hashes.json'),
    JSON.stringify({ scriptSrc: [] }),
    'utf8'
  );
  assert.throws(() => readFrontendCspHashes(directory, { required: true }), /keine Inline/);
});
