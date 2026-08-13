const crypto = require('crypto');

function isDuplicateKeyError(error) {
    return error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062;
}

function getCartSessionKey(req) {
    if (!req.session.cartKey) {
        if (typeof req.sessionID !== 'string' || req.sessionID.length === 0) {
            throw new TypeError('Warenkorb kann nicht ohne Session-ID gebunden werden.');
        }

        const sessionHash = crypto
            .createHash('sha256')
            .update(req.sessionID, 'utf8')
            .digest('hex');

        // Der stabile Hash konvergiert auch bei parallelen ersten Requests, ohne
        // die rohe (und damit authentifizierende) Session-ID in der DB abzulegen.
        req.session.cartKey = `guest:v1:${sessionHash}`;
    }

    return req.session.cartKey;
}

async function selectActiveUserCart(connection, userEmail, forUpdate = false) {
    const [rows] = await connection.execute(
        `SELECT id
         FROM rental_carts
         WHERE status = 'active'
         AND user_email = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
        [userEmail]
    );

    return rows[0]?.id || null;
}

async function selectActiveGuestCart(connection, sessionKey, forUpdate = false) {
    const [rows] = await connection.execute(
        `SELECT id
         FROM rental_carts
         WHERE status = 'active'
         AND session_id = ?
         AND user_email IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
        [sessionKey]
    );

    return rows[0]?.id || null;
}

async function getOrCreateActiveCart(connection, req, options = {}) {
    const userEmail = req.session.user || null;
    const forUpdate = options.forUpdate === true;

    if (userEmail) {
        const existingUserCartId = await selectActiveUserCart(
            connection,
            userEmail,
            forUpdate
        );

        if (existingUserCartId) {
            return existingUserCartId;
        }

        const sessionKey = getCartSessionKey(req);
        const guestCartId = await selectActiveGuestCart(
            connection,
            sessionKey,
            forUpdate
        );

        if (guestCartId) {
            try {
                await connection.execute(
                    `UPDATE rental_carts
                     SET user_email = ?, updated_at = NOW()
                     WHERE id = ?`,
                    [userEmail, guestCartId]
                );
                return guestCartId;
            } catch (error) {
                if (!isDuplicateKeyError(error)) throw error;

                const concurrentUserCartId = await selectActiveUserCart(
                    connection,
                    userEmail,
                    forUpdate
                );
                if (concurrentUserCartId) return concurrentUserCartId;
                throw error;
            }
        }

        try {
            const [result] = await connection.execute(
                `INSERT INTO rental_carts (session_id, user_email, status)
                 VALUES (?, ?, 'active')`,
                [sessionKey, userEmail]
            );

            return result.insertId;
        } catch (error) {
            if (!isDuplicateKeyError(error)) throw error;

            const concurrentUserCartId = await selectActiveUserCart(
                connection,
                userEmail,
                true
            );
            if (concurrentUserCartId) return concurrentUserCartId;
            throw error;
        }
    }

    const sessionKey = getCartSessionKey(req);
    const existingGuestCartId = await selectActiveGuestCart(
        connection,
        sessionKey,
        forUpdate
    );

    if (existingGuestCartId) {
        return existingGuestCartId;
    }

    try {
        const [result] = await connection.execute(
            `INSERT INTO rental_carts (session_id, user_email, status)
             VALUES (?, NULL, 'active')`,
            [sessionKey]
        );

        return result.insertId;
    } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;

        const concurrentGuestCartId = await selectActiveGuestCart(
            connection,
            sessionKey,
            true
        );
        if (concurrentGuestCartId) return concurrentGuestCartId;
        throw error;
    }
}

async function getActiveCart(connection, req, options = {}) {
    const userEmail = req.session.user || null;
    const forUpdate = options.forUpdate === true;

    if (userEmail) {
        return selectActiveUserCart(connection, userEmail, forUpdate);
    }

    if (!req.session.cartKey) {
        return null;
    }

    return selectActiveGuestCart(connection, req.session.cartKey, forUpdate);
}

