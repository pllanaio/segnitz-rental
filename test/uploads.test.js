'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  RETURN_IMAGE_DIRECTORY,
  ensureUploadDirectories,
  getSafeImageExtension,
  getStoredReturnImageFilename,
  imageFileFilter,
  removeUploadedFiles
} = require('../utils/uploads');

test('creates both upload directories for a fresh deployment', t => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'segnitz-uploads-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  const directories = ensureUploadDirectories(temporaryRoot);

  assert.equal(fs.statSync(directories.products).isDirectory(), true);
  assert.equal(fs.statSync(directories.returns).isDirectory(), true);
  assert.doesNotThrow(() => ensureUploadDirectories(temporaryRoot));
});

test('stores return images outside the public static tree', () => {
  const publicDirectory = path.resolve(__dirname, '../public');
  const relativePath = path.relative(publicDirectory, RETURN_IMAGE_DIRECTORY);

  assert.equal(relativePath.startsWith(`..${path.sep}`), true);
});

test('accepts only flat allowlisted return-image paths from the database', () => {
  assert.equal(
    getStoredReturnImageFilename('img/returns/return_item_1_123_test-id.webp'),
    'return_item_1_123_test-id.webp'
  );
  assert.equal(getStoredReturnImageFilename('img/returns/../../config/db.js'), null);
  assert.equal(getStoredReturnImageFilename('img/returns/evil.svg'), null);
  assert.equal(getStoredReturnImageFilename('public/img/returns/test.jpg'), null);
});

test('removes newly written files when an upload cannot be committed', async t => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'segnitz-upload-cleanup-'));
  const firstFile = path.join(temporaryRoot, 'first.png');
  const secondFile = path.join(temporaryRoot, 'second.jpg');
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  fs.writeFileSync(firstFile, 'first');
  fs.writeFileSync(secondFile, 'second');

  await removeUploadedFiles([
    { path: firstFile },
    { path: secondFile },
    { path: path.join(temporaryRoot, 'already-missing.webp') },
    null
  ]);

  assert.equal(fs.existsSync(firstFile), false);
  assert.equal(fs.existsSync(secondFile), false);
});

test('maps allowed image MIME types to controlled extensions', () => {
  assert.equal(getSafeImageExtension('image/jpeg'), '.jpg');
  assert.equal(getSafeImageExtension('image/png'), '.png');
  assert.equal(getSafeImageExtension('image/webp'), '.webp');
});

test('does not trust executable or generic upload MIME types', () => {
  assert.equal(getSafeImageExtension('image/svg+xml'), null);
  assert.equal(getSafeImageExtension('text/html'), null);
  assert.equal(getSafeImageExtension('application/octet-stream'), null);
});

test('accepts an allowed product image', async () => {
  const result = await new Promise((resolve, reject) => {
    imageFileFilter({}, { mimetype: 'image/png' }, (error, accepted) => {
      if (error) return reject(error);
      return resolve(accepted);
    });
  });

  assert.equal(result, true);
});

test('rejects an unsupported product image', async () => {
  const error = await new Promise(resolve => {
    imageFileFilter({}, { mimetype: 'image/svg+xml' }, resolve);
  });

  assert.equal(error.code, 'INVALID_IMAGE_TYPE');
  assert.match(error.message, /JPEG-, PNG- und WebP/);
});
