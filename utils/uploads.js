'use strict';

const crypto = require('crypto');
const path = require('path');
const multer = require('multer');

const ALLOWED_IMAGE_TYPES = new Map([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp']
]);

function getSafeImageExtension(mimetype) {
    return ALLOWED_IMAGE_TYPES.get(String(mimetype || '').toLowerCase()) || null;
}

function imageFileFilter(req, file, cb) {
    if (!getSafeImageExtension(file?.mimetype)) {
        const error = new Error('Nur JPEG-, PNG- und WebP-Bilder sind erlaubt.');
        error.code = 'INVALID_IMAGE_TYPE';
        return cb(error);
    }

    return cb(null, true);
}

const productImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '..', 'public', 'img', 'products'));
    },
    filename: (req, file, cb) => {
        const extension = getSafeImageExtension(file.mimetype);

        if (!extension) {
            return cb(new Error('Ungültiger Bildtyp.'));
        }

        return cb(null, `product_${Date.now()}_${crypto.randomUUID()}${extension}`);
    }
});

const uploadProductImages = multer({
    storage: productImageStorage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 10,
        fields: 20,
        parts: 30
    },
    fileFilter: imageFileFilter
});

module.exports = {
    ALLOWED_IMAGE_TYPES,
    getSafeImageExtension,
    imageFileFilter,
    uploadProductImages
};
