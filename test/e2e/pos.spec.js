'use strict';
const { expect, test } = require('@playwright/test');
const { TEST_ADMIN } = require('../support/test-database');
for (const width of [1280, 390]) {
    test(`POS Geräteverwaltung ist bei ${width}px bedienbar und speichert gerätespezifische Einstellungen`, async ({ page }) => {
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/login.html');
        await page.locator('#username').fill(TEST_ADMIN.email); await page.locator('#password').fill(TEST_ADMIN.password);
        await Promise.all([page.waitForURL(/backend\.html/), page.getByRole('button', { name: 'Einloggen' }).click()]);
        await page.locator('#nav-pos').click();
        await expect(page.locator('#posMode')).toContainText('Testmodus');
        const form = page.locator('[data-pos-settings="term_testone"]');
        await expect(form).toBeVisible();
        await form.locator('[name="label"]').fill(`Abholung ${width}`);
        await form.locator('[name="location"]').fill('Lager');
        await form.locator('[name="enabled"]').uncheck();
        await form.getByRole('button', { name: 'Einstellungen speichern' }).click();
        await expect(form.getByRole('heading')).toHaveText(`Abholung ${width}`);
        await page.reload(); await page.locator('#nav-pos').click();
        await expect(form.locator('[name="enabled"]')).not.toBeChecked();
        await expect(form.locator('[name="location"]')).toHaveValue('Lager');
        await expect(page.locator('[data-pos-settings="term_testtwo"] [name="enabled"]')).toBeChecked();
        await form.locator('[name="enabled"]').check();
        const saved = page.waitForResponse(response => response.url().endsWith('/admin/pos/terminals') && response.request().method() === 'GET');
        await form.getByRole('button', { name: 'Einstellungen speichern' }).click();
        await saved;
        await expect(form.locator('[name="enabled"]')).toBeChecked();
        await page.screenshot({ path: `test-results/pos-${width}.png`, fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        expect(errors).toEqual([]);
    });
}

test('POS Geräteauswahl sendet den Auftrag und zeigt ausstehende Testzahlungen ohne falsche Erfolgsmeldung', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/login.html');
    await page.locator('#username').fill(TEST_ADMIN.email); await page.locator('#password').fill(TEST_ADMIN.password);
    await Promise.all([page.waitForURL(/backend\.html/), page.getByRole('button', { name: 'Einloggen' }).click()]);
    await page.locator('#nav-pos').click();
    await expect(page.locator('[data-pos-settings="term_testtwo"]')).toBeVisible();
    await page.route('**/admin/pos/payments', async route => {
        const body = route.request().postDataJSON();
        expect(body.orderId).toBe(88); expect(body.terminalId).toBe('term_testtwo'); expect(body.paymentType).toBe('initial_payment');
        await route.fulfill({ status: 202, json: { recordId: 888, terminalId: 'term_testtwo' } });
    });
    await page.route('**/admin/pos/payments/888/sync', route => route.fulfill({ json: { status: 'pending', simulationUrl: 'https://www.mollie.com/test-payment' } }));
    await page.evaluate(() => {
        const panel = document.createElement('div'); panel.id = 'testPaymentPanel';
        panel.innerHTML = renderOrderPaymentActionPanel({ id: 88, status: 'confirmed', payment_method: 'cash', payment_status: 'pending', payments: [
            { id: 1, paymentType: 'rental', paymentMethod: 'cash', paymentStatus: 'pending', amount: 100 },
            { id: 2, paymentType: 'deposit', paymentMethod: 'cash', paymentStatus: 'pending', amount: 300 }
        ] });
        document.getElementById('posView').append(panel);
    });
    await page.getByRole('button', { name: 'Kartenzahlung vor Ort' }).click();
    await expect(page.locator('#posPaymentStart')).toBeEnabled();
    await page.locator('#posPaymentTerminal').selectOption('term_testtwo');
    await page.locator('#posPaymentStart').click();
    await expect(page.locator('#posPaymentStatus')).toContainText('geprüft');
    await expect(page.locator('#posSimulation')).toBeVisible();
    await expect(page.locator('#posPaymentStart')).toBeHidden();
    await page.locator('#posPaymentModal').getByRole('button', { name: 'Schließen', exact: true }).last().click();
    await expect(page.locator('#posPaymentModal')).not.toBeVisible();
    expect(errors).toEqual([]);
});
