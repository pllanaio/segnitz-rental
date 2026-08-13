'use strict';

const { expect, test } = require('@playwright/test');
const { TEST_PRODUCT, TEST_USER } = require('../support/test-database');

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
    await page.route('**/orders/1/payment-status?*', route => route.fulfill({
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

    await page.goto('/index.html?payment=extension&orderId=1&paymentType=rental_adjustment&itemId=11');

    await expect(page.locator('#paymentResultTitle')).toHaveText('Nachzahlung bereits bar beglichen');
    await expect(page.locator('#paymentResultText')).toContainText('automatisch zurückerstattet');
    await expect(page.locator('#final')).toContainText('doppelte Onlinezahlung wurde erstattet');
});
