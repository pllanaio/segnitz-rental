'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const IMAGE_LIMITS = Object.freeze({ maxBytes: 5 * 1024 * 1024, maxPixels: 16_000_000, timeoutSeconds: 5 });
const SIGNATURE_LIMITS = Object.freeze({ maxBytes: 750_000, maxPixels: 2_000_000, timeoutSeconds: 5 });
function failure(code) { return Object.assign(new Error(code), { code }); }

async function verifyImageBytes(bytes, expectedFormat, limits = {}) {
    const { maxBytes, maxPixels, timeoutSeconds } = { ...IMAGE_LIMITS, ...limits };
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maxBytes) throw failure('RESTORE_IMAGE_LIMIT');
    try {
        const decoder = sharp(bytes, { limitInputPixels: maxPixels, failOn: 'warning', sequentialRead: true })
            .timeout({ seconds: timeoutSeconds });
        const metadata = await decoder.metadata();
        if (!['png', 'jpeg', 'webp'].includes(metadata.format) || metadata.format !== expectedFormat ||
            (metadata.pages || 1) !== 1 || !metadata.width || !metadata.height) throw failure('RESTORE_IMAGE_INVALID');
        // Reading metadata alone accepts truncated/corrupt pixel streams. Force
        // decoding of every pixel, with the same byte/pixel/time bounds.
        await decoder.raw().toBuffer();
    } catch { throw failure('RESTORE_IMAGE_INVALID'); }
}

async function verifyImageFile(file, limits = {}) {
    const { maxBytes } = { ...IMAGE_LIMITS, ...limits };
    let handle;
    let bytes;
    try {
        // No symlink following; bounded read also protects against a file growing
        // after stat. Restore probes must keep all application writers stopped.
        handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await handle.stat();
        if (!stat.isFile() || !stat.size || stat.size > maxBytes) throw failure('RESTORE_IMAGE_FILE_INVALID');
        bytes = Buffer.alloc(stat.size + 1);
        let count = 0;
        while (count < bytes.length) {
            const read = await handle.read(bytes, count, bytes.length - count, count);
            if (!read.bytesRead) break;
            count += read.bytesRead;
        }
        if (count !== stat.size) throw failure('RESTORE_IMAGE_FILE_INVALID');
        bytes = bytes.subarray(0, count);
    } catch { throw failure('RESTORE_IMAGE_FILE_INVALID'); }
    finally { if (handle) await handle.close(); }
    const extension = path.extname(file).slice(1).toLowerCase();
    await verifyImageBytes(bytes, extension === 'jpg' ? 'jpeg' : extension, limits);
}

async function verifySignature(value, limits = {}) {
    const bounds = { ...SIGNATURE_LIMITS, ...limits };
    if (typeof value !== 'string' || value.length > 32 + 4 * Math.ceil(bounds.maxBytes / 3)) throw failure('RESTORE_SIGNATURE_LIMIT');
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) throw failure('RESTORE_SIGNATURE_INVALID');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.toString('base64') !== match[2]) throw failure('RESTORE_SIGNATURE_INVALID');
    if (bytes.length > bounds.maxBytes) throw failure('RESTORE_SIGNATURE_LIMIT');
    await verifyImageBytes(bytes, match[1], bounds);
}

module.exports = { IMAGE_LIMITS, SIGNATURE_LIMITS, failure, verifyImageBytes, verifyImageFile, verifySignature };
