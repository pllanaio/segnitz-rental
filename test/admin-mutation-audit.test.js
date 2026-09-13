'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { commitAdminMutation } = require('../services/adminMutationAudit');
const ACTIVE = Symbol.for('segnitz.mysql.transaction-active');

function request(route = '/admin/order-items/:itemId/return', method = 'PUT') {
    return { route: { path: route }, method, params: { itemId: '3' }, body: { secret: 'private-body', note: 'private-note' },
        session: { user: 'synthetic.admin@example.invalid', role: 'global_admin', authVersion: 1 },
        headers: { 'x-request-id': 'untrusted-client-id' } };
}

function connection({ auditFails = false, active = true } = {}) {
    const state = { commits: 0, rollbacks: 0, pendingEvents: [], committedEvents: [], statements: [] };
    const client = {
        [ACTIVE]: active,
        state,
        async execute(sql, values = []) {
            state.statements.push({ sql, values });
            if (sql.includes('FROM users')) return [[{ id: 1, role: 'global_admin', auth_version: 1 }]];
            if (sql.includes('FROM rental_order_items') && sql.includes('WHERE id =')) return [[{ id: 3, order_id: 7 }]];
            if (sql.includes('FROM rental_order_payments') && sql.includes('WHERE id =')) return [[{ id: 22, order_id: 7, order_item_id: 3 }]];
            if (sql.includes('FROM rental_orders')) return [[{ id: 7, status: 'picked_up', payment_status: 'paid', payment_method: 'cash', total_amount: '100.10', signature_data_url: 'private-signature', customer_email: 'private-customer@example.invalid' }]];
            if (sql.includes('FROM rental_order_items')) return [[{ id: 3, order_id: 7, product_id: 2, rental_start: '2026-10-24', rental_end: '2026-10-25', price_per_day: '0.00', deposit: '150.00', item_status: 'returned_ok', is_damaged: 0, is_late: 0, damage_description: 'private-damage', return_notes: 'private-return' }]];
            if (sql.includes('FROM rental_order_payments')) return [[
                { id: 21, order_id: 7, order_item_id: null, payment_type: 'rental', payment_method: 'cash', payment_status: 'paid', amount: '100.10', note: 'private-payment' },
                { id: 22, order_id: 7, order_item_id: 3, payment_type: 'deposit', payment_method: 'cash', payment_status: 'paid', amount: '150.00', external_operation_key: 'private-operation' }
            ]];
            if (sql.includes('INSERT INTO admin_mutation_events')) {
                if (auditFails) throw Object.assign(new Error('audit storage unavailable'), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
                state.pendingEvents.push(values);
                return [{ insertId: 4 }];
            }
            throw new Error(`Unexpected test statement: ${sql}`);
        },
        async commit() { state.commits += 1; state.committedEvents.push(...state.pendingEvents); state.pendingEvents = []; this[ACTIVE] = false; },
        async rollback() { state.rollbacks += 1; state.pendingEvents = []; this[ACTIVE] = false; }
    };
    return client;
}

test('successful financial commit contains durable actor, correlation, targets and sanitized resulting state', async () => {
    const client = connection();
    await commitAdminMutation(client, request());
    assert.equal(client.state.commits, 1);
    assert.equal(client.state.committedEvents.length, 1);
    const values = client.state.committedEvents[0];
    const snapshot = JSON.parse(values.at(-1));
    assert.equal(snapshot.order.id, 7);
    assert.equal(snapshot.order.totalAmountCents, '10010');
    assert.equal(snapshot.items[0].depositCents, '15000');
    assert.equal(snapshot.items[0].rentalStart, '2026-10-24');
    assert.equal(snapshot.items[0].pricePerDayCents, '0');
    assert.equal(snapshot.ledger.find(group => group.type === 'rental').amountCents, '10010');
    for (const secret of ['private-', 'synthetic.admin@example.invalid', 'untrusted-client-id']) assert.ok(!JSON.stringify(values).includes(secret));
    assert.ok(client.state.statements.filter(statement => /FROM rental_(orders|order_items|order_payments)/.test(statement.sql)).slice(-3).every(statement => /FOR UPDATE/.test(statement.sql)));
});

test('failed audit insertion rolls back the mutation and never commits finance', async () => {
    const client = connection({ auditFails: true });
    await assert.rejects(commitAdminMutation(client, request()), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
    assert.equal(client.state.commits, 0);
    assert.equal(client.state.rollbacks, 1);
    assert.deepEqual(client.state.committedEvents, []);
});

test('autocommit, customer roles, unsupported actions and unsafe IDs cannot produce successful unaudited commits', async () => {
    for (const [client, req] of [
        [connection({ active: false }), request()],
        [connection(), { ...request(), session: { user: 'customer@example.invalid', role: 'customer', authVersion: 1 } }],
        [connection(), request('/admin/unknown')],
        [connection(), { ...request(), params: { itemId: '../3' } }]
    ]) {
        await assert.rejects(commitAdminMutation(client, req));
        assert.equal(client.state.commits, 0);
        assert.deepEqual(client.state.committedEvents, []);
    }
});

test('manual finance and refund-retry routes resolve consistent order and item targets', async () => {
    for (const route of ['/admin/order-payments/manual', '/admin/order-payments/manual-refund', '/admin/order-payments/:id/retry-refund']) {
        const client = connection();
        const req = request(route, 'POST');
        req.params = { id: '22' };
        req.body = { orderId: 7, orderItemId: 3 };
        await commitAdminMutation(client, req);
        assert.equal(client.state.committedEvents.length, 1);
        const values = client.state.committedEvents[0];
        assert.equal(values[5], 7);
        assert.equal(values[6], 3);
    }
});

test('audit amounts preserve cents beyond Number precision and reject nondecimal values', () => {
    const { cents, snapshot } = require('../services/adminMutationAudit');
    assert.equal(cents('90071992547409.91'), '9007199254740991');
    assert.equal(cents('-0.01'), '-1');
    for (const value of ['1.001', 'NaN', 'Infinity', '1e4']) assert.throws(() => cents(value));
    const result = snapshot({ id: 1, total_amount: '0' }, [], [
        { payment_type: 'rental', payment_method: 'cash', payment_status: 'paid', amount: '90071992547409.91' },
        { payment_type: 'rental', payment_method: 'cash', payment_status: 'paid', amount: '0.02' }
    ]);
    assert.equal(result.ledger[0].amountCents, '9007199254740993');
});

test('role/auth-version drift rolls back the whole admin transaction', async () => {
    const client = connection();
    const execute = client.execute;
    client.execute = async (sql, values) => sql.includes('FROM users')
        ? [[{ id: 1, role: 'global_admin', auth_version: 2 }]] : execute(sql, values);
    await assert.rejects(commitAdminMutation(client, request()), { code: 'ADMIN_AUDIT_ACTOR_CHANGED' });
    assert.equal(client.state.commits, 0);
    assert.equal(client.state.rollbacks, 1);
});
