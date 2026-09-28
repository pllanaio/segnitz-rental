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

test('bestätigt die E-Mail und erlaubt den Login mit dem Registrierungskennwort', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const email = `registration-${Date.now()}@example.invalid`;
    const password = 'RegistrationBrowser1!';
    await page.goto('/register.html');
    for (const [id, value] of Object.entries({ firstName: 'Muster', lastName: 'Kunde', email,
        phone: '0123456789', address: 'Teststrasse 2', zip: '97070', city: 'Wuerzburg', password, passwordRepeat: password })) {
        await page.locator(`#${id}`).fill(value);
    }
    const registrationResponse = page.waitForResponse(response => response.url().endsWith('/register-customer') && response.request().method() === 'POST');
    await page.locator('#registerSubmitButton').click();
    expect((await registrationResponse).status()).toBe(201);
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection(require('../../config/db'));
    let token;
    let passwordHash;
    try {
        const [[user]] = await connection.execute('SELECT verification_token, password FROM users WHERE username = ?', [email]);
        token = user.verification_token;
        passwordHash = user.password;
    } finally { await connection.end(); }
    // Open the actual mail link in a separate browser context, as a mail client would.
    const mailContext = await page.context().browser().newContext();
    try {
        const mailPage = await mailContext.newPage();
        mailPage.on('pageerror', error => errors.push(error.message));
        await mailPage.goto(new URL(`/verify-email?token=${token}`, page.url()).href);
        await mailPage.getByRole('button', { name: 'E-Mail bestätigen', exact: true }).click();
        await expect(mailPage).toHaveURL(/\/email-verified\.html$/);
        await expect(mailPage.getByRole('heading', { name: 'E-Mail erfolgreich bestätigt' })).toBeVisible();
        await mailPage.getByRole('link', { name: 'Jetzt einloggen' }).click();
        await expect(mailPage.locator('#passwordResetModal')).not.toBeVisible();
        await mailPage.locator('#username').fill(email);
        await mailPage.locator('#password').fill(password);
        const loginResponse = mailPage.waitForResponse(response => response.url().endsWith('/login') && response.request().method() === 'POST');
        await mailPage.locator('#loginForm button[type="submit"]').click();
        expect((await loginResponse).status()).toBe(200);
    } finally { await mailContext.close(); }
    const check = await mysql.createConnection(require('../../config/db'));
    try {
        const [[user]] = await check.execute('SELECT password, reset_token, email_verified FROM users WHERE username = ?', [email]);
        expect(user.password).toBe(passwordHash);
        expect(user.reset_token).toBeNull();
        expect(Number(user.email_verified)).toBe(1);
    } finally { await check.end(); }
    expect(errors).toEqual([]);
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

    await page.locator('#productList .card').filter({ hasText: TEST_PRODUCT.title }).getByRole('button', { name: 'Bearbeiten', exact: true }).click();
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
    await page.getByRole('button', { name: 'Bestellung öffnen' }).click();
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
    await page.route('**/admin/return-images/7799', route => {
        orderDetails.items[0].returnImages = [];
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'Foto gelöscht.' }) });
    });
    const photoUploads = [];
    await page.route('**/admin/order-items/771/return-images', async route => {
        photoUploads.push(route.request().postDataBuffer().toString('latin1'));
        orderDetails.items[0].returnImages = [{ id: 7800, imagePath: 'img/returns/return-test.png' }, { id: 7801, imagePath: 'img/returns/return-test.png' }];
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ images: orderDetails.items[0].returnImages }) });
    });
    let returnAttempts = 0;
    await page.route('**/admin/return-images/7800', route => {
        orderDetails.items[0].returnImages = orderDetails.items[0].returnImages.filter(image => image.id !== 7800);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'Foto gelöscht.' }) });
    });
    await page.route('**/admin/order-items/771/return', async route => {
        expect(photoUploads).toHaveLength(1);
        returnAttempts += 1;
        if (returnAttempts === 1) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Test: Bitte Rückgabedaten prüfen.' }) });
        orderDetails.status = 'returned';
        orderDetails.items[0].itemStatus = 'returned_damaged';
        orderDetails.items[0].returnedAt = new Date().toISOString();
        orderDetails.payments = [{
            id: 7702, orderId: 77, orderItemId: 771,
            paymentType: 'return_additional_charge', paymentMethod: 'cash',
            paymentStatus: 'pending', amount: 100
        }];
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

    await page.getByRole('button', { name: 'Rückgabe', exact: true }).click();
    const deleteRequestPromise = page.waitForRequest(request =>
        request.method() === 'DELETE' && request.url().endsWith('/admin/return-images/7799')
    );
    await page.locator('#returnExistingImages').getByRole('button', { name: 'Foto löschen' }).click();
    await page.locator('#confirmModalConfirmBtn').click();
    const deleteRequest = await deleteRequestPromise;
    expect(deleteRequest.headers()['x-csrf-token']).toMatch(/^[a-f0-9]{64}$/);
    await expect(page.locator('#returnExistingImages img')).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Fotos hochladen', exact: true })).toHaveCount(0);
    const photo = name => ({ name, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64') });
    await page.locator('#returnImageUpload').setInputFiles([photo('first.png'), photo('second.png')]);
    await page.locator('#returnImageUpload').setInputFiles([photo('third.png')]);
    await expect(page.locator('#returnSelectedImagePreview img')).toHaveCount(3);
    await page.getByRole('button', { name: 'second.png entfernen', exact: true }).click();
    await expect(page.locator('#returnSelectedImagePreview img')).toHaveCount(2);
    expect(photoUploads).toHaveLength(0);

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
    await page.locator('#returnSelectedImagePreview').scrollIntoViewIfNeeded();
    const screenshot = await page.screenshot(process.env.QA_SCREENSHOT_DIR ? { path: require('node:path').join(process.env.QA_SCREENSHOT_DIR, 'return-photo-controls.png') } : {});
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#returnSelectedImagePreview').scrollIntoViewIfNeeded();
    await expect(page.locator('#returnSelectedImagePreview button')).toHaveCount(2);
    await page.screenshot(process.env.QA_SCREENSHOT_DIR ? { path: require('node:path').join(process.env.QA_SCREENSHOT_DIR, 'return-photo-controls-mobile.png') } : {});
    await page.setViewportSize({ width: 1280, height: 720 });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);

    // A rejected finalization must leave uploaded photos individually removable.
    await page.getByRole('button', { name: 'Rückgabe speichern' }).click();
    await page.locator('#confirmModalConfirmBtn').click();
    await expect(page.getByText('Test: Bitte Rückgabedaten prüfen.', { exact: true })).toBeVisible();
    await expect(page.locator('#returnSelectedImagePreview img')).toHaveCount(0);
    await expect(page.locator('#returnExistingImages img')).toHaveCount(2);
    await page.locator('#returnExistingImages [data-image-id="7800"]').click();
    await page.locator('#confirmModalConfirmBtn').click();
    await expect(page.locator('#returnExistingImages img')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Rückgabe speichern' })).toBeEnabled();

    const returnRequestPromise = page.waitForRequest(request =>
        request.method() === 'PUT' && request.url().endsWith('/admin/order-items/771/return')
    );
    await page.getByRole('button', { name: 'Rückgabe speichern' }).click();
    await page.locator('#confirmModalConfirmBtn').click();
    const returnRequest = await returnRequestPromise;
    const payload = returnRequest.postDataJSON();
    expect(photoUploads).toHaveLength(1);
    expect(photoUploads[0]).not.toContain('filename="second.png"');
    for (const name of ['first.png', 'third.png']) {
        expect(photoUploads[0].split(`filename="${name}"`)).toHaveLength(2);
    }

    expect(returnRequest.headers()['x-csrf-token']).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.isDamaged).toBe(true);
    expect(payload.damageDescription).toBe('Hydraulikleitung gerissen');
    expect(payload.additionalChargeReason).toBe('Reparatur der Hydraulikleitung');
    expect(Number(payload.additionalChargeAmount)).toBe(400);
    expect(payload.additionalChargePaymentMethod).toBe('cash');
    const returnAction = page.locator('#orderDetailsBody .cash-action-row', { hasText: 'Rückgabe-Nachzahlung' });
    await expect(returnAction).toContainText('100.00 €');
    await expect(returnAction.getByRole('button', { name: 'Nachzahlung vor Ort kassieren' })).toBeVisible();
    await expect(page.locator('#orderDetailsBody').getByRole('button', { name: 'Foto löschen' })).toHaveCount(0);
    await expect(page.locator('#orderDetailsBody img[src="/img/returns/return-test.png"]').first()).toBeVisible();

    // The same top-level action must be available for online charges, even
    // while no checkout URL is available or after the online payment failed.
    for (const paymentStatus of ['pending', 'authorized', 'failed', 'cancelled', 'expired']) {
        orderDetails.payments[0].paymentMethod = 'online';
        orderDetails.payments[0].paymentStatus = paymentStatus;
        orderDetails.payments[0].checkoutUrl = 'https://checkout.test.mollie.local/tr_return';
        await page.evaluate(order => renderOrderDetails(order), orderDetails);
        await expect(returnAction.getByRole('button', { name: 'Nachzahlung vor Ort kassieren' })).toBeVisible();
        await expect(returnAction.getByRole('link', { name: 'Zahlungslink öffnen' }))
            .toHaveCount(['pending', 'authorized'].includes(paymentStatus) ? 1 : 0);
    }
    orderDetails.payments[0].paymentStatus = 'pending';
    orderDetails.payments[0].checkoutUrl = null;
    await page.evaluate(order => renderOrderDetails(order), orderDetails);
    await returnAction.getByRole('button', { name: 'Nachzahlung vor Ort kassieren' }).click();
    await expect(page.locator('#manualPaymentModal')).toBeVisible();
    await page.locator('#manualPaymentModal [data-bs-dismiss="modal"]').first().click();
    for (const paymentStatus of ['paid', 'replaced', 'settled_with_deposit', 'refunded']) {
        orderDetails.payments[0].paymentStatus = paymentStatus;
        await page.evaluate(order => renderOrderDetails(order), orderDetails);
        await expect(returnAction).toHaveCount(0);
    }
    expect(apiErrors).toEqual([]);
    expect(consoleErrors).toEqual([expect.stringContaining('400 (Bad Request)')]);
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
                returnStatuses: ['pending', 'returned_late_damaged'],
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

    await expect(page.locator('#myOrderStatusFilter option[value="confirmed"]')).toHaveText('Bestätigt');
    await expect(page.locator('#myOrderReturnStatusFilter option[value="pending"]')).toHaveText('Offen');
    await expect(page.locator('#myOrderReturnStatusFilter option[value="returned_late_damaged"]')).toHaveText('Verspätet und beschädigt');
    await expect(page.locator('#myOrderPaymentStatusFilter option[value="pending"]')).toHaveText('Ausstehend');

    await expect(page.locator('#myOrdersList')).toContainText('R202600001');
    await expect(page.locator('#myOrdersList')).toContainText('1 Bestellung gefunden');
    await page.getByRole('button', { name: 'Bestellung öffnen' }).click();
    await expect(page.locator('#myOrderDetailsModal')).toBeVisible();
    await expect(page.locator('#myOrderDetailsBody')).toContainText('Kaution zurück');
    await expect(page.locator('#myOrderDetailsBody')).toContainText('0.00 €');
    const appearance = await page.evaluate(() => {
        const row = document.createElement('div');
        row.className = 'checkout-summary-row';
        row.innerHTML = `<strong>${getReturnBadge('returned_late_damaged')}</strong>`;
        document.getElementById('myOrderDetailsBody').appendChild(row);
        const color = getComputedStyle(row.querySelector('.badge')).color;
        row.remove();
        return { color, filter: getComputedStyle(document.querySelector('#myOrderDetailsModal .btn-close')).filter };
    });
    expect(appearance.color).toBe('rgb(255, 255, 255)');
    expect(appearance.filter).toContain('invert(1)');
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

    await expect(page.locator('#paymentResultTitle')).toHaveText('Nachzahlung bereits vor Ort beglichen');
    await expect(page.locator('#paymentResultText')).toContainText('automatisch zurückerstattet');
    await expect(page.locator('#final')).toContainText('doppelte Onlinezahlung wurde erstattet');
    expect(syncRequest.headers()['x-csrf-token']).toMatch(/^[a-f0-9]{64}$/);
});

for (const [status, title, message] of [
    ['failed', 'Zahlung fehlgeschlagen', 'Mollie konnte Ihre Zahlung nicht abschließen'],
    ['cancelled', 'Zahlung abgebrochen', 'Der Zahlungsvorgang bei Mollie wurde abgebrochen'],
    ['expired', 'Zahlung verfallen', 'Dieser Zahlungslink ist nicht mehr gültig']
]) {
    test(`zeigt Mollie ${status} für Bestellung und Nachzahlungen verständlich an`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/orders/1/payment-status/sync**', route => route.fulfill({
            json: { id: 1, orderNo: 'R202600001', status: 'payment_failed', payment_status: status }
        }));
        for (const context of ['return', 'extension', 'return_charge']) {
            const extra = context === 'return' ? '' :
                `&paymentType=${context === 'extension' ? 'rental_adjustment' : 'return_additional_charge'}&itemId=11`;
            await page.goto(`/index.html?payment=${context}&orderId=1${extra}`);
            await expect(page.locator('#paymentResultTitle')).toHaveText(title);
            await expect(page.locator('#paymentResultText')).toContainText(message);
            await expect(page.locator('#paymentResultIcon')).toHaveClass(/payment-error-icon/);
            const retry = page.getByRole('button', { name: 'Online-Zahlung erneut starten' });
            if (context === 'return') {
                await expect(retry).toBeVisible();
                await page.route('**/orders/1/mollie-checkout', route => route.fulfill({
                    json: { checkoutUrl: '/index.html?retry-checkout=1' }
                }));
                await retry.click();
                await expect(page).toHaveURL(/retry-checkout=1/);
            } else {
                await expect(retry).toHaveCount(0);
                await expect(page.locator('#final')).toContainText('neuen Zahlungslink');
                await expect(page.locator('#final')).toContainText('R202600001');
            }
        }
        expect(errors).toEqual([]);
    });
}

