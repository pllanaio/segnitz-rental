"use strict";
const { test, expect } = require('@playwright/test');
const { TEST_ADMIN } = require('../support/test-database');
for (const mobile of [false, true]) {
    test(`öffentlicher Widerruf mit Bestätigung und Download (${mobile ? 'mobil' : 'Desktop'})`, async ({ page }) => {
        if (mobile) await page.setViewportSize({ width: 390, height: 844 });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto('/login.html');
        await page.getByRole('link', { name: 'Widerruf', exact: true }).click();
        await page.getByLabel('Ihr Name', { exact: true }).fill('Browser Testkunde');
        await page.getByLabel('E-Mail für die Eingangsbestätigung').fill('browser-withdrawal@example.invalid');
        const reference = `Browser-Vertrag-${Date.now()}`;
        await page.getByLabel('Bestellnummer oder eindeutige Vertragsbeschreibung').fill(reference);
        await page.getByLabel('Nur einen Teil widerrufen? (optional)').fill('Nur die Rüttelplatte');
        await page.getByRole('button', { name: 'Angaben prüfen' }).click();
        await expect(page.locator('#reviewDeclaration')).toContainText('Nur die Rüttelplatte');
        const response = page.waitForResponse(r => r.url().endsWith('/contract-declarations') && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Widerruf bestätigen', exact: true }).click();
        expect((await response).status()).toBe(201);
        await expect(page.locator('#declarationSuccessText')).toContainText('Eine weitere Bestätigung Ihrerseits ist nicht erforderlich');
        await expect(page.locator('#declarationReceipt')).toContainText(reference);
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Eingangsbestätigung speichern' }).click();
        expect((await download).suggestedFilename()).toContain('Eingangsbestätigung');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.goto('/login.html');
        await page.locator('#username').fill(TEST_ADMIN.email);
        await page.locator('#password').fill(TEST_ADMIN.password);
        await page.locator('#loginForm button[type="submit"]').click();
        await page.waitForURL(/backend/);
        await page.locator('[data-backend-view="declarations"]').click();
        const card = page.locator('#declarationsList article').filter({ hasText: reference });
        await expect(card).toContainText('Nur die Rüttelplatte');
        await card.locator('textarea').fill('Rückabwicklung durchgeführt');
        await card.getByRole('button', { name: 'Als bearbeitet dokumentieren' }).click();
        await expect(card).toContainText('Bearbeitung dokumentiert');
        expect(errors).toEqual([]);
    });
}
