const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

const dbConfig = require('../config/db');
const { runDatabaseCleanup } = require('../utils/cleanup');
const { checkProductAvailability } = require('../utils/availability');

const {
    getOrCreateActiveCart,
    getActiveCart,
    checkCartItemConflict
} = require('../services/cartService');

module.exports = router;

router.get('/cart', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);
        const cartId = await getActiveCart(connection, req);

        if (!cartId) {
            return res.json({
                cartId: null,
                items: []
            });
        }

        const [items] = await connection.execute(
            `SELECT 
                ci.id,
                ci.product_id AS productId,
                DATE_FORMAT(ci.rental_start, '%Y-%m-%d') AS rentalStart,
                DATE_FORMAT(ci.rental_end, '%Y-%m-%d') AS rentalEnd,
                ci.quantity,
                p.product_key AS productKey,
                p.title,
                p.description,
                p.price_per_day AS pricePerDay,
                p.deposit,
                p.image_path AS imagePath
             FROM rental_cart_items ci
             JOIN rental_products p ON p.id = ci.product_id
             WHERE ci.cart_id = ?
             ORDER BY ci.id ASC`,
            [cartId]
        );

        res.json({
            cartId,
            items
        });
    } catch (error) {
        console.error('Fehler beim Laden des Warenkorbs:', error);
        res.status(500).json({
            error: 'Warenkorb konnte nicht geladen werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

router.post('/cart/items', async (req, res) => {
    const { productId, rentalStart, rentalEnd } = req.body;

    if (!productId || !rentalStart || !rentalEnd) {
        return res.status(400).json({
            error: 'Produkt, Mietbeginn und Mietende sind Pflichtfelder.'
        });
    }

    if (new Date(rentalEnd) < new Date(rentalStart)) {
        return res.status(400).json({
            error: 'Das Mietende darf nicht vor dem Mietbeginn liegen.'
        });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const [products] = await connection.execute(
            `SELECT id
             FROM rental_products
             WHERE id = ?
             AND is_active = 1`,
            [productId]
        );

        if (products.length === 0) {
            return res.status(404).json({
                error: 'Produkt wurde nicht gefunden oder ist nicht aktiv.'
            });
        }

        const isAvailable = await checkProductAvailability(
            connection,
            productId,
            rentalStart,
            rentalEnd
        );

        if (!isAvailable) {
            return res.status(409).json({
                error: 'Das Produkt ist im ausgewählten Zeitraum nicht verfügbar.'
            });
        }

        const cartId = await getOrCreateActiveCart(connection, req);

        const cartConflict = await checkCartItemConflict(
            connection,
            cartId,
            productId,
            rentalStart,
            rentalEnd
        );

        if (cartConflict) {
            return res.status(409).json({
                error: 'Dieses Produkt befindet sich für diesen Zeitraum bereits im Warenkorb.'
            });
        }

        const [result] = await connection.execute(
            `INSERT INTO rental_cart_items
             (cart_id, product_id, rental_start, rental_end, quantity)
             VALUES (?, ?, ?, ?, 1)`,
            [cartId, productId, rentalStart, rentalEnd]
        );

        await connection.execute(
            `UPDATE rental_carts
             SET updated_at = NOW()
             WHERE id = ?`,
            [cartId]
        );

        res.status(201).json({
            message: 'Produkt wurde zum Warenkorb hinzugefügt.',
            itemId: result.insertId
        });
    } catch (error) {
        console.error('Fehler beim Hinzufügen zum Warenkorb:', error);
        res.status(500).json({
            error: 'Produkt konnte nicht zum Warenkorb hinzugefügt werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

router.put('/cart/items/:id', async (req, res) => {
    const { rentalStart, rentalEnd } = req.body;

    if (!rentalStart || !rentalEnd) {
        return res.status(400).json({
            error: 'Mietbeginn und Mietende sind Pflichtfelder.'
        });
    }

    if (new Date(rentalEnd) < new Date(rentalStart)) {
        return res.status(400).json({
            error: 'Das Mietende darf nicht vor dem Mietbeginn liegen.'
        });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const cartId = await getOrCreateActiveCart(connection, req);

        const [items] = await connection.execute(
            `SELECT id, product_id
             FROM rental_cart_items
             WHERE id = ?
             AND cart_id = ?`,
            [req.params.id, cartId]
        );

        if (items.length === 0) {
            return res.status(404).json({
                error: 'Warenkorbposition wurde nicht gefunden.'
            });
        }

        const cartConflict = await checkCartItemConflict(
            connection,
            cartId,
            items[0].product_id,
            rentalStart,
            rentalEnd,
            req.params.id
        );

        if (cartConflict) {
            return res.status(409).json({
                error: 'Dieses Produkt befindet sich für diesen Zeitraum bereits im Warenkorb.'
            });
        }

        const isAvailable = await checkProductAvailability(
            connection,
            items[0].product_id,
            rentalStart,
            rentalEnd
        );

        if (!isAvailable) {
            return res.status(409).json({
                error: 'Das Produkt ist im ausgewählten Zeitraum nicht verfügbar.'
            });
        }

        await connection.execute(
            `UPDATE rental_cart_items
             SET rental_start = ?, rental_end = ?
             WHERE id = ?
             AND cart_id = ?`,
            [rentalStart, rentalEnd, req.params.id, cartId]
        );

        await connection.execute(
            `UPDATE rental_carts
             SET updated_at = NOW()
             WHERE id = ?`,
            [cartId]
        );

        res.json({
            message: 'Warenkorbposition wurde aktualisiert.'
        });
    } catch (error) {
        console.error('Fehler beim Aktualisieren der Warenkorbposition:', error);
        res.status(500).json({
            error: 'Warenkorbposition konnte nicht aktualisiert werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

router.delete('/cart/items/:id', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const cartId = await getOrCreateActiveCart(connection, req);

        const [result] = await connection.execute(
            `DELETE FROM rental_cart_items
             WHERE id = ?
             AND cart_id = ?`,
            [req.params.id, cartId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: 'Warenkorbposition wurde nicht gefunden.'
            });
        }

        const [remainingItems] = await connection.execute(
            `SELECT COUNT(*) AS count
             FROM rental_cart_items
             WHERE cart_id = ?`,
            [cartId]
        );

        if (remainingItems[0].count === 0) {
            await connection.execute(
                `DELETE FROM rental_carts
                 WHERE id = ?`,
                [cartId]
            );

            delete req.session.cartKey;

            console.log(
                `${new Date().toISOString()} - Warenkorb ${cartId} wurde gelöscht.`
            )
        } else {
            await connection.execute(
                `UPDATE rental_carts
                 SET updated_at = NOW()
                 WHERE id = ?`,
                [cartId]
            );
        }

        res.json({
            message: 'Warenkorbposition wurde gelöscht.'
        });
    } catch (error) {
        console.error('Fehler beim Löschen der Warenkorbposition:', error);
        res.status(500).json({
            error: 'Warenkorbposition konnte nicht gelöscht werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

router.delete('/cart', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const cartId = await getActiveCart(connection, req);

        if (!cartId) {
            return res.json({
                message: 'Warenkorb ist bereits leer.'
            });
        }

        await connection.execute(
            `DELETE FROM rental_carts WHERE id = ?`,
            [cartId]
        );

        delete req.session.cartKey;

        console.log(
            `${new Date().toISOString()} - Warenkorb ${cartId} wurde vollständig geleert.`
        );

        res.json({
            message: 'Warenkorb wurde geleert.'
        });
    } catch (error) {
        console.error('Fehler beim Leeren des Warenkorbs:', error);
        res.status(500).json({
            error: 'Warenkorb konnte nicht geleert werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

