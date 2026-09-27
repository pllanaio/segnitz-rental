'use strict';
const { validateCoupon, loadValidCoupon, applyCouponToSummary } = require('../services/couponService');
const { getActiveCart, getCartItemsForOrder } = require('../services/cartService');
const { buildOrderSummary } = require('../services/orderService');
function registerCouponRoutes(app, { checkAdmin, createConnection, transact, limiter, publicLimiter }) {
    const failure = (res, error) => res.status(error.code === 'ER_DUP_ENTRY' ? 409 : error.statusCode || 500).json({ error: error.code === 'ER_DUP_ENTRY' ? 'Dieser Gutscheincode existiert bereits.' : error.statusCode ? error.message : 'Gutscheine konnten nicht verarbeitet werden.' });
    app.get('/admin/coupons', checkAdmin, async (req, res) => {
        let connection;
        try {
            connection = await createConnection();
            const [items] = await connection.execute(`SELECT id, code, percent, active, revision,
                DATE_FORMAT(valid_from, '%Y-%m-%d') AS validFrom, DATE_FORMAT(valid_until, '%Y-%m-%d') AS validUntil
                FROM discount_codes ORDER BY id DESC`);
            res.json({ items });
        } catch (error) { failure(res, error); } finally { if (connection) await connection.end(); }
    });
    const save = async (req, res) => {
        try {
            const coupon = validateCoupon(req.body);
            const result = await transact(createConnection, async connection => {
                if (req.params.id) {
                    if (!/^\d+$/.test(req.params.id) || !Number.isInteger(req.body.revision)) throw Object.assign(new Error('Ungültiger Gutschein.'), { statusCode: 400 });
                    const [updated] = await connection.execute(`UPDATE discount_codes SET code = ?, percent = ?, active = ?, valid_from = ?, valid_until = ?,
                        revision = revision + 1, updated_by = ?, updated_at = NOW() WHERE id = ? AND revision = ?`,
                    [coupon.code, coupon.percent, coupon.active ? 1 : 0, coupon.validFrom, coupon.validUntil, req.session.user, req.params.id, req.body.revision]);
                    if (!updated.affectedRows) throw Object.assign(new Error('Der Gutschein wurde zwischenzeitlich geändert. Bitte neu laden.'), { statusCode: 409 });
                    return { id: Number(req.params.id) };
                }
                const [created] = await connection.execute(`INSERT INTO discount_codes (code, percent, active, valid_from, valid_until, updated_by) VALUES (?, ?, ?, ?, ?, ?)`,
                    [coupon.code, coupon.percent, coupon.active ? 1 : 0, coupon.validFrom, coupon.validUntil, req.session.user]);
                return { id: created.insertId };
            });
            res.status(req.params.id ? 200 : 201).json(result);
        } catch (error) { failure(res, error); }
    };
    app.post('/admin/coupons', checkAdmin, limiter, save);
    app.put('/admin/coupons/:id', checkAdmin, limiter, save);
    app.post('/cart/coupon-preview', publicLimiter, async (req, res) => {
        let connection;
        try {
            connection = await createConnection();
            const cartId = await getActiveCart(connection, req);
            const items = cartId ? await getCartItemsForOrder(connection, cartId) : [];
            if (!items.length) throw Object.assign(new Error('Der Warenkorb ist leer.'), { statusCode: 400 });
            const coupon = await loadValidCoupon(connection, req.body?.code);
            const summary = applyCouponToSummary(buildOrderSummary('', items), coupon);
            res.json({ coupon: summary.coupon, totals: summary.totals });
        } catch (error) { failure(res, error); } finally { if (connection) await connection.end(); }
    });
}
module.exports = { registerCouponRoutes };
