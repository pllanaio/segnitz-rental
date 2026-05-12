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

