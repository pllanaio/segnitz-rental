const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const dbConfig = require('../config/db');
const { checkAdmin } = require('../middleware/auth');
const { syncProductCategories } = require('../utils/categories');
const { uploadProductImages } = require('../utils/uploads');

module.exports = router;

router.get('/categories', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(`
            SELECT
                id,
                name,
                slug
            FROM rental_categories
            ORDER BY name ASC
        `);

        res.json(rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: 'Kategorien konnten nicht geladen werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

router.get('/products', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [products] = await connection.execute(`
            SELECT
                p.*,
                COALESCE(ROUND(AVG(pr.rating), 1), 0) AS average_rating,
                COUNT(pr.id) AS review_count
            FROM rental_products p
            LEFT JOIN product_reviews pr ON pr.product_id = p.id
            GROUP BY p.id
            ORDER BY p.title ASC
        `);

        const [images] = await connection.execute(`
            SELECT id, product_id, image_path, sort_order
            FROM rental_product_images
            ORDER BY product_id ASC, sort_order ASC, id ASC
        `);

        const [categoryRows] = await connection.execute(`
            SELECT
                rpc.product_id,
                c.id,
                c.name,
                c.slug
            FROM rental_product_categories rpc
            JOIN rental_categories c
                ON c.id = rpc.category_id
            ORDER BY c.name ASC
        `);

        const categoriesByProductId = {};

        categoryRows.forEach(row => {
            if (!categoriesByProductId[row.product_id]) {
                categoriesByProductId[row.product_id] = [];
            }

            categoriesByProductId[row.product_id].push({
                id: row.id,
                name: row.name,
                slug: row.slug
            });
        });

        const productsWithImagesAndCategories = products.map(product => {
            const productImages = images
                .filter(image => image.product_id === product.id)
                .map(image => ({
                    id: image.id,
                    path: image.image_path
                }));

            const categories =
                categoriesByProductId[product.id] || [];

            return {
                ...product,
                images: productImages,
                image_path: productImages[0]?.path || product.image_path || '',
                categories,
                category: categories[0]?.name || product.category || ''
            };
        });

        res.json(productsWithImagesAndCategories);

    } catch (error) {
        console.error('Fehler beim Laden der Produkte:', error);
        res.status(500).json({
            error: 'Produkte konnten nicht geladen werden.'
        });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/products/:id/availability', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const [blockedPeriods] = await connection.execute(
            `SELECT 
        DATE_FORMAT(COALESCE(roi.adjusted_rental_start, roi.rental_start), '%Y-%m-%d') AS rentalStart,
        DATE_FORMAT(COALESCE(roi.adjusted_rental_end, roi.rental_end), '%Y-%m-%d') AS rentalEnd
     FROM rental_order_items roi
     JOIN rental_orders ro ON ro.id = roi.order_id
     WHERE roi.product_id = ?
     AND ro.status IN ('reserved', 'paid', 'confirmed', 'active')
     AND (ro.status != 'reserved' OR ro.reserved_until > NOW())
     AND roi.returned_at IS NULL
     AND COALESCE(roi.item_status, 'active') != 'cancelled'
     ORDER BY COALESCE(roi.adjusted_rental_start, roi.rental_start) ASC`,
            [req.params.id]
        );

        res.json(blockedPeriods);
    } catch (error) {
        console.error('Fehler beim Laden der Produktverfügbarkeit:', error);
        res.status(500).json({
            error: 'Produktverfügbarkeit konnte nicht geladen werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

router.post('/products', checkAdmin, async (req, res) => {
    const { productKey, title, description, pricePerDay, deposit, imagePath, category, categories } = req.body;

    const normalizedPricePerDay = Number(String(pricePerDay).replace(',', '.'));
    const normalizedDeposit = Number(String(deposit).replace(',', '.'));

    if (!productKey || !title) {
        return res.status(400).json({ error: 'Produkt-Key und Titel sind Pflichtfelder.' });
    }

    if (
        Number.isNaN(normalizedPricePerDay) ||
        Number.isNaN(normalizedDeposit) ||
        normalizedPricePerDay < 0 ||
        normalizedDeposit < 0 ||
        normalizedPricePerDay > 999999.99 ||
        normalizedDeposit > 999999.99
    ) {
        return res.status(400).json({
            error: 'Preis und Kaution müssen zwischen 0 und 999999.99 liegen.'
        });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const normalizedCategories = Array.isArray(categories)
            ? categories
            : (category ? [category] : []);

        const [result] = await connection.execute(
            `INSERT INTO rental_products 
             (product_key, title, description, price_per_day, deposit, image_path, category)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                productKey,
                title,
                description,
                normalizedPricePerDay,
                normalizedDeposit,
                imagePath || '',
                normalizedCategories[0] || null
            ]
        );

        await syncProductCategories(connection, result.insertId, normalizedCategories);

        await connection.commit();

        res.status(201).json({
            message: 'Produkt erstellt',
            productId: result.insertId
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Fehler beim Erstellen des Produkts:', error);
        res.status(500).json({ error: 'Produkt konnte nicht gespeichert werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/products/:id', checkAdmin, async (req, res) => {
    const { title, description, pricePerDay, deposit, imagePath, isActive, category, categories } = req.body;

    const normalizedPricePerDay = Number(String(pricePerDay).replace(',', '.'));
    const normalizedDeposit = Number(String(deposit).replace(',', '.'));

    if (!title) {
        return res.status(400).json({ error: 'Titel ist ein Pflichtfeld.' });
    }

    if (
        Number.isNaN(normalizedPricePerDay) ||
        Number.isNaN(normalizedDeposit) ||
        normalizedPricePerDay < 0 ||
        normalizedDeposit < 0 ||
        normalizedPricePerDay > 999999.99 ||
        normalizedDeposit > 999999.99
    ) {
        return res.status(400).json({
            error: 'Preis und Kaution müssen zwischen 0 und 999999.99 liegen.'
        });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const normalizedCategories = Array.isArray(categories)
            ? categories
            : (category ? [category] : []);

        await connection.execute(
            `UPDATE rental_products
             SET title = ?,
                 description = ?,
                 price_per_day = ?,
                 deposit = ?,
                 image_path = ?,
                 is_active = ?,
                 category = ?
             WHERE id = ?`,
            [
                title,
                description,
                normalizedPricePerDay,
                normalizedDeposit,
                imagePath || '',
                isActive ? 1 : 0,
                normalizedCategories[0] || null,
                req.params.id
            ]
        );

        await syncProductCategories(connection, req.params.id, normalizedCategories);

        await connection.commit();

        res.json({ message: 'Produkt aktualisiert' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Fehler beim Aktualisieren des Produkts:', error);
        res.status(500).json({ error: 'Produkt konnte nicht aktualisiert werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.delete('/products/:id', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        // 1. Alle Bilder vorher holen
        const [images] = await connection.execute(
            'SELECT image_path FROM rental_product_images WHERE product_id = ?',
            [req.params.id]
        );

        // 2. Produkt löschen (CASCADE löscht DB-Bilder)
        await connection.execute(
            'DELETE FROM rental_products WHERE id = ?',
            [req.params.id]
        );

        // 3. Dateien auf der Festplatte löschen
        for (const image of images) {
            const filePath = path.join(__dirname, 'public', image.image_path);

            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log('Bild gelöscht:', filePath);
                } else {
                    console.warn('Datei nicht gefunden:', filePath);
                }
            } catch (fileError) {
                console.error('Fehler beim Löschen der Datei:', filePath, fileError);
            }
        }

        res.json({ message: 'Produkt und Bilder gelöscht.' });

    } catch (error) {
        console.error('Fehler beim Löschen des Produkts:', error);
        res.status(500).json({ error: 'Produkt konnte nicht gelöscht werden.' });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

router.post('/products/:id/images', checkAdmin, uploadProductImages.array('images', 10), async (req, res) => {
    const productId = req.params.id;

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [existingImages] = await connection.execute(
            'SELECT COUNT(*) AS count FROM rental_product_images WHERE product_id = ?',
            [productId]
        );

        const existingCount = existingImages[0].count;
        const uploadCount = req.files.length;

        if (existingCount + uploadCount > 10) {
            return res.status(400).json({
                error: 'Maximal 10 Bilder pro Produkt erlaubt.'
            });
        }

        for (let i = 0; i < req.files.length; i++) {
            const imagePath = `img/products/${req.files[i].filename}`;

            await connection.execute(
                `INSERT INTO rental_product_images 
                 (product_id, image_path, sort_order)
                 VALUES (?, ?, ?)`,
                [productId, imagePath, existingCount + i]
            );
        }

        res.json({ message: 'Bilder erfolgreich hochgeladen.' });

    } catch (error) {
        console.error('Fehler beim Bilderupload:', error);
        res.status(500).json({ error: 'Bilder konnten nicht hochgeladen werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/products/:id/images/order', checkAdmin, async (req, res) => {
    const productId = req.params.id;
    const { imageIds } = req.body;

    if (!Array.isArray(imageIds)) {
        return res.status(400).json({ error: 'Ungültige Bildreihenfolge.' });
    }

    if (imageIds.length > 10) {
        return res.status(400).json({ error: 'Maximal 10 Bilder pro Produkt erlaubt.' });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        for (let index = 0; index < imageIds.length; index++) {
            await connection.execute(
                `UPDATE rental_product_images
                 SET sort_order = ?
                 WHERE id = ? AND product_id = ?`,
                [index, imageIds[index], productId]
            );
        }

        res.json({ message: 'Bildreihenfolge gespeichert.' });
    } catch (error) {
        console.error('Fehler beim Speichern der Bildreihenfolge:', error);
        res.status(500).json({ error: 'Bildreihenfolge konnte nicht gespeichert werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.delete('/product-images/:id', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(
            'SELECT image_path FROM rental_product_images WHERE id = ?',
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Bild nicht gefunden.' });
        }

        const imagePath = path.join(__dirname, 'public', rows[0].image_path);

        await connection.execute(
            'DELETE FROM rental_product_images WHERE id = ?',
            [req.params.id]
        );

        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }

        res.json({ message: 'Bild gelöscht.' });
    } catch (error) {
        console.error('Fehler beim Löschen des Bildes:', error);
        res.status(500).json({ error: 'Bild konnte nicht gelöscht werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/products/bestsellers', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [products] = await connection.execute(`
    SELECT
        p.*,
        COALESCE(ROUND(AVG(pr.rating), 1), 0) AS average_rating,
        COUNT(pr.id) AS review_count
    FROM rental_products p
    LEFT JOIN product_reviews pr ON pr.product_id = p.id
    WHERE p.is_active = 1
    AND COALESCE(p.times_ordered, 0) > 0
    GROUP BY p.id
    ORDER BY p.times_ordered DESC
    LIMIT 6
`);

        const [images] = await connection.execute(
            `SELECT id, product_id, image_path, sort_order
             FROM rental_product_images
             ORDER BY product_id ASC, sort_order ASC, id ASC`
        );

        const productsWithImages = products.map(product => {
            const productImages = images
                .filter(image => image.product_id === product.id)
                .map(image => ({
                    id: image.id,
                    path: image.image_path
                }));

            return {
                ...product,
                images: productImages,
                image_path: productImages[0]?.path || product.image_path || ''
            };
        });

        res.json(productsWithImages);

    } catch (error) {
        console.error('Fehler beim Laden der Bestseller:', error);
        res.status(500).json({ error: 'Bestseller konnten nicht geladen werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/products/:id/current-availability', async (req, res) => {
    let connection;

    try {
        const productId = req.params.id;
        const today = new Date().toISOString().split('T')[0];

        connection = await mysql.createConnection(dbConfig);

        const available = await checkProductAvailability(
            connection,
            productId,
            today,
            today
        );

        return res.json({
            productId,
            available
        });

    } catch (error) {
        console.error('Fehler beim Prüfen der Produktverfügbarkeit:', error);

        return res.status(500).json({
            error: 'Verfügbarkeit konnte nicht geprüft werden.'
        });

    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

router.get('/products/:id/reviews', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [reviews] = await connection.execute(
            `SELECT
                pr.id,
                pr.product_id AS productId,
                pr.order_id AS orderId,
                pr.user_email AS userEmail,
                pr.rating,
                pr.review_text AS reviewText,
                DATE_FORMAT(pr.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
                u.first_name AS firstName,
                u.last_name AS lastName
             FROM product_reviews pr
             LEFT JOIN users u ON u.username = pr.user_email
             WHERE pr.product_id = ?
             ORDER BY pr.created_at DESC`,
            [req.params.id]
        );

        res.json(reviews);
    } catch (error) {
        console.error('Fehler beim Laden der Produktbewertungen:', error);
        res.status(500).json({ error: 'Produktbewertungen konnten nicht geladen werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.post('/products/:id/reviews', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Nicht angemeldet.' });
    }

    const productId = Number(req.params.id);
    const { orderId, rating, reviewText } = req.body;

    const normalizedRating = Number(rating);

    if (!productId || !orderId || !normalizedRating) {
        return res.status(400).json({ error: 'Produkt, Bestellung und Bewertung sind erforderlich.' });
    }

    if (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
        return res.status(400).json({ error: 'Die Bewertung muss zwischen 1 und 5 Sternen liegen.' });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [eligibleOrders] = await connection.execute(
            `SELECT ro.id
             FROM rental_orders ro
             JOIN rental_order_items roi ON roi.order_id = ro.id
             WHERE ro.id = ?
             AND ro.customer_email = ?
             AND roi.product_id = ?
             AND roi.item_status LIKE 'returned_%'
             LIMIT 1`,
            [orderId, req.session.user, productId]
        );

        if (eligibleOrders.length === 0) {
            return res.status(403).json({
                error: 'Dieses Produkt kann nur nach einer zurückgegebenen eigenen Bestellung bewertet werden.'
            });
        }

        const [existingReviews] = await connection.execute(
            `SELECT id
     FROM product_reviews
     WHERE product_id = ?
     AND order_id = ?
     AND user_email = ?
     LIMIT 1`,
            [productId, orderId, req.session.user]
        );

        if (existingReviews.length > 0) {
            return res.status(409).json({
                error: 'Sie haben dieses Produkt für diese Bestellung bereits bewertet.'
            });
        }

        await connection.execute(
            `INSERT INTO product_reviews
     (product_id, order_id, user_email, rating, review_text)
     VALUES (?, ?, ?, ?, ?)`,
            [
                productId,
                orderId,
                req.session.user,
                normalizedRating,
                reviewText ? String(reviewText).trim() : null
            ]
        );

        res.json({ message: 'Bewertung wurde gespeichert.' });
    } catch (error) {
        console.error('Fehler beim Speichern der Produktbewertung:', error);
        res.status(500).json({ error: 'Bewertung konnte nicht gespeichert werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/my-reviews', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Nicht angemeldet.' });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [reviews] = await connection.execute(
            `SELECT
                pr.id,
                pr.product_id AS productId,
                pr.order_id AS orderId,
                pr.rating,
                pr.review_text AS reviewText,
                DATE_FORMAT(pr.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
                DATE_FORMAT(pr.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt,
                p.title AS productTitle,
                ro.order_no AS orderNo
             FROM product_reviews pr
             JOIN rental_products p ON p.id = pr.product_id
             JOIN rental_orders ro ON ro.id = pr.order_id
             WHERE pr.user_email = ?
             ORDER BY pr.updated_at DESC`,
            [req.session.user]
        );

        res.json(reviews);
    } catch (error) {
        console.error('Fehler beim Laden eigener Bewertungen:', error);
        res.status(500).json({ error: 'Eigene Bewertungen konnten nicht geladen werden.' });
    } finally {
        if (connection) await connection.end();
    }
});