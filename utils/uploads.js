const path = require('path');
const multer = require('multer');

const productImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '..', 'public', 'img', 'products'));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `product_${Date.now()}_${Math.round(Math.random() * 1E9)}${ext}`);
    }
});

const uploadProductImages = multer({
    storage: productImageStorage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 10
    },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Nur Bilddateien erlaubt.'));
        }

        cb(null, true);
    }
});

module.exports = {
    uploadProductImages
};