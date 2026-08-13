'use strict';

const { expect, test } = require('@playwright/test');
const { TEST_ADMIN, TEST_PRODUCT, TEST_USER } = require('../support/test-database');

function futureDate(offsetDays) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return date.toISOString().slice(0, 10);
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const formatDate = date => date.toISOString().slice(0, 10);
        const flatpickrStub = () => ({
            destroy() {},
            formatDate
        });
        flatpickrStub.formatDate = formatDate;
        window.flatpickr = flatpickrStub;
    });
});

test('zeigt den Katalog und legt ein Produkt über die Oberfläche in den Warenkorb', async ({ page }) => {
    const rentalStart = futureDate(30);
    const rentalEnd = futureDate(32);

    await page.goto('/');

    const productCard = page.locator('#productGrid .product-card', {
        hasText: TEST_PRODUCT.title
    });

    await expect(productCard).toBeVisible();
    await expect(page.locator('#categoryFilterList')).toContainText('Baumaschinen');

    await productCard.getByRole('button', { name: 'Details' }).click();
    await expect(page.locator('#productDetailsModal')).toBeVisible();
    await expect(page.locator('#modalProductTitle')).toHaveText(TEST_PRODUCT.title);

    await page.evaluate(({ rentalStart, rentalEnd }) => {
        document.getElementById('modalRentalStart').value = rentalStart;
        document.getElementById('modalRentalEnd').value = rentalEnd;
    }, { rentalStart, rentalEnd });

    await page.locator('#selectProductFromModal').click();

    await expect(page.locator('#cartItemCount')).toHaveText('1');
    await expect(page.locator('#globalAlertContainer')).toContainText('Produkt wurde zum Warenkorb hinzugefügt.');

    await page.locator('[data-bs-target="#cartModal"]').click();
    await expect(page.locator('#cartModal')).toBeVisible();
    await expect(page.locator('#cartItems')).toContainText(TEST_PRODUCT.title);
    await expect(page.locator('#cartItems')).toContainText(`${rentalStart} bis ${rentalEnd}`);

    await page.getByRole('button', { name: 'Zeitraum ändern' }).click();
    await expect(page.locator('#cartItemEditModal')).toBeVisible();
    await expect(page.locator('#editCartItemTitle')).toHaveText(TEST_PRODUCT.title);
});

test('zeigt Loginfehler und meldet einen Testkunden erfolgreich an', async ({ page }) => {
    await page.goto('/login.html');

    await page.locator('#username').fill(TEST_USER.email);
    await page.locator('#password').fill('falsches-passwort');
    await page.getByRole('button', { name: 'Einloggen' }).click();

    await expect(page.locator('#globalAlertContainer')).toContainText('Falsche Zugangsdaten.');

    await page.locator('#password').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'Einloggen' }).click();

    await expect(page).toHaveURL(/\/index\.html$/);
    await expect(page.locator('#login-status')).toHaveText(`Angemeldet als: ${TEST_USER.email}`);
    await expect(page.locator('#profile-button')).toBeVisible();
});

test('führt die abgesicherte Ersteinrichtung des ersten Admins aus', async ({ page }) => {
    const consoleErrors = [];
    let submittedSetup = null;

    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.route('**/setup-status', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ setupRequired: true })
    }));
    await page.route('**/setup-admin', async route => {
        submittedSetup = route.request().postDataJSON();
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                message: 'Adminkonto wurde erstellt. Die Installation ist betriebsbereit.',
                redirectTo: '/login.html?setup=complete'
            })
        });
    });

    await page.goto('/setup.html');

    await expect(page).toHaveTitle('Segnitz Rental – Ersteinrichtung');
    await expect(page.getByRole('heading', { name: 'Ersteinrichtung' })).toBeVisible();
    await expect(page.getByText('Die Datenbank ist bereit.')).toBeVisible();

    await page.locator('#setupToken').fill('deployment-setup-token');
    await page.locator('#firstName').fill('First');
    await page.locator('#lastName').fill('Admin');
    await page.locator('#email').fill('first.admin@example.com');
    await page.locator('#password').fill('FirstAdminPassword123!');
    await page.locator('#passwordRepeat').fill('FirstAdminPassword123!');

    await page.getByRole('button', { name: 'Adminkonto erstellen' }).click();
    await expect(page.locator('#setupMessage')).toContainText('Installation ist betriebsbereit');
    await expect(page).toHaveURL(/\/login\.html\?setup=complete$/);

    expect(submittedSetup).toEqual({
        setupToken: 'deployment-setup-token',
        firstName: 'First',
        lastName: 'Admin',
        email: 'first.admin@example.com',
        password: 'FirstAdminPassword123!'
    });
    expect(consoleErrors).toEqual([]);
});