test('zeigt vor dem Mollie-Abgleich keine Erfolgsmeldung und vertraut keinem URL-Status', async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/orders/1/payment-status/sync', async route => {
        await gate;
        await route.fulfill({ json: { id: 1, payment_status: 'failed' } });
    });
    try {
        await page.goto('/index.html?payment=return&orderId=1&status=paid');
        await expect(page.locator('#paymentResultTitle')).toHaveText('Zahlungsstatus wird geprüft');
        await expect(page.locator('#paymentResultText')).not.toContainText('erfolgreich');
    } finally { release(); }
    await expect(page.locator('#paymentResultTitle')).toHaveText('Zahlung fehlgeschlagen');
});


for (const context of ['return', 'extension', 'return_charge']) {
    test(`Mollie-Rückleitung wartet nach Abruffehler auf bestätigte Zahlung: ${context}`, async ({ page }) => {
        let attempts = 0;
        await page.route('**/orders/1/payment-status/sync**', async route => {
            attempts++;
            if (attempts === 1) return route.fulfill({ status: 503, json: { error: 'Temporärer Abgleichfehler' } });
            return route.fulfill({ json: { id: 1, payment_status: attempts === 2 ? 'pending' : 'paid' } });
        });
        await page.goto(`/index.html?payment=${context}&orderId=1${context === 'return' ? '' : `&paymentType=${context === 'extension' ? 'rental_adjustment' : 'return_additional_charge'}&itemId=2`}`);
        await expect(page.locator('#paymentResultTitle')).toHaveText('Zahlungsstatus wird geprüft');
        await expect(page.locator('[data-frontend-action="retry-payment"]')).toHaveCount(0);
        await expect(page.locator('#paymentResultIcon')).not.toHaveClass(/payment-error-icon/);
        await expect(page.locator('#paymentResultTitle')).toContainText(/erfolgreich/, { timeout: 10000 });
        expect(attempts).toBe(3);
    });
}

