const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

const dbConfig = require('../config/db');
const { checkProductAvailability } = require('../utils/availability');
const {
    isRetryableTransactionError,
    runInTransactionWithRetry
} = require('../utils/dbRetry');
const { isStrictIsoDate } = require('../services/paymentStateService');

const {
    getOrCreateActiveCart,
    getActiveCart,
    checkCartItemConflict,
    isDuplicateKeyError
} = require('../services/cartService');

module.exports = router;

function businessError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function sendCartMutationError(res, error, fallbackMessage) {
    if (Number.isInteger(error?.statusCode)) {
        return res.status(error.statusCode).json({ error: error.message });
    }

    if (isDuplicateKeyError(error)) {
        return res.status(409).json({
            error: 'Dieses Produkt befindet sich für diesen Zeitraum bereits im Warenkorb.'
        });
    }

    if (isRetryableTransactionError(error)) {
        res.set('Retry-After', '1');
        return res.status(503).json({
            error: 'Der Warenkorb wurde gleichzeitig geändert. Bitte erneut versuchen.'
        });
    }

    console.error(fallbackMessage, error);
    return res.status(500).json({ error: fallbackMessage });
}

async function lockActiveProduct(connection, productId) {
    const [products] = await connection.execute(
        `SELECT id, is_active
         FROM rental_products
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [productId]
    );

    if (products.length === 0 || Number(products[0].is_active) !== 1) {
        throw businessError(404, 'Produkt wurde nicht gefunden oder ist nicht aktiv.');
    }

    return products[0];
}

router.get('/cart', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
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

    if (!isStrictIsoDate(rentalStart) || !isStrictIsoDate(rentalEnd)) {
        return res.status(400).json({
            error: 'Mietbeginn und Mietende müssen gültige Datumswerte sein.'
        });
    }

    const today = new Date().toLocaleDateString('sv-SE');

    if (rentalStart < today) {
        return res.status(400).json({
            error: 'Der Mietbeginn darf nicht in der Vergangenheit liegen.'
        });
    }

    if (rentalEnd < rentalStart) {
        return res.status(400).json({
            error: 'Das Mietende darf nicht vor dem Mietbeginn liegen.'
        });
    }

    try {
        const result = await runInTransactionWithRetry(
            () => mysql.createConnection(dbConfig),
            async connection => {
                // Einheitliche Sperrreihenfolge für Cart-Mutationen: Cart -> Produkt -> Positionen.
                const cartId = await getOrCreateActiveCart(connection, req, { forUpdate: true });
                await lockActiveProduct(connection, productId);

                const isAvailable = await checkProductAvailability(
                    connection,
                    productId,
                    rentalStart,
                    rentalEnd,
                    null,
                    true
                );

                if (!isAvailable) {
                    throw businessError(
                        409,
                        'Das Produkt ist im ausgewählten Zeitraum nicht verfügbar.'
                    );
                }

                const cartConflict = await checkCartItemConflict(
                    connection,
                    cartId,
                    productId,
                    rentalStart,
                    rentalEnd
                );

                if (cartConflict) {
                    throw businessError(
                        409,
                        'Dieses Produkt befindet sich für diesen Zeitraum bereits im Warenkorb.'
                    );
                }

                const [insertResult] = await connection.execute(
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

                return { itemId: insertResult.insertId };
            }
        );

        res.status(201).json({
            message: 'Produkt wurde zum Warenkorb hinzugefügt.',
            itemId: result.itemId
        });
    } catch (error) {
        return sendCartMutationError(
            res,
            error,
            'Produkt konnte nicht zum Warenkorb hinzugefügt werden.'
        );
    }
});

router.put('/cart/items/:id', async (req, res) => {
    const { rentalStart, rentalEnd } = req.body;

    if (!rentalStart || !rentalEnd) {
        return res.status(400).json({
            error: 'Mietbeginn und Mietende sind Pflichtfelder.'
        });
    }

    if (!isStrictIsoDate(rentalStart) || !isStrictIsoDate(rentalEnd)) {
        return res.status(400).json({
            error: 'Mietbeginn und Mietende müssen gültige Datumswerte sein.'
        });
    }

    const today = new Date().toLocaleDateString('sv-SE');

    if (rentalStart < today) {
        return res.status(400).json({
            error: 'Der Mietbeginn darf nicht in der Vergangenheit liegen.'
        });
    }

    if (rentalEnd < rentalStart) {
        return res.status(400).json({
            error: 'Das Mietende darf nicht vor dem Mietbeginn liegen.'
        });
    }

    try {
        await runInTransactionWithRetry(
            () => mysql.createConnection(dbConfig),
            async connection => {
                const cartId = await getActiveCart(connection, req, { forUpdate: true });

                if (!cartId) {
                    throw businessError(404, 'Warenkorbposition wurde nicht gefunden.');
                }

                const [items] = await connection.execute(
                    `SELECT id, product_id
                     FROM rental_cart_items
                     WHERE id = ?
                     AND cart_id = ?
                     LIMIT 1`,
                    [req.params.id, cartId]
                );

                if (items.length === 0) {
                    throw businessError(404, 'Warenkorbposition wurde nicht gefunden.');
                }

                await lockActiveProduct(connection, items[0].product_id);

                const cartConflict = await checkCartItemConflict(
                    connection,
                    cartId,
                    items[0].product_id,
                    rentalStart,
                    rentalEnd,
                    req.params.id
                );

                if (cartConflict) {
                    throw businessError(
                        409,
                        'Dieses Produkt befindet sich für diesen Zeitraum bereits im Warenkorb.'
                    );
                }

                const isAvailable = await checkProductAvailability(
                    connection,
                    items[0].product_id,
                    rentalStart,
                    rentalEnd,
                    null,
                    true
                );

                if (!isAvailable) {
                    throw businessError(
                        409,
                        'Das Produkt ist im ausgewählten Zeitraum nicht verfügbar.'
                    );
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
            }
        );

        res.json({
            message: 'Warenkorbposition wurde aktualisiert.'
        });
    } catch (error) {
        return sendCartMutationError(
            res,
            error,
            'Warenkorbposition konnte nicht aktualisiert werden.'
        );
    }
});

router.delete('/cart/items/:id', async (req, res) => {
    try {
        const result = await runInTransactionWithRetry(
            () => mysql.createConnection(dbConfig),
            async connection => {
                const cartId = await getActiveCart(connection, req, { forUpdate: true });

                if (!cartId) {
                    throw businessError(404, 'Warenkorbposition wurde nicht gefunden.');
                }

                const [deleteResult] = await connection.execute(
                    `DELETE FROM rental_cart_items
                     WHERE id = ?
                     AND cart_id = ?`,
                    [req.params.id, cartId]
                );

                if (deleteResult.affectedRows === 0) {
                    throw businessError(404, 'Warenkorbposition wurde nicht gefunden.');
                }

                const [remainingItems] = await connection.execute(
                    `SELECT COUNT(*) AS count
                     FROM rental_cart_items
                     WHERE cart_id = ?`,
                    [cartId]
                );
                const cartDeleted = Number(remainingItems[0]?.count || 0) === 0;

                if (cartDeleted) {
                    await connection.execute(
                        'DELETE FROM rental_carts WHERE id = ?',
                        [cartId]
                    );
                } else {
                    await connection.execute(
                        `UPDATE rental_carts
                         SET updated_at = NOW()
                         WHERE id = ?`,
                        [cartId]
                    );
                }

                return { cartDeleted, cartId };
            }
        );

        if (result.cartDeleted) {
            delete req.session.cartKey;
            console.log(`${new Date().toISOString()} - Warenkorb ${result.cartId} wurde gelöscht.`);
        }

        res.json({
            message: 'Warenkorbposition wurde gelöscht.'
        });
    } catch (error) {
        return sendCartMutationError(
            res,
            error,
            'Warenkorbposition konnte nicht gelöscht werden.'
        );
    }
});

router.delete('/cart', async (req, res) => {
    try {
        const result = await runInTransactionWithRetry(
            () => mysql.createConnection(dbConfig),
            async connection => {
                const cartId = await getActiveCart(connection, req, { forUpdate: true });

                if (!cartId) return { cartId: null };

                await connection.execute('DELETE FROM rental_carts WHERE id = ?', [cartId]);
                return { cartId };
            }
        );

        if (!result.cartId) {
            return res.json({ message: 'Warenkorb ist bereits leer.' });
        }

        delete req.session.cartKey;

        console.log(
            `${new Date().toISOString()} - Warenkorb ${result.cartId} wurde vollständig geleert.`
        );

        res.json({
            message: 'Warenkorb wurde geleert.'
        });
    } catch (error) {
        return sendCartMutationError(res, error, 'Warenkorb konnte nicht geleert werden.');
    }
});