test('führt Admin-Navigation und dynamische Produktaktionen ohne Inline-Handler aus', async ({ page }) => {
    const response = await page.goto('/login.html');
    const csp = response.headers()['content-security-policy'];

    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("script-src 'self' https://cdn.jsdelivr.net");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");

    await page.locator('#username').fill(TEST_ADMIN.email);
    await page.locator('#password').fill(TEST_ADMIN.password);
    await Promise.all([
        page.waitForURL(/\/backend\.html$/),
        page.getByRole('button', { name: 'Einloggen' }).click()
    ]);
    await expect(page.locator('#productList')).toContainText(TEST_PRODUCT.title);

    await page.getByRole('button', { name: 'Bearbeiten' }).click();
    await expect(page.locator('#title')).toHaveValue(TEST_PRODUCT.title);

    await page.getByRole('button', { name: 'Öffnungszeiten' }).click();
    await expect(page.locator('#openingHoursView')).toBeVisible();
    await expect(page.locator('#openingHoursAdmin')).toContainText('Montag');
});

test('rendert gespeicherte Kundendaten im Adminbereich ohne HTML- oder Aktionsinjektion', async ({ page }) => {
    const payload = '<button class="xss-probe" data-backend-action="mark-item-picked-up" data-item-id="999">Adminaktion</button>';
    let injectedPickupRequests = 0;

    page.on('request', request => {
        if (request.method() === 'PUT' && request.url().endsWith('/admin/order-items/999/pickup')) {
            injectedPickupRequests += 1;
        }
    });

    await page.route('**/admin/orders?*', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            items: [{
                id: 9001,
                order_no: 'R-XSS-9001',
                status: 'confirmed',
                payment_status: 'pending',
                payment_method: 'cash',
                customer_first_name: payload,
                customer_last_name: payload,
                customer_company: payload,
                customer_email: `customer+${payload}@example.com`,
                items: []
            }],
            pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
            filterOptions: {
                years: [], months: [], statuses: [], returnStatuses: [], paymentStatuses: []
            }
        })
    }));
    await page.route('**/admin/orders/9001', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            id: 9001,
            order_no: 'R-XSS-9001',
            status: 'confirmed',
            payment_status: 'pending',
            payment_method: 'cash',
            customer_first_name: payload,
            customer_last_name: payload,
            customer_company: payload,
            customer_email: `customer+${payload}@example.com`,
            customer_phone: payload,
            customer_address: payload,
            customer_zip: payload,
            customer_city: payload,
            items: [],
            payments: []
        })
    }));

    await page.goto('/login.html');
    await page.locator('#username').fill(TEST_ADMIN.email);
    await page.locator('#password').fill(TEST_ADMIN.password);
    await Promise.all([
        page.waitForURL(/\/backend\.html$/),
        page.getByRole('button', { name: 'Einloggen' }).click()
    ]);
    await page.getByRole('button', { name: 'Bestellungen' }).click();

    await expect(page.locator('#ordersList')).toContainText(payload);
    await expect(page.locator('#ordersList .xss-probe')).toHaveCount(0);
    await page.getByRole('button', { name: 'Details' }).click();
    await expect(page.locator('#orderDetailsBody')).toContainText(payload);
    await expect(page.locator('#orderDetailsBody .xss-probe')).toHaveCount(0);
    await expect(page.locator('[data-backend-action="mark-item-picked-up"][data-item-id="999"]')).toHaveCount(0);
    expect(injectedPickupRequests).toBe(0);
});

