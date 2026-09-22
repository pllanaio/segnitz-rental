'use strict';

const crypto = require('node:crypto');
const { currentRequestId } = require('./observability');
const ACTIVE_TRANSACTION = Symbol.for('segnitz.mysql.transaction-active');
const REQUEST_ID = Symbol('admin.audit.request-id');
const ACTIONS = Object.freeze({
    'PUT /admin/order-items/:itemId/pickup': 'item',
    'PUT /admin/orders/:id/pick-up': 'order',
    'PUT /admin/orders/:id/cancel': 'order',
    'PUT /admin/order-items/:itemId/cancel': 'item',
    'PUT /admin/order-items/:itemId/rental-adjustment': 'item',
    'PUT /admin/order-items/:itemId/return': 'item',
    'POST /admin/order-items/:itemId/return-images': 'item',
    'POST /admin/order-payments/manual': 'manual',
    'POST /admin/order-payments/manual-refund': 'manual',
    'POST /admin/order-payments/:id/retry-refund': 'payment'
});

function auditError(code = 'ADMIN_AUDIT_INVALID') {
    const error = new Error('Die Änderung konnte nicht vollständig protokolliert werden.');
    error.code = code;
    return error;
}

function positiveId(value) {
    const raw = String(value ?? '');
    if (!/^[1-9][0-9]*$/.test(raw)) throw auditError();
    const number = Number(raw);
    if (!Number.isSafeInteger(number)) throw auditError();
    return number;
}

function state(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(value)) throw auditError();
    return value;
}

function cents(value) {
    if (value === null || value === undefined) return null;
    const match = /^(-?)([0-9]{1,20})(?:\.([0-9]{1,2}))?$/.exec(String(value));
    if (!match) throw auditError();
    const amount = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'));
    return ((match[1] ? -1n : 1n) * amount).toString();
}

function day(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw auditError();
    return value;
}

function snapshot(order, items, payments) {
    // Explicit projection is a security boundary: never spread a DB row or req.body.
    const grouped = new Map();
    for (const payment of payments) {
        const type = state(payment.payment_type);
        const method = state(payment.payment_method);
        const status = state(payment.payment_status);
        const key = `${type}/${method}/${status}`;
        if (!grouped.has(key)) grouped.set(key, { type, method, status, count: 0, amount: 0n });
        const group = grouped.get(key);
        group.count += 1;
        group.amount += BigInt(cents(payment.amount));
    }
    return {
        schemaVersion: 1,
        currency: 'EUR',
        order: {
            id: positiveId(order.id), status: state(order.status), paymentStatus: state(order.payment_status),
            paymentMethod: state(order.payment_method), returnStatus: state(order.return_status),
            returnCaseStatus: state(order.return_case_status), totalAmountCents: cents(order.total_amount)
        },
        items: items.map(item => ({
            id: positiveId(item.id), productId: positiveId(item.product_id),
            rentalStart: day(item.rental_start), rentalEnd: day(item.rental_end),
            adjustedRentalStart: day(item.adjusted_rental_start), adjustedRentalEnd: day(item.adjusted_rental_end),
            actualReturnDate: day(item.actual_return_date),
            status: state(item.item_status), returnStatus: state(item.return_status),
            pricePerDayCents: cents(item.price_per_day), depositCents: cents(item.deposit),
            adjustedPricePerDayCents: cents(item.adjusted_price_per_day), adjustedRentalTotalCents: cents(item.adjusted_rental_total),
            depositDecision: state(item.deposit_decision), depositDeductionCents: cents(item.deposit_deduction_amount),
            depositRefundCents: cents(item.deposit_refund_amount), additionalChargeCents: cents(item.additional_charge_amount),
            damaged: Number(item.is_damaged) === 1, late: Number(item.is_late) === 1
        })),
        ledger: [...grouped.values()].map(({ amount, ...group }) => ({ ...group, amountCents: amount.toString() }))
            .sort((a, b) => `${a.type}/${a.method}/${a.status}`.localeCompare(`${b.type}/${b.method}/${b.status}`))
    };
}

