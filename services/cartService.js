const crypto = require('crypto');

function getCartSessionKey(req) {
    if (!req.session.cartKey) {
        req.session.cartKey = crypto.randomUUID();
    }

    return req.session.cartKey;
}

async function getOrCreateActiveCart(connection, req) {
    const userEmail = req.session.user || null;

    if (userEmail) {
        const [existingUserCart] = await connection.execute(
            `SELECT id
             FROM rental_carts
             WHERE status = 'active'
             AND user_email = ?
             ORDER BY updated_at DESC, id DESC
             LIMIT 1`,
            [userEmail]
        );

        if (existingUserCart.length > 0) {
            return existingUserCart[0].id;
        }

        const sessionKey = getCartSessionKey(req);

        const [guestCart] = await connection.execute(
            `SELECT id
             FROM rental_carts
             WHERE status = 'active'
             AND session_id = ?
             AND user_email IS NULL
             ORDER BY updated_at DESC, id DESC
             LIMIT 1`,
            [sessionKey]
        );

        if (guestCart.length > 0) {
            await connection.execute(
                `UPDATE rental_carts
                 SET user_email = ?, updated_at = NOW()
                 WHERE id = ?`,
                [userEmail, guestCart[0].id]
            );

            return guestCart[0].id;
        }

        const [result] = await connection.execute(
            `INSERT INTO rental_carts (session_id, user_email, status)
             VALUES (?, ?, 'active')`,
            [sessionKey, userEmail]
        );

        return result.insertId;
    }

    const sessionKey = getCartSessionKey(req);

    const [existingGuestCart] = await connection.execute(
        `SELECT id
         FROM rental_carts
         WHERE status = 'active'
         AND session_id = ?
         AND user_email IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [sessionKey]
    );

    if (existingGuestCart.length > 0) {
        return existingGuestCart[0].id;
    }

    const [result] = await connection.execute(
        `INSERT INTO rental_carts (session_id, user_email, status)
         VALUES (?, NULL, 'active')`,
        [sessionKey]
    );

    return result.insertId;
}

async function getActiveCart(connection, req) {
    const userEmail = req.session.user || null;

    if (userEmail) {
        const [rows] = await connection.execute(
            `SELECT id
             FROM rental_carts
             WHERE status = 'active'
             AND user_email = ?
             ORDER BY updated_at DESC, id DESC
             LIMIT 1`,
            [userEmail]
        );

        return rows.length > 0 ? rows[0].id : null;
    }

    if (!req.session.cartKey) {
        return null;
    }

    const [rows] = await connection.execute(
        `SELECT id
         FROM rental_carts
         WHERE status = 'active'
         AND session_id = ?
         AND user_email IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [req.session.cartKey]
    );

    return rows.length > 0 ? rows[0].id : null;
}

async function mergeGuestCartIntoUserCart(connection, req, userEmail) {
    const sessionKey = req.session.cartKey;

    if (!sessionKey || !userEmail) {
        return;
    }

    const [guestCarts] = await connection.execute(
        `SELECT id
         FROM rental_carts
         WHERE status = 'active'
         AND session_id = ?
         AND user_email IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [sessionKey]
    );

    if (guestCarts.length === 0) {
        return;
    }

    const guestCartId = guestCarts[0].id;

    const [userCarts] = await connection.execute(
        `SELECT id
         FROM rental_carts
         WHERE status = 'active'
         AND user_email = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [userEmail]
    );

    if (userCarts.length === 0) {
        await connection.execute(
            `UPDATE rental_carts
             SET user_email = ?, updated_at = NOW()
             WHERE id = ?`,
            [userEmail, guestCartId]
        );
        return;
    }

    const userCartId = userCarts[0].id;

    if (userCartId === guestCartId) {
        return;
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
    getCartItemsForOrder
};