'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { RETURN_IMAGE_DIRECTORY, getStoredReturnImageFilename } = require('../utils/uploads');

// Reserve space for signature, PDF overhead and Graph's base64 JSON envelope.
const PHOTO_BUDGET_BYTES = 1_200_000;

async function compressReturnPhoto(input, maxBytes) {
    for (const size of [1600, 1280, 1024, 800, 640, 480, 320, 160]) {
        const image = await sharp(input, { limitInputPixels: 80_000_000 })
            .rotate()
            .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: 76, mozjpeg: true })
            .toBuffer();
        if (image.length <= maxBytes) return image;
    }
    throw new Error('Die Rückgabefotos sind zu groß für den Mailbeleg.');
}

async function captureReturnPhotos(connection, orderId, itemIds) {
    const [rows] = await connection.execute(
        `SELECT id, order_item_id, image_path FROM rental_order_return_images
         WHERE order_id = ? AND order_item_id IN (${itemIds.map(() => '?').join(',')}) ORDER BY id`,
        [orderId, ...itemIds]
    );
    const photos = [];
    for (const row of rows) {
        const filename = getStoredReturnImageFilename(row.image_path);
        if (!filename) throw new Error(`Ungültiger Pfad für Rückgabefoto ${row.id}.`);
        const input = await fs.readFile(path.join(RETURN_IMAGE_DIRECTORY, filename));
        const image = await compressReturnPhoto(input, Math.floor(PHOTO_BUDGET_BYTES / rows.length));
        // Freeze image bytes at return finalization; retries must not depend on
        // later filesystem changes or make private image URLs publicly readable.
        photos.push({ id: row.id, itemId: row.order_item_id, contentBase64: image.toString('base64') });
    }
    return photos;
}

module.exports = { compressReturnPhoto, captureReturnPhotos, PHOTO_BUDGET_BYTES };