test('rendert öffentliche und eigene Bewertungen als Text statt als HTML', async ({ page }) => {
    const payload = '<button class="xss-probe" data-backend-action="mark-item-picked-up">Nicht ausführen</button>';

    await page.route(`**/products/${TEST_PRODUCT.id}/reviews`, route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
            rating: 5,
            reviewText: payload,
            createdAt: payload,
            firstName: payload,
            lastName: payload
        }])
    }));

    await page.goto('/');
    const productCard = page.locator('#productGrid .product-card', { hasText: TEST_PRODUCT.title });
    await productCard.getByRole('button', { name: 'Details' }).click();

    await expect(page.locator('#modalProductReviews')).toContainText(payload);
    await expect(page.locator('#modalProductReviews .xss-probe')).toHaveCount(0);

    await page.route('**/my-profile', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            customerNo: 'TEST-XSS',
            email: TEST_USER.email,
            firstName: 'Test',
            lastName: 'Kunde',
            emailVerified: 1
        })
    }));
    await page.route('**/my-orders?*', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            items: [{
                id: 9101,
                order_no: 'R-REVIEW-XSS',
                status: 'returned',
                payment_status: 'paid',
                items: [{ id: 9102, itemStatus: 'returned_ok', returnStatus: 'returned_ok' }]
            }],
            pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
            filterOptions: {
                years: [], months: [], statuses: [], returnStatuses: [], paymentStatuses: []
            }
        })
    }));
    await page.route('**/my-orders/9101', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            id: 9101,
            order_no: 'R-REVIEW-XSS',
            status: 'returned',
            payment_status: 'paid',
            customer_first_name: 'Test',
            customer_last_name: 'Kunde',
            items: [{
                id: 9102,
                productId: TEST_PRODUCT.id,
                title: TEST_PRODUCT.title,
                rentalStart: '2026-09-01',
                rentalEnd: '2026-09-02',
                pricePerDay: 49.90,
                deposit: 150,
                itemStatus: 'returned_ok',
                returnStatus: 'returned_ok',
                review: { rating: 5, reviewText: payload, createdAt: payload },
                returnImages: []
            }],
            payments: []
        })
    }));

    await page.goto('/profile.html');
    await page.locator('#nav-orders').click();
    await page.getByRole('button', { name: 'Details anzeigen' }).click();
    await expect(page.locator('#myOrderDetailsBody')).toContainText(payload);
    await expect(page.locator('#myOrderDetailsBody .xss-probe')).toHaveCount(0);
});

