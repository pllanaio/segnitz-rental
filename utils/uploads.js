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
        error.statusCode = 415;
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

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16 * 1000 * 1000;
const MAX_ACTIVE_DECODES = 4;
const MAX_ACTIVE_UPLOAD_REQUESTS = 4;
let activeUploadRequests = 0;
let activeDecodes = 0;

function uploadError(code, message, statusCode) {
    return Object.assign(new Error(message), { code, statusCode });
}

function validatePositiveId(param) {
    return (req, res, next) => {
        const value = req.params?.[param];
        if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
            return res.status(400).json({ error: 'Ungültige Kennung.', code: 'INVALID_ID' });
        }
        return next();
    };
}

async function normalizeImage(buffer, mimetype, { signature = false } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
        throw uploadError('IMAGE_SIZE', 'Das Bild ist leer oder zu groß.', 413);
    }
    if (!getSafeImageExtension(mimetype)) throw uploadError('INVALID_IMAGE_TYPE', 'Ungültiger Bildtyp.', 415);
    if (activeDecodes >= MAX_ACTIVE_DECODES) throw uploadError('IMAGE_BUSY', 'Bildverarbeitung ausgelastet. Bitte erneut versuchen.', 503);
    activeDecodes += 1;
    try {
        const sharp = require('sharp');
        const input = sharp(buffer, { limitInputPixels: signature ? 2_000_000 : MAX_IMAGE_PIXELS, failOn: 'warning', animated: false });
        const metadata = await input.metadata();
        const expected = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[mimetype];
        if (metadata.format !== expected || (metadata.pages || 1) !== 1 || !metadata.width || !metadata.height) {
            throw uploadError('INVALID_IMAGE_CONTENT', 'Bildinhalt und Dateityp stimmen nicht überein.', 415);
        }
        // Decoding and re-encoding strips EXIF/XMP/GPS and trailing or polyglot payloads.
        const normalized = signature ? input.rotate().png() : input.rotate().webp({ quality: 85 });
        const result = await normalized.toBuffer();
        if (result.length > MAX_IMAGE_BYTES) throw uploadError('IMAGE_SIZE', 'Das normalisierte Bild ist zu groß.', 413);
        return result;
    } catch (error) {
        if (error.statusCode) throw error;
        throw uploadError('INVALID_IMAGE_CONTENT', 'Die Bilddatei ist beschädigt oder überschreitet die Pixelgrenze.', 415);
    } finally {
        activeDecodes -= 1;
    }
}

async function normalizeSignatureDataUrl(value) {
    if (typeof value !== 'string' || value.length > 750000) throw uploadError('INVALID_SIGNATURE', 'Ungültige Unterschrift.', 400);
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
    if (!match || match[2].length % 4 !== 0) throw uploadError('INVALID_SIGNATURE', 'Ungültige Unterschrift.', 400);
    const decoded = Buffer.from(match[2], 'base64');
    if (decoded.toString('base64') !== match[2]) throw uploadError('INVALID_SIGNATURE', 'Ungültige Unterschrift.', 400);
    const normalized = await normalizeImage(decoded, match[1], { signature: true });
    return `data:image/png;base64,${normalized.toString('base64')}`;
}

function createImageUpload(directory) {
    const storage = {
        _handleFile(req, file, callback) {
            let completed = false;
            const done = (error, result) => {
                if (completed) return;
                completed = true;
                callback(error, result);
            };
            const chunks = [];
            let size = 0;
            let failure = null;
            file.stream.on('data', chunk => {
                size += chunk.length;
                req.imageBytes = (req.imageBytes || 0) + chunk.length;
                if (size > MAX_IMAGE_BYTES || req.imageBytes > MAX_REQUEST_IMAGE_BYTES) {
                    failure = uploadError('IMAGE_SIZE', 'Maximal 5 MB pro Bild und 20 MB je Anfrage erlaubt.', 413);
                }
                if (!failure) chunks.push(chunk);
            });
            file.stream.once('error', error => done(error));
            file.stream.once('end', async () => {
                if (completed) return;
                if (failure) return done(failure);
                const filename = `${crypto.randomUUID()}.webp`;
                const finalPath = path.join(directory, filename);
                const stagingPath = path.join(directory, `.${filename}.part`);
                try {
                    const normalized = await normalizeImage(Buffer.concat(chunks), file.mimetype);
                    if (completed) return;
                    if (req.aborted) throw uploadError('UPLOAD_ABORTED', 'Upload wurde abgebrochen.', 400);
                    await fs.promises.writeFile(stagingPath, normalized, { flag: 'wx', mode: 0o640 });
                    await fs.promises.rename(stagingPath, finalPath);
                    if (req.aborted || completed) throw uploadError('UPLOAD_ABORTED', 'Upload wurde abgebrochen.', 400);
                    done(null, { destination: directory, filename, path: finalPath, size: normalized.length });
                } catch (error) {
                    await removeUploadedFiles([{ path: stagingPath }, { path: finalPath }]);
                    done(error);
                }
            });
        },
        _removeFile(req, file, callback) {
            if (!file.path) return callback(null);
            fs.unlink(file.path, error => callback(error?.code === 'ENOENT' ? null : error));
        }
    };
    const upload = multer({ storage, limits: { fileSize: MAX_IMAGE_BYTES, files: 10, fields: 20, parts: 30, fieldArrayIndexLimit: 100, fieldNestingDepth: 4 }, fileFilter: imageFileFilter });
    return {
        array(field, count) {
            const parse = upload.array(field, count);
            return (req, res, next) => {
                if (activeUploadRequests >= MAX_ACTIVE_UPLOAD_REQUESTS) {
                    return next(uploadError('IMAGE_BUSY', 'Bildverarbeitung ausgelastet. Bitte erneut versuchen.', 503));
                }
                activeUploadRequests += 1;
                let released = false;
                const release = () => {
                    if (released) return;
                    released = true;
                    activeUploadRequests -= 1;
                    req.off('aborted', release);
                };
                req.once('aborted', release);
                parse(req, res, error => { release(); next(error); });
            };
        }
    };
}

const uploadProductImages = createImageUpload(PRODUCT_IMAGE_DIRECTORY);
const uploadReturnImages = createImageUpload(RETURN_IMAGE_DIRECTORY);

module.exports = {
    ALLOWED_IMAGE_TYPES,
    PRODUCT_IMAGE_DIRECTORY,
    RETURN_IMAGE_DIRECTORY,
    MAX_IMAGE_BYTES,
    MAX_REQUEST_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
    createImageUpload,
    ensureUploadDirectories,
    getSafeImageExtension,
    getStoredReturnImageFilename,
    imageFileFilter,
    normalizeImage,
    normalizeSignatureDataUrl,
    removeUploadedFiles,
    uploadProductImages,
    uploadReturnImages,
    validatePositiveId
};