async function mergeGuestCartIntoUserCart(connection, req, userEmail) {
    const sessionKey = req.session.cartKey;

    if (!sessionKey || !userEmail) {
        return;
    }

    // Einheitliche Sperrreihenfolge für Login/Get-or-create: Benutzer-Cart vor Gast-Cart.
    let userCartId = await selectActiveUserCart(connection, userEmail, true);
    const guestCartId = await selectActiveGuestCart(connection, sessionKey, true);

    if (!guestCartId) return userCartId;

    if (!userCartId) {
        try {
            await connection.execute(
                `UPDATE rental_carts
                 SET user_email = ?, updated_at = NOW()
                 WHERE id = ?`,
                [userEmail, guestCartId]
            );
            return guestCartId;
        } catch (error) {
            if (!isDuplicateKeyError(error)) throw error;
            userCartId = await selectActiveUserCart(connection, userEmail, true);
            if (!userCartId) throw error;
        }
    }

    if (userCartId === guestCartId) {
        return userCartId;
    }

    const [guestItems] = await connection.execute(
        `SELECT product_id, rental_start, rental_end, quantity
         FROM rental_cart_items
         WHERE cart_id = ?`,
        [guestCartId]
    );

    for (const item of guestItems) {
        const conflict = await checkCartItemConflict(
            connection,
            userCartId,
            item.product_id,
            item.rental_start,
            item.rental_end
        );

        if (!conflict) {
            try {
                await connection.execute(
                    `INSERT INTO rental_cart_items
                     (cart_id, product_id, rental_start, rental_end, quantity)
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                        userCartId,
                        item.product_id,
                        item.rental_start,
                        item.rental_end,
                        item.quantity || 1
                    ]
                );
            } catch (error) {
                if (!isDuplicateKeyError(error)) throw error;
            }
        }
    }

    await connection.execute(
        `DELETE FROM rental_carts
         WHERE id = ?`,
        [guestCartId]
    );

    await connection.execute(
        `UPDATE rental_carts
         SET updated_at = NOW()
         WHERE id = ?`,
        [userCartId]
    );

    return userCartId;
}

async function checkCartItemConflict(connection, cartId, productId, rentalStart, rentalEnd, excludeCartItemId = null) {
    let sql = `
        SELECT id
        FROM rental_cart_items
        WHERE cart_id = ?
        AND product_id = ?
        AND rental_start <= ?
        AND rental_end >= ?
    `;

    const params = [cartId, productId, rentalEnd, rentalStart];

    if (excludeCartItemId) {
        sql += ` AND id != ?`;
        params.push(excludeCartItemId);
    }

    sql += ` LIMIT 1`;

    const [conflicts] = await connection.execute(sql, params);

    return conflicts.length > 0;
}

async function getCartItemsForOrder(connection, cartId) {
    const [items] = await connection.execute(
        `SELECT 
            ci.id,
            ci.product_id AS productId,
            DATE_FORMAT(ci.rental_start, '%Y-%m-%d') AS rentalStart,
            DATE_FORMAT(ci.rental_end, '%Y-%m-%d') AS rentalEnd,
            ci.quantity,
            p.product_key AS productKey,
            p.title,
            p.price_per_day AS pricePerDay,
            p.deposit
         FROM rental_cart_items ci
         JOIN rental_products p ON p.id = ci.product_id
         WHERE ci.cart_id = ?
         ORDER BY ci.id ASC`,
        [cartId]
    );

    return items;
}

module.exports = {
    getCartSessionKey,
    getOrCreateActiveCart,
    getActiveCart,
    mergeGuestCartIntoUserCart,
    checkCartItemConflict,
    getCartItemsForOrder,
    isDuplicateKeyError,
    selectActiveGuestCart,
    selectActiveUserCart
};
