'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const sharp = require('sharp');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { createImageUpload, normalizeImage, normalizeSignatureDataUrl, validatePositiveId } = require('../utils/uploads');
const { jsonErrors } = require('../middleware/jsonErrors');

async function png(width = 20, height = 20) {
    return sharp({ create: { width, height, channels: 3, background: '#fff' } }).png().toBuffer();
}

test('decodes image contents, rejects MIME mismatch and strips metadata by re-encoding', async () => {
    await assert.rejects(normalizeImage(Buffer.from('not a PNG'), 'image/png'), { code: 'INVALID_IMAGE_CONTENT' });
    await assert.rejects(normalizeImage(await png(), 'image/jpeg'), { code: 'INVALID_IMAGE_CONTENT' });
    const input = await sharp(await png()).withExif({ IFD0: { Artist: 'private-test-metadata' } }).png().toBuffer();
    const output = await normalizeImage(input, 'image/png');
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined);
    assert.equal(output.includes(Buffer.from('private-test-metadata')), false);
});

test('signatures require actual bounded image decoding', async () => {
    await assert.rejects(normalizeSignatureDataUrl('data:image/png;base64,dGVzdA=='), { code: 'INVALID_IMAGE_CONTENT' });
    const normalized = await normalizeSignatureDataUrl(`data:image/png;base64,${(await png()).toString('base64')}`);
    assert.match(normalized, /^data:image\/png;base64,/u);
    const tooManyPixels = await png(1500, 1500);
    await assert.rejects(normalizeSignatureDataUrl(`data:image/png;base64,${tooManyPixels.toString('base64')}`), { code: 'INVALID_IMAGE_CONTENT' });
});

test('real multipart requests validate IDs before storage and return JSON failures without files', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'segnitz-upload-content-test-'));
    const app = express();
    app.use(express.json({ limit: '1kb' }));
    app.post('/image/:itemId', validatePositiveId('itemId'), createImageUpload(root).array('images', 10), (req, res) => res.json({ files: req.files.map(file => file.filename) }));
    app.use(jsonErrors);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (id, buffer, type = 'image/png', extraField) => {
        const form = new FormData();
        form.append('images', new Blob([buffer], { type }), '../../untrusted.png');
        if (extraField) form.append(extraField, 'value');
        return fetch(`${base}/image/${id}`, { method: 'POST', body: form, signal: AbortSignal.timeout(3000) });
    };
    for (const id of ['0', '-1', '1e3', '9007199254740992', 'foo%2Fbar', '01']) {
        const response = await request(id, await png());
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, 'INVALID_ID');
        assert.deepEqual(await fs.readdir(root), []);
    }
    for (const [buffer, type] of [[Buffer.from('not png'), 'image/png'], [await png(), 'image/jpeg'], [Buffer.from('<svg/>'), 'image/svg+xml']]) {
        const response = await request('1', buffer, type);
        assert.equal(response.status, 415);
        assert.equal(response.headers.get('content-type').includes('application/json'), true);
        assert.deepEqual(await fs.readdir(root), []);
    }
    const oversize = await request('1', Buffer.alloc(5 * 1024 * 1024 + 1));
    assert.equal(oversize.status, 413);
    assert.deepEqual(await fs.readdir(root), []);
    const hugeIndex = await request('1', await png(), 'image/png', 'field[999999999999]');
    assert.equal(hugeIndex.status, 400);
    assert.deepEqual(await fs.readdir(root), []);
    const interrupted = http.request(`${base}/image/1`, { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=interrupted-test' } });
    interrupted.on('error', () => {});
    interrupted.write('--interrupted-test\r\nContent-Disposition: form-data; name="images"; filename="one.png"\r\nContent-Type: image/png\r\n\r\n');
    interrupted.write(await png());
    interrupted.write('\r\n--interrupted-test\r\nContent-Disposition: form-data; name="images"; filename="two.png"\r\nContent-Type: image/png\r\n\r\n');
    await delay(20);
    interrupted.destroy();
    await delay(50);
    assert.deepEqual(await fs.readdir(root), []);
    const nestedField = await request('1', await png(), 'image/png', 'field[a][b][c][d][e]');
    assert.equal(nestedField.status, 400);
    assert.equal((await nestedField.json()).code, 'LIMIT_FIELD_NESTING');
    assert.deepEqual(await fs.readdir(root), []);
    const stalled = Array.from({ length: 4 }, () => {
        const upload = http.request(`${base}/image/1`, { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=slow-test' } });
        upload.on('error', () => {});
        upload.write('--slow-test\r\nContent-Disposition: form-data; name="images"; filename="slow.png"\r\nContent-Type: image/png\r\n\r\npartial');
        return upload;
    });
    await delay(30);
    try {
        const overloaded = await request('1', await png());
        assert.equal(overloaded.status, 503);
        assert.equal(overloaded.headers.get('retry-after'), '2');
    } finally { for (const upload of stalled) upload.destroy(); }
    await delay(50);
    assert.deepEqual(await fs.readdir(root), []);
    const success = await request('1', await png());
    assert.equal(success.status, 200);
    const result = await success.json();
    assert.match(result.files[0], /^[a-f0-9-]{36}\.webp$/u);
    assert.deepEqual(await fs.readdir(root), result.files);
    const badJson = await fetch(`${base}/image/1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert.equal(badJson.status, 400);
    assert.equal((await badJson.json()).code, 'entity.parse.failed');
    const hugeJson = await fetch(`${base}/image/1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ large: 'x'.repeat(2048) }) });
    assert.equal(hugeJson.status, 413);
    assert.equal((await hugeJson.json()).code, 'entity.too.large');
    const wrongCharset = await fetch(`${base}/image/1`, { method: 'POST', headers: { 'content-type': 'application/json; charset=iso-8859-1' }, body: '{}' });
    assert.equal(wrongCharset.status, 415);
    assert.equal((await wrongCharset.json()).code, 'charset.unsupported');

});
