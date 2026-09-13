'use strict';

// Deliberate, narrowly scoped HTTP faults exercise error presentation. These
// secondary tests do not replace the unmocked production-primary lifecycle.
const { test, expect } = require('@playwright/test');
const { TEST_USER, TEST_PRODUCT } = require('../support/test-database');

async function login(page) {
    await page.goto('/login.html');
    await page.locator('#username').fill(TEST_USER.email);
    await page.locator('#password').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'Einloggen' }).click();
    await expect(page).toHaveURL(/\/index\.html$/);
}

test('429 beim Login erhält Eingaben, sperrt doppelte Submits und erlaubt Wiederholung', async ({ page }) => {
    let release;
    let calls = 0;
    const paused = new Promise(resolve => { release = resolve; });
    await page.route('**/login', async route => {
        calls++;
        await paused;
        await route.fulfill({ status: 429, contentType: 'application/json', headers: { 'Retry-After': '1' }, body: JSON.stringify({ error: 'Zu viele Versuche. Bitte kurz warten und erneut versuchen.' }) });
    });
    await page.goto('/login.html');
    await page.locator('#username').fill(TEST_USER.email);
    await page.locator('#password').fill(TEST_USER.password);
    const submit = page.getByRole('button', { name: 'Einloggen' });
    await submit.evaluate(button => { button.click(); button.click(); });
    await expect.poll(() => calls).toBe(1);
    await expect(submit).toBeDisabled();
    await expect(page.locator('#loginForm')).toHaveAttribute('aria-busy', 'true');
    release();
    await expect(page.locator('#globalAlertContainer')).toContainText('Zu viele Versuche');
    await expect(submit).toBeEnabled();
    await expect(page.locator('#username')).toHaveValue(TEST_USER.email);
    // Never include a usable password/token in a failed assertion's output.
    expect(await page.locator('#password').evaluate(input => input.value.length > 0)).toBe(true);
    await page.unroute('**/login');
    await submit.click();
    await expect(page).toHaveURL(/\/index\.html$/);
});

test('503 ist kein leerer Warenkorb und keine freie Verfügbarkeit; Wiederholung lädt echte Daten', async ({ page }) => {
    await page.route('**/cart', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Datenbank vorübergehend nicht verfügbar.' }) }));
    await page.route(`**/products/${TEST_PRODUCT.id}/availability`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Verfügbarkeit vorübergehend nicht verfügbar.' }) }));
    await page.goto('/');
    await expect(page.locator('#globalAlertContainer')).toContainText('Warenkorb nicht verfügbar');
    await page.locator('[data-bs-target="#cartModal"]').click();
    await expect(page.locator('#cartItems')).toContainText('konnte nicht aktualisiert werden');
    await expect(page.locator('#cartItems')).not.toContainText('Warenkorb ist leer');
    await page.locator('#cartModal [data-bs-dismiss="modal"]').first().click();
    await page.locator('#productGrid .product-card').filter({ hasText: TEST_PRODUCT.title }).getByRole('button', { name: 'Details' }).click();
    await expect(page.locator('#modalRentalInfo')).toContainText('Verfügbarkeit unbekannt');
    await expect(page.locator('#selectProductFromModal')).toBeDisabled();
    await expect(page.locator('#modalCalendarContainer .flatpickr-calendar')).toHaveCount(0);
    await page.locator('#productDetailsModal [data-bs-dismiss="modal"]').first().click();
    await page.unroute('**/cart');
    await page.unroute(`**/products/${TEST_PRODUCT.id}/availability`);
    await page.locator('#productGrid .product-card').filter({ hasText: TEST_PRODUCT.title }).getByRole('button', { name: 'Details' }).click();
    await expect(page.locator('#modalCalendarContainer .flatpickr-calendar')).toBeVisible();
    await expect(page.locator('#modalRentalInfo')).not.toContainText('Verfügbarkeit unbekannt');
});

test('serverseitig beendete Session verhindert eine Änderung aus dem noch offenen Profil', async ({ page }) => {
    await login(page);
    await page.goto('/profile.html');
    const address = page.getByLabel('Adresse', { exact: true });
    await expect(address).toHaveValue('Teststrasse 1');
    // Real server invalidation, keeping the currently rendered form unchanged.
    // No own endpoint is mocked in this case and no auth material is returned.
    expect(await page.evaluate(async () => (await fetch('/logout', { method: 'POST' })).status)).toBe(200);
    await address.fill('Nicht gespeicherter Testweg 99');
    const result = page.waitForResponse(response => response.url().endsWith('/my-profile') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Daten speichern' }).click();
    expect([401, 403].includes((await result).status())).toBe(true);
    await expect(page.locator('#globalAlertContainer .alert-danger')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Daten speichern' })).toBeEnabled();
    await expect(address).toHaveValue('Nicht gespeicherter Testweg 99');
    await login(page);
    await page.goto('/profile.html');
    await expect(page.getByLabel('Adresse', { exact: true })).toHaveValue('Teststrasse 1');
});
