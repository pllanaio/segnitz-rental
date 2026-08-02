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
