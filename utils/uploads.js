'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PUBLIC_IMAGE_ROOT_DIRECTORY = path.join(__dirname, '..', 'public', 'img');
const PRIVATE_UPLOAD_ROOT_DIRECTORY = path.join(__dirname, '..', 'uploads');
const PRODUCT_IMAGE_DIRECTORY = path.join(PUBLIC_IMAGE_ROOT_DIRECTORY, 'products');
const RETURN_IMAGE_DIRECTORY = path.join(PRIVATE_UPLOAD_ROOT_DIRECTORY, 'returns');

const ALLOWED_IMAGE_TYPES = new Map([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp']
]);

function getSafeImageExtension(mimetype) {
    return ALLOWED_IMAGE_TYPES.get(String(mimetype || '').toLowerCase()) || null;
}

function getStoredReturnImageFilename(imagePath) {
    const normalizedPath = String(imagePath || '').replace(/\\/gu, '/');
    const prefix = 'img/returns/';

    if (!normalizedPath.startsWith(prefix)) return null;

    const filename = normalizedPath.slice(prefix.length);
    if (
        !filename ||
        filename !== path.posix.basename(filename) ||
        !/^[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/iu.test(filename)
    ) {
        return null;
    }

    return filename;
}

function imageFileFilter(req, file, cb) {
    if (!getSafeImageExtension(file?.mimetype)) {
        const error = new Error('Nur JPEG-, PNG- und WebP-Bilder sind erlaubt.');
        error.code = 'INVALID_IMAGE_TYPE';
        return cb(error);
    }

    return cb(null, true);
}

function ensureUploadDirectories(uploadRoot = null) {
    const directories = uploadRoot
        ? {
            products: path.join(uploadRoot, 'products'),
            returns: path.join(uploadRoot, 'returns')
        }
        : {
            products: PRODUCT_IMAGE_DIRECTORY,
            returns: RETURN_IMAGE_DIRECTORY
        };

    for (const directory of Object.values(directories)) {
        fs.mkdirSync(directory, {
            recursive: true,
            mode: 0o750
        });
    }

    return directories;
}

async function removeUploadedFiles(files = []) {
    await Promise.allSettled(
        files
            .map(file => file?.path)
            .filter(Boolean)
            .map(filePath => fs.promises.unlink(filePath))
    );
}

ensureUploadDirectories();

const productImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, PRODUCT_IMAGE_DIRECTORY);
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
    PRODUCT_IMAGE_DIRECTORY,
    RETURN_IMAGE_DIRECTORY,
    ensureUploadDirectories,
    getSafeImageExtension,
    getStoredReturnImageFilename,
    imageFileFilter,
    removeUploadedFiles,
    uploadProductImages
};