test('führt die Rückgabemaske mit Schadensdokumentation und wählbarem Zahlungsweg aus', async ({ page }) => {
    const rentalStart = futureDate(20);
    const rentalEnd = futureDate(21);
    const apiErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => apiErrors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.route('**/admin/orders?*', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            items: [
                {
                    id: 77,
                    order_no: 'R202600077',
                    status: 'picked_up',
                    payment_status: 'paid',
                    payment_method: 'online',
                    return_status: 'pending',
                    return_case_status: 'open',
                    items: [{ id: 771, itemStatus: 'picked_up', returnStatus: 'pending' }]
                },
                {
                    id: 78,
                    order_no: 'R202600078',
                    status: 'picked_up',
                    payment_status: 'paid',
                    payment_method: 'cash',
                    return_status: 'returned_ok',
                    return_case_status: 'refund_pending',
                    items: [
                        { id: 781, itemStatus: 'returned_ok', returnStatus: 'returned_ok' },
                        { id: 782, itemStatus: 'cancelled', returnStatus: 'pending' }
                    ]
                }
            ],
            pagination: { page: 1, limit: 10, total: 2, totalPages: 1 },
            filterOptions: {
                years: ['2026'],
                months: ['08'],
                statuses: ['picked_up'],
                returnStatuses: ['pending', 'returned_ok'],
                paymentStatuses: ['paid']
            }
        })
    }));

    const orderDetails = {
        id: 77,
        order_no: 'R202600077',
        status: 'picked_up',
        payment_status: 'paid',
        payment_method: 'online',
        return_status: 'pending',
        return_case_status: 'open',
        customer_first_name: 'Test',
        customer_last_name: 'Kunde',
        customer_email: TEST_USER.email,
        items: [{
            id: 771,
            productId: TEST_PRODUCT.id,
            title: TEST_PRODUCT.title,
            rentalStart,
            rentalEnd,
            adjustedRentalStart: null,
            adjustedRentalEnd: null,
            pricePerDay: 80,
            deposit: 300,
            itemStatus: 'picked_up',
            returnStatus: 'pending',
            isDamaged: 0,
            isLate: 0,
            returnImages: [{
                id: 7799,
                imagePath: 'img/returns/return-test.png'
            }]
        }],
        payments: [{
            id: 7701,
            orderId: 77,
            orderItemId: 771,
            paymentType: 'rental_adjustment',
            paymentMethod: 'online',
            paymentStatus: 'pending',
            amount: 80,
            checkoutUrl: 'https://checkout.test.mollie.local/tr_test_open_7701'
        }]
    };

    await page.route('**/admin/orders/77', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(orderDetails)
    }));
    await page.route('**/img/returns/return-test.png', route => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nU8AAAAASUVORK5CYII=',
            'base64'
        )
    }));
    await page.route('**/admin/return-images/7799', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Foto gelöscht.' })
    }));
    await page.route('**/admin/order-items/771/return', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Rückgabe gespeichert.' })
        });
    });
    await page.route('**/admin/order-items/771/send-return-summary', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Abschlussmail versendet.' })
    }));

    await page.goto('/login.html');
    await page.locator('#username').fill(TEST_ADMIN.email);
    await page.locator('#password').fill(TEST_ADMIN.password);
    await Promise.all([
        page.waitForURL(/\/backend\.html$/),
        page.getByRole('button', { name: 'Einloggen' }).click()
    ]);
    await expect(page).toHaveTitle('Segnitz Rental - Backend');
    await expect(page).toHaveURL(/\/backend\.html$/);
    await page.getByRole('button', { name: 'Bestellungen' }).click();

    const completedCard = page.locator('#ordersList .card', { hasText: 'R202600078' });
    await expect(completedCard).toContainText('Zurückgegeben');
    await expect(completedCard).not.toContainText('Teilweise zurückgegeben');
    await expect(completedCard).toContainText('Erstattung offen');

    const openCard = page.locator('#ordersList .card', { hasText: 'R202600077' });
    await openCard.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByRole('link', { name: 'Zahlungslink öffnen' })).toHaveAttribute(
        'href',
        'https://checkout.test.mollie.local/tr_test_open_7701'
    );

    const deleteRequestPromise = page.waitForRequest(request =>
        request.method() === 'DELETE' && request.url().endsWith('/admin/return-images/7799')
    );
    await page.getByRole('button', { name: 'Foto löschen' }).click();
    await page.locator('#confirmModalConfirmBtn').click();
    await deleteRequestPromise;

    await page.getByRole('button', { name: 'Rückgabe', exact: true }).click();

    await expect(page.locator('#returnIsLate')).toBeDisabled();
    await expect(page.locator('#returnDamageDescriptionGroup')).toBeHidden();
    await page.locator('#returnIsDamaged').check();
    await expect(page.locator('#returnDamageDescriptionGroup')).toBeVisible();
    await page.locator('#returnDamageDescription').fill('Hydraulikleitung gerissen');
    await page.locator('#returnAdditionalChargeReason').fill('Reparatur der Hydraulikleitung');
    await page.locator('#returnAdditionalChargeAmount').fill('400');
    await expect(page.locator('#returnAdditionalChargePaymentMethodGroup')).toBeVisible();
    await expect(page.locator('#returnAdditionalChargePaymentMethod')).toHaveValue('online');
    await page.locator('#returnAdditionalChargePaymentMethod').selectOption('cash');
    const screenshot = await page.screenshot();
    expect(screenshot.byteLength).toBeGreaterThan(10_000);

    const returnRequestPromise = page.waitForRequest(request =>
        request.method() === 'PUT' && request.url().endsWith('/admin/order-items/771/return')
    );
    await page.getByRole('button', { name: 'Rückgabe speichern' }).click();
    await page.locator('#confirmModalConfirmBtn').click();
    const returnRequest = await returnRequestPromise;
    const payload = returnRequest.postDataJSON();

    expect(returnRequest.headers()['x-csrf-token']).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.isDamaged).toBe(true);
    expect(payload.damageDescription).toBe('Hydraulikleitung gerissen');
    expect(payload.additionalChargeReason).toBe('Reparatur der Hydraulikleitung');
    expect(Number(payload.additionalChargeAmount)).toBe(400);
    expect(payload.additionalChargePaymentMethod).toBe('cash');
    expect(apiErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
});