test('Mollie-Prüfung bleibt bei Ausfall neutral und erlaubt nur erneute Statusprüfung', async ({ page }) => {
    test.setTimeout(45000);
    let attempts = 0;
    await page.route('**/orders/1/payment-status/sync**', async route => {
        attempts++;
        await route.fulfill(attempts <= 6 ? { status: 503, json: { error: 'Nicht erreichbar' } } : { json: { id: 1, payment_status: 'paid' } });
    });
    await page.goto('/index.html?payment=return&orderId=1&status=paid');
    await expect(page.locator('#paymentResultTitle')).toHaveText('Zahlungsstatus noch nicht bestätigt', { timeout: 30000 });
    await expect(page.locator('#paymentResultIcon')).not.toHaveClass(/payment-error-icon/);
    await expect(page.locator('[data-frontend-action="retry-payment"]')).toHaveCount(0);
    await expect(page.locator('#paymentResultText')).toContainText('Bitte zahlen Sie nicht erneut');
    await page.getByRole('button', { name: 'Zahlungsstatus erneut prüfen', exact: true }).click();
    await expect(page.locator('#paymentResultTitle')).toHaveText('Mietvorgang erfolgreich bezahlt');
    expect(attempts).toBe(7);
});

test('Kalender und Warenkorb-Datumswahl funktionieren ohne CDN', async ({ page }) => {
    await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const card = page.locator('#productGrid .product-card', { hasText: TEST_PRODUCT.title });
    await card.getByRole('button', { name: 'Details' }).click();
    await expect(page.locator('#productDetailsModal')).toBeVisible();
    await expect(page.locator('#modalRentalRange')).toBeHidden();
    await expect(page.locator('#modalCalendarContainer .flatpickr-calendar')).toBeVisible();
    // Move to a future month and select an actual range through the calendar UI.
    await page.locator('#modalCalendarContainer .flatpickr-next-month').click();
    const days = page.locator('#modalCalendarContainer .flatpickr-day:not(.flatpickr-disabled):not(.prevMonthDay):not(.nextMonthDay)');
    await days.nth(4).click();
    await days.nth(6).click();
    await expect(page.locator('#modalRentalInfo')).toContainText('3 Tage');
    await page.locator('#selectProductFromModal').click();
    await expect(page.locator('#cartItemCount')).toHaveText('1');
    await page.locator('[data-bs-target="#cartModal"]').click();
    await page.getByRole('button', { name: 'Zeitraum ändern' }).click();
    await expect(page.locator('#cartItemEditModal')).toBeVisible();
    await page.locator('#editCartRentalRange').click();
    await expect(page.locator('.flatpickr-calendar.open')).toBeVisible();
    expect(errors).toEqual([]);
});