async function resolveTarget(connection, req, kind) {
    if (kind === 'order') return { orderId: positiveId(req.params?.id), itemId: null, paymentId: null };
    if (kind === 'manual') return {
        orderId: positiveId(req.body?.orderId), itemId: req.body?.orderItemId ? positiveId(req.body.orderItemId) : null, paymentId: null
    };
    if (kind === 'item') {
        const itemId = positiveId(req.params?.itemId);
        // Resolve immutable parent IDs without reversing the order->items lock order.
        // After acquiring the parent lock, current locking reads revalidate membership.
        const [rows] = await connection.execute('SELECT id, order_id FROM rental_order_items WHERE id = ?', [itemId]);
        if (rows.length !== 1) throw auditError();
        return { orderId: positiveId(rows[0].order_id), itemId, paymentId: null };
    }
    const paymentId = positiveId(req.params?.id);
    const [rows] = await connection.execute('SELECT id, order_id, order_item_id FROM rental_order_payments WHERE id = ?', [paymentId]);
    if (rows.length !== 1) throw auditError();
    return { orderId: positiveId(rows[0].order_id), itemId: rows[0].order_item_id == null ? null : positiveId(rows[0].order_item_id), paymentId };
}

async function appendAdminMutation(connection, req) {
    if (connection[ACTIVE_TRANSACTION] !== true) throw auditError('ADMIN_AUDIT_TRANSACTION_REQUIRED');
    const method = String(req.method || '').toUpperCase();
    const route = req.route?.path;
    const kind = ACTIONS[`${method} ${route}`];
    if (!kind || !['global_admin', 'bearbeiter'].includes(req.session?.role)) throw auditError();
    const username = String(req.session?.user || '').trim().toLowerCase();
    if (!username || !Number.isSafeInteger(req.session.authVersion) || req.session.authVersion < 1) throw auditError();
    const target = await resolveTarget(connection, req, kind);
    const [orders] = await connection.execute(`SELECT id, status, payment_status, payment_method, return_status, return_case_status, total_amount
        FROM rental_orders WHERE id = ? FOR UPDATE`, [target.orderId]);
    if (orders.length !== 1) throw auditError();
    const [items] = await connection.execute(`SELECT id, order_id, product_id, rental_start, rental_end, adjusted_rental_start,
        adjusted_rental_end, actual_return_date, item_status, return_status, price_per_day, deposit,
        adjusted_price_per_day, adjusted_rental_total, deposit_decision, deposit_deduction_amount,
        deposit_refund_amount, additional_charge_amount, is_damaged, is_late
        FROM rental_order_items WHERE order_id = ? ORDER BY id LIMIT 501 FOR UPDATE`, [target.orderId]);
    const [payments] = await connection.execute(`SELECT id, order_id, order_item_id, payment_type, payment_method, payment_status, amount
        FROM rental_order_payments WHERE order_id = ? ORDER BY id LIMIT 10001 FOR UPDATE`, [target.orderId]);
    if (items.length > 500 || payments.length > 10000 ||
        (target.itemId && !items.some(item => Number(item.id) === target.itemId)) ||
        (target.paymentId && !payments.some(payment => Number(payment.id) === target.paymentId &&
            (payment.order_item_id == null ? null : Number(payment.order_item_id)) === target.itemId))) throw auditError();
    // Revalidate the acting account with a current read, retaining its stable ID
    // even if it is later renamed/deleted. No customer identity enters the event.
    const [actors] = await connection.execute('SELECT id, role, auth_version FROM users WHERE username = ? FOR SHARE', [username]);
    if (actors.length !== 1 || actors[0].role !== req.session.role || Number(actors[0].auth_version) !== req.session.authVersion) throw auditError('ADMIN_AUDIT_ACTOR_CHANGED');
    const actorId = positiveId(actors[0].id);
    const actorRef = crypto.createHash('sha256').update(`admin-user:${actorId}`).digest('hex');
    const requestId = currentRequestId() || (req[REQUEST_ID] ||= crypto.randomUUID());
    const afterJson = JSON.stringify(snapshot(orders[0], items, payments));
    if (Buffer.byteLength(afterJson, 'utf8') > 512 * 1024) throw auditError();
    const [result] = await connection.execute(`INSERT INTO admin_mutation_events
        (actor_user_id, actor_ref, actor_role, request_id, action, order_id, order_item_id, payment_id, snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [actorId, actorRef, actors[0].role, requestId, `${method} ${route}`, target.orderId, target.itemId, target.paymentId, afterJson]);
    return { auditEventId: String(result.insertId), requestId };
}

async function commitAdminMutation(connection, req) {
    try {
        const result = await appendAdminMutation(connection, req);
        await connection.commit();
        return result;
    } catch (error) {
        try { await connection.rollback(); } catch { /* Caller still handles the original failure; connection budget quarantines failed transports. */ }
        throw error;
    }
}

module.exports = { ACTIONS, appendAdminMutation, commitAdminMutation, positiveId, cents, snapshot };
