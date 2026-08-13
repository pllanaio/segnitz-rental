'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function routeBlock(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0, `Startmarker fehlt: ${startMarker}`);
    assert.ok(end > start, `Endmarker fehlt: ${endMarker}`);
    return source.slice(start, end);
}

test('DB-Invarianten erzwingen genau einen aktiven Cart und verhindern exakte Doppelpositionen', () => {
    const migration = read('database/migrations/20260813_business_data_concurrency.sql');

    assert.match(migration, /GENERATED ALWAYS AS[\s\S]*status = 'active'/);
    assert.match(migration, /UNIQUE KEY uq_rental_carts_active_guest/);
    assert.match(migration, /UNIQUE KEY uq_rental_carts_active_user/);
    assert.match(migration, /UNIQUE KEY uq_rental_cart_items_exact_period/);
});

test('Checkout sperrt den aktiven Cart vor Positionslese und Produktkonfliktprüfung', () => {
    const source = read('segnitz_rental.js');
    const block = routeBlock(source, "app.post('/data'", 'function createVerificationToken');

    const cartLock = block.indexOf('getOrCreateActiveCart(connection, req, { forUpdate: true })');
    const itemRead = block.indexOf('getCartItemsForOrder(connection, cartId)');
    const productLock = block.indexOf('lockRentalProducts(');
    const conflictCheck = block.indexOf('checkProductAvailability(');

    assert.ok(cartLock >= 0 && cartLock < itemRead);
    assert.ok(itemRead < productLock && productLock < conflictCheck);
});

test('Verlängerung und Checkout verwenden Produkt-vor-Order-vor-Item-Lockreihenfolge', () => {
    const source = read('segnitz_rental.js');
    const extension = routeBlock(
        source,
        "app.put('/admin/order-items/:itemId/rental-adjustment'",
        "app.put('/admin/order-items/:itemId/return'"
    );
    const checkout = routeBlock(
        source,
        "app.post('/orders/:id/mollie-checkout'",
        "app.get('/orders/:id/payment-status'"
    );

    for (const block of [extension, checkout]) {
        const product = block.indexOf('lockRentalProducts(');
        const orderLock = block.indexOf('FOR UPDATE');
        const itemLock = block.indexOf('FOR UPDATE', orderLock + 1);
        const availability = block.indexOf('checkProductAvailability(');

        assert.ok(product >= 0 && product < orderLock);
        assert.ok(itemLock > orderLock);
        assert.ok(availability < 0 || itemLock < availability);
    }
});

test('Produktlöschung deaktiviert mit Retry und Bestseller zählen nur erfolgreiche Orders', () => {
    const source = read('routes/productRoutes.js');
    const deletion = routeBlock(
        source,
        "router.delete('/products/:id'",
        "router.post('/products/:id/images'"
    );
    const bestsellers = routeBlock(
        source,
        "router.get('/products/bestsellers'",
        "router.get('/products/:id/reviews'"
    );

    assert.match(deletion, /runInTransactionWithRetry/);
    assert.match(deletion, /SET is_active = 0/);
    assert.doesNotMatch(deletion, /DELETE FROM rental_products/);
    assert.match(bestsellers, /JOIN rental_orders/);
    assert.match(bestsellers, /ro\.status IN \('paid', 'confirmed', 'active', 'picked_up', 'returned'\)/);
    assert.doesNotMatch(bestsellers, /p\.times_ordered/);
    assert.match(bestsellers, /FROM rental_product_images[\s\S]*WHERE product_id IN/);
    assert.match(bestsellers, /FROM rental_product_categories[\s\S]*WHERE rpc\.product_id IN/);
});

test('Bestelllisten nutzen bei Jahresfilter einen sargable created_at-Bereich', () => {
    const source = read('segnitz_rental.js');
    const filter = routeBlock(source, 'function addCreatedAtRangeFilter', 'function addOrderListFilters');

    assert.match(filter, /ro\.created_at >= \? AND ro\.created_at < \?/);
    assert.doesNotMatch(filter, /YEAR\(ro\.created_at\)/);
    assert.doesNotMatch(filter, /MONTH\(ro\.created_at\)/);
});

test('Gastzugriff bleibt HttpOnly und der rohe Token erscheint nicht in API-Antwort oder Return-URL', () => {
    const source = read('segnitz_rental.js');
    const accessService = read('services/orderAccessService.js');

    assert.match(source, /guest_access_token_hash/);
    assert.match(source, /setOrderAccessCookie\(res, orderId, orderAccessGrant\)/);
    assert.doesNotMatch(source, /accessToken\s*:/);
    assert.match(accessService, /httpOnly:\s*true/);
    assert.match(accessService, /path:\s*`\/orders\/\$\{normalizedOrderId\}`/);
});