test('verarbeitet den paginierten Kundenauftrags-Vertrag und zeigt vor Rückgabe keine fiktive Kautionserstattung', async ({ page }) => {
    const apiErrors = [];
    page.on('pageerror', error => apiErrors.push(error.message));

    await page.route('**/my-profile', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            customerNo: 'TEST-0001',
            email: TEST_USER.email,
            firstName: 'Test',
            lastName: 'Kunde',
            emailVerified: 1
        })
    }));
    await page.route('**/my-orders?*', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            items: [{
                id: 1,
                order_no: 'R202600001',
                status: 'confirmed',
                payment_status: 'pending',
                created_at: '2026-08-13 10:00:00',
                items: [{ id: 11, itemStatus: 'active', returnStatus: null }]
            }],
            pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
            filterOptions: {
                years: ['2026'],
                months: ['08'],
                statuses: ['confirmed'],
                returnStatuses: [],
                paymentStatuses: ['pending']
            }
        })
    }));
    await page.route('**/my-orders/1', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            id: 1,
            order_no: 'R202600001',
            status: 'confirmed',
            payment_method: 'cash',
            payment_status: 'pending',
            customer_first_name: 'Test',
            customer_last_name: 'Kunde',
            items: [{
                id: 11,
                productId: 1,
                title: TEST_PRODUCT.title,
                rentalStart: '2026-09-01',
                rentalEnd: '2026-09-02',
                pricePerDay: 49.90,
                deposit: 150,
                itemStatus: 'active',
                depositRefundAmount: null,
                returnedAt: null,
                returnImages: []
            }],
            payments: [
                { paymentType: 'rental', paymentMethod: 'cash', paymentStatus: 'pending', amount: 99.80 },
                { paymentType: 'deposit', paymentMethod: 'cash', paymentStatus: 'pending', amount: 150 }
            ],
            returnImages: []
        })
    }));

    await page.goto('/profile.html');
    await page.locator('#nav-orders').click();
    await expect(page.locator('#ordersView')).toBeVisible();

    await expect(page.locator('#myOrdersList')).toContainText('R202600001');
    await expect(page.locator('#myOrdersList')).toContainText('1 Bestellung gefunden');
    await page.getByRole('button', { name: 'Details anzeigen' }).click();
    await expect(page.locator('#myOrderDetailsModal')).toBeVisible();
    await expect(page.locator('#myOrderDetailsBody')).toContainText('Kaution zurück');
    await expect(page.locator('#myOrderDetailsBody')).toContainText('0.00 €');
    expect(apiErrors).toEqual([]);
});

test('erklärt nach Bar-Fallback die automatisch erstattete Online-Doppelzahlung verständlich', async ({ page }) => {
    await page.route('**/orders/1/payment-status/sync?*', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            id: 1,
            orderNo: 'R202600001',
            payment_status: 'paid',
            payment_type: 'rental_adjustment',
            payment_method: 'cash',
            settled_by_cash: true,
            mollie_payment_status: 'paid',
            duplicate_refund_status: 'paid'
        })
    }));

    const syncRequestPromise = page.waitForRequest(request =>
        request.method() === 'POST' && request.url().includes('/orders/1/payment-status/sync?')
    );

    await page.goto('/index.html?payment=extension&orderId=1&paymentType=rental_adjustment&itemId=11');
    const syncRequest = await syncRequestPromise;

    await expect(page.locator('#paymentResultTitle')).toHaveText('Nachzahlung bereits bar beglichen');
    await expect(page.locator('#paymentResultText')).toContainText('automatisch zurückerstattet');
    await expect(page.locator('#final')).toContainText('doppelte Onlinezahlung wurde erstattet');
    expect(syncRequest.headers()['x-csrf-token']).toMatch(/^[a-f0-9]{64}$/);
});
