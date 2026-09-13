'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { verifyImageBytes, verifyImageFile, verifySignature } = require('../scripts/ops/restore-images');
const { verifyBatches } = require('../scripts/ops/verify-restore');

const png = () => sharp({ create: { width: 8, height: 8, channels: 3, background: '#408080' } }).png().toBuffer();

test('restore decodes image pixels and stored signature, without changing either', async () => {
    const bytes = await png();
    await verifyImageBytes(bytes, 'png');
    await verifySignature(`data:image/png;base64,${bytes.toString('base64')}`);
    assert.equal((await sharp(bytes).metadata()).width, 8);
});

test('restore rejects corrupt pixels even when a plausible PNG header is readable', async () => {
    const bytes = await png();
    const truncated = bytes.subarray(0, bytes.length - 20);
    assert.equal((await sharp(truncated).metadata()).width, 8);
    await assert.rejects(verifyImageBytes(truncated, 'png'), { code: 'RESTORE_IMAGE_INVALID' });
});

test('restore rejects signature content mismatches and malformed base64', async () => {
    const bytes = await png();
    await assert.rejects(verifySignature(`data:image/jpeg;base64,${bytes.toString('base64')}`), { code: 'RESTORE_IMAGE_INVALID' });
    await assert.rejects(verifySignature('data:image/png;base64,c2VjcmV0LXNpZ25hdHVyZQ==='), { code: 'RESTORE_SIGNATURE_INVALID' });
    await assert.rejects(verifySignature('data:image/png;base64,!!!'), { code: 'RESTORE_SIGNATURE_INVALID' });
});

test('restore bounds compressed bytes and decoded pixels before full decoding', async () => {
    const bytes = await png();
    await assert.rejects(verifyImageBytes(bytes, 'png', { maxBytes: 16 }), { code: 'RESTORE_IMAGE_LIMIT' });
    await assert.rejects(verifyImageBytes(bytes, 'png', { maxPixels: 32 }), { code: 'RESTORE_IMAGE_INVALID' });
    await assert.rejects(verifySignature(`data:image/png;base64,${bytes.toString('base64')}`, { maxBytes: 16 }), { code: 'RESTORE_SIGNATURE_LIMIT' });
});

test('restore rejects symlink and missing image without leaking their private names', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'restore-image-test-'));
    try {
        const actual = path.join(root, 'private-person-return.png');
        const linked = path.join(root, 'linked.png');
        await fs.writeFile(actual, await png());
        await verifyImageFile(actual);
        await fs.symlink(actual, linked);
        for (const candidate of [linked, path.join(root, 'missing-private-person.png')]) {
            await assert.rejects(verifyImageFile(candidate), error => {
                assert.equal(error.code, 'RESTORE_IMAGE_FILE_INVALID');
                assert.equal(error.message, 'RESTORE_IMAGE_FILE_INVALID');
                assert.equal(error.stack.includes('private-person'), false);
                return true;
            });
        }
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('restore scans keyset batches with at most two active image decoders', async () => {
    const cursors = [];
    let active = 0;
    let maximumActive = 0;
    const values = [];
    const connection = { execute: async (sql, [cursor]) => {
        cursors.push(cursor);
        return [Array.from({ length: Math.min(3, 7 - cursor) }, (_, index) => ({ id: cursor + index + 1, value: `fixture-${cursor + index}` }))];
    } };
    const count = await verifyBatches(connection, 'rental_product_images', 'image_path', async value => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setImmediate(resolve));
        values.push(value);
        active -= 1;
    }, { batchSize: 3 });
    assert.equal(count, 7);
    assert.equal(new Set(values).size, 7);
    assert.equal(maximumActive, 2);
    assert.deepEqual(cursors, [0, 3, 6, 7]);
});

test('restore total-record cap fails explicitly instead of reporting a partial success', async () => {
    let checked = 0;
    const connection = { execute: async () => [[{ id: 1, value: 'fixture' }, { id: 2, value: 'fixture' }]] };
    await assert.rejects(verifyBatches(connection, 'rental_products', 'image_path', async () => { checked += 1; }, { maxRecords: 1 }),
        { code: 'RESTORE_VERIFY_LIMIT' });
    assert.equal(checked, 0);
});
