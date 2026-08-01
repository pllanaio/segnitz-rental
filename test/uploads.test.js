'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getSafeImageExtension,
  imageFileFilter
} = require('../utils/uploads');

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
