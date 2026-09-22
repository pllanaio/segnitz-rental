'use strict';

// Main acceptance path: real Express endpoints and the isolated MySQL fixture.
// Only the external Mollie checkout domain is intercepted. No app endpoint or
// Flatpickr implementation is mocked. No traces/video/auth state are persisted.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createPrimaryScenarioFixtures, TEST_ADMIN, TEST_FOREIGN_USER } = require('../support/test-database');
const { addIsoCalendarDays } = require('../../utils/businessDate');

// A 200 online response navigates across origins. Assert its status and inspect
// the actual provider redirect plus persisted own API state; Chromium may drop
// the old renderer response body. Pending/cash bodies remain directly asserted.
const providerObservations = new WeakMap();
function captureCheckoutResponse(page, endpoint, online = true) {
    return page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST')
        .then(async response => ({ status: response.status(), body: online && response.status() === 200 ? null : await response.json() }));
}

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function login(page, identity) {
    await page.goto('/login.html');
    await page.locator('#username').fill(identity.email);
    await page.locator('#password').fill(identity.password);
    await Promise.all([
        page.waitForURL(identity.role === 'global_admin' ? /\/backend\.html$/ : /\/index\.html$/),
        page.getByRole('button', { name: 'Einloggen' }).click()
    ]);
}
async function selectRange(page, container, start, end) {
    for (const day of [start, end]) {
        for (let month = 0; month < 4; month++) {
            if (await page.locator(`${container} .flatpickr-day[aria-label="${day}"]:not(.hidden):not(.flatpickr-disabled)`).count()) break;
            await page.locator(`${container} .flatpickr-next-month`).click();
        }
        await page.locator(`${container} .flatpickr-day[aria-label="${day}"]:not(.hidden):not(.flatpickr-disabled)`).click();
    }
}
async function waitForPreparedPayment(page, orderId) {
    await expect.poll(async () => {
        const order = await readOrder(page, orderId);
        const latest = order.payments.filter(payment => payment.paymentType === 'initial_payment')
            .sort((first, second) => Number(second.id) - Number(first.id))[0];
        return typeof latest?.checkoutUrl === 'string' && latest.checkoutUrl.length > 0;
    }, { timeout: 30000, intervals: [100, 250, 500] }).toBe(true);
}
async function retryCheckoutThroughUi(page, orderId) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const responsePromise = captureCheckoutResponse(page, `/orders/${orderId}/mollie-checkout`);
        await page.locator('[data-frontend-action="retry-payment"]').click();
        const response = await responsePromise;
        const result = response.body;
        if (response.status === 200) {
            await expect(page).toHaveURL(/^https:\/\/checkout\.test\.mollie\.local\//);
            const redirect = providerObservations.get(page);
            expect(redirect.orderId).toBe(orderId);
            return { checkoutUrl: page.url() };
        }
        expect(response.status).toBe(202);
        expect(result.paymentPending).toBe(true);
        expect(Boolean(result.checkoutUrl)).toBe(false);
        await expect(page.locator('#globalAlertContainer')).toContainText(/vorbereitet/);
        await waitForPreparedPayment(page, orderId);
    }
    throw new Error('Online-Checkout blieb nach drei geprüften Pending-/Retry-Schritten unvollständig.');
}
async function checkout(page, method, product) {
    const start = today();
    await page.goto('/');
    await page.locator('#productSearchInput').fill('Kein passendes Testprodukt');
    await expect(page.locator('#productGrid .product-card')).toHaveCount(0);
    await page.locator('#productSearchInput').fill(product.title);
    await page.locator('#categoryFilterList button').filter({ hasText: 'Baumaschinen' }).click();
    const card = page.locator('#productGrid .product-card').filter({ hasText: product.title });
    await expect(card).toHaveCount(1);
    const detailsButton = card.getByRole('button', { name: 'Details' });
    await detailsButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#productDetailsModal')).toBeVisible();
    await expect.poll(() => page.locator('#productDetailsModal').evaluate(modal => modal.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    await expect.poll(() => page.locator('#productDetailsModal').evaluate(modal => modal.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#productDetailsModal')).not.toBeVisible();
    await detailsButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#modalCalendarContainer .flatpickr-calendar')).toBeVisible();
    const calendarLayout = await page.locator('#modalCalendarContainer').evaluate(container => {
        const calendar = container.querySelector('.flatpickr-calendar');
        const days = container.querySelector('.dayContainer');
        const rows = [...days.querySelectorAll('.flatpickr-day:not(.hidden)')].reduce((counts, day) => {
            const top = day.getBoundingClientRect().top;
            counts[top] = (counts[top] || 0) + 1;
            return counts;
        }, {});
        return { sevenColumns: Object.values(rows).every(count => count <= 7), fullWidth: Math.abs(calendar.clientWidth - days.clientWidth) <= 2 };
    });
    expect(calendarLayout).toEqual({ sevenColumns: true, fullWidth: true });
    await selectRange(page, '#modalCalendarContainer', start, addIsoCalendarDays(start, 1));
    await page.locator('#selectProductFromModal').click();
    await expect(page.locator('#cartItemCount')).toHaveText('1');
    await page.locator('[data-bs-target="#cartModal"]').click();
    await page.getByRole('button', { name: 'Zeitraum ändern' }).click();
    await page.locator('#editCartRentalRange').click();
    await selectRange(page, '.flatpickr-calendar.open', start, addIsoCalendarDays(start, 2));
    await page.locator('#saveCartItemRentalPeriodButton').click();
    await expect(page.locator('#cartItemEditModal')).not.toBeVisible();
    await page.locator('#cartModal [data-bs-dismiss="modal"]').first().click();
    // Real network outage: preserve the current cart and keep the step closed.
    await page.context().setOffline(true);
    await page.locator('#next-btn').click();
    await expect(page.locator('#globalAlertContainer')).toContainText('Warenkorb nicht verfügbar');
    await expect(page.locator('#cartReviewItems')).not.toBeVisible();
    await page.context().setOffline(false);
    // Doppelklick darf nur einen Schritt weiterführen, trotz asynchronem Cart.
    await page.locator('#next-btn').evaluate(button => { button.click(); button.click(); });
    await expect(page.locator('#cartReviewItems')).toBeVisible();
    await expect(page.locator('#page1 h4').first()).toBeFocused();
    await page.locator('#next-btn').click();
    await expect.poll(() => page.locator('#page2').evaluate(step => step.contains(document.activeElement))).toBe(true);
    await page.locator('#CustomerAddress').fill("Jean-Paul-Str. 12/3");
    await page.locator('#CustomerPhone').fill('+49 (0)931 123-456');
    await page.locator('#next-btn').click();
    const canvas = page.locator('#signature-pad canvas');
    await expect(canvas).toBeVisible();
    await expect.poll(() => page.locator('#page3').evaluate(step => step.contains(document.activeElement))).toBe(true);
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 50);
    await page.mouse.down();
    for (const [x, y] of [[45, 80], [70, 25], [95, 90], [140, 50], [180, 75]]) await page.mouse.move(box.x + x, box.y + y, { steps: 3 });
    await page.mouse.up();
    await page.locator('#agbs').check();
    await page.locator('#dsgvo').check();
    const paymentRadio = page.locator(method === 'cash' ? '#paymentMethodCash' : '#paymentMethodOnline');
    // The native radio is visually hidden; users activate its visible label.
    await page.locator('label.payment-option-card').filter({ has: paymentRadio }).click();
    await expect(paymentRadio).toBeChecked();
    const termsVersion = await page.locator('#termsVersion').inputValue();
    await page.locator('#termsVersion').evaluate(input => { input.value = 'obsolete-test-version'; });
    const conflictPromise = page.waitForResponse(response => response.url().endsWith('/data') && response.request().method() === 'POST');
    await page.locator('#submit-btn').press('Enter');
    expect((await conflictPromise).status()).toBe(409);
    await expect(page.locator('#globalAlertContainer')).toContainText('Vertragsdokumente wurden geändert');
    await expect(page.locator('#globalAlertContainer')).not.toContainText('Bitte loggen Sie sich ein');
    await page.locator('#termsVersion').evaluate((input, value) => { input.value = value; }, termsVersion);
    // Begin reading before Enter can finish cross-origin navigation.
    const responsePromise = captureCheckoutResponse(page, '/data', method === 'online');
    // Real semantic form submission, including the Enter-key path.
    await page.locator('#submit-btn').focus();
    await page.keyboard.press('Enter');
    const response = await responsePromise;
    let order = response.body;
    if (method === 'online' && response.status === 200) {
        await expect(page).toHaveURL(/^https:\/\/checkout\.test\.mollie\.local\//);
        const redirect = providerObservations.get(page);
        const persisted = await readOrder(page, redirect.orderId);
        order = { orderId: redirect.orderId, orderNo: persisted.order_no, checkoutUrl: page.url() };
    }
    expect(order.orderId).toBeGreaterThan(0);
    if (method === 'online' && response.status === 202) {
        expect(order.paymentPending).toBe(true);
        expect(Boolean(order.checkoutUrl)).toBe(false);
        await expect(page.locator('#paymentResultTitle')).toHaveText('Online-Zahlung wird vorbereitet');
        await waitForPreparedPayment(page, order.orderId);
        await retryCheckoutThroughUi(page, order.orderId);
    } else {
        expect(response.status).toBe(200);
        if (method === 'online') expect(typeof order.checkoutUrl).toBe('string');
    }
    return { ...order, start, end: addIsoCalendarDays(start, 2) };
}
async function adminDetails(page, orderNo, id) {
    await page.locator('[data-backend-view="orders"]').click();
    await page.locator('#orderSearchInput').fill(orderNo);
    await page.locator(`[data-backend-action="open-order-details"][data-order-id="${id}"]`).click();
    await expect(page.locator('#orderDetailsModal')).toBeVisible();
}
async function readOrder(page, id, admin = false) {
    const response = await page.request.get(`${admin ? '/admin/orders' : '/my-orders'}/${id}`);
    expect(response.status()).toBe(200);
    return response.json();
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    test(`Hauptablauf mit echten APIs: Barzahlung, Rückgabe, private Belege, Online-Retry (${viewport.width}px)`, async ({ browser, baseURL }, testInfo) => {
        test.setTimeout(180000);
        const scenario = await createPrimaryScenarioFixtures(`${viewport.width}-retry-${testInfo.retry}`);
        // Model distinct clients behind the explicitly trusted loopback test proxy.
        // Real global/client/auth limits remain enabled and unchanged.
        const clientBase = (viewport.width === 1280 ? 10 : 40) + testInfo.retry * 10;
        const contextOptions = offset => ({ baseURL, viewport, extraHTTPHeaders: { 'X-Forwarded-For': `192.0.2.${clientBase + offset}` } });
        const customerContext = await browser.newContext(contextOptions(1));
        const adminContext = await browser.newContext(contextOptions(2));
        const foreignContext = await browser.newContext(contextOptions(3));
        for (const context of [customerContext, adminContext, foreignContext]) {
            context.setDefaultTimeout(15000);
            context.setDefaultNavigationTimeout(30000);
        }
        const customer = await customerContext.newPage();
        const admin = await adminContext.newPage();
        const foreign = await foreignContext.newPage();
        const errors = [];
        for (const page of [customer, admin, foreign]) {
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => {
                // Intentional offline/409 branches have separately asserted UI.
                if (message.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|409 \(Conflict\)/.test(message.text())) errors.push(message.text());
            });
        }
        try {
            // Identities were explicitly prepared and verified only in the
            // isolated fixture DB by test/support/test-database.js.
            await login(customer, scenario.identity);
            const cash = await checkout(customer, 'cash', scenario.product);
            await expect(customer.locator('#paymentResultTitle')).toContainText('Barzahlungs-Miete bestätigt');
            let customerOrder = await readOrder(customer, cash.orderId);
            expect(customerOrder.customer_address).toBe('Jean-Paul-Str. 12/3');
            expect(customerOrder.customer_phone).toBe('+49 (0)931 123-456');
            expect(customerOrder.financialSummary.customerDueCents).toBe(29970);

            await login(admin, TEST_ADMIN);
            await adminDetails(admin, cash.orderNo, cash.orderId);
            await expect(admin.locator('[data-finance-status="payment_due"]')).toContainText('299,70');
            expect((await readOrder(admin, cash.orderId, true)).financialSummary).toEqual(customerOrder.financialSummary);
            await admin.locator('[data-payment-type="initial_payment"][data-backend-action="open-manual-payment"]').click();
            await admin.locator('#manualPaymentSubmitButton').click();
            await expect(admin.locator('#manualPaymentModal')).not.toBeVisible();
            await admin.locator('[data-backend-action="mark-item-picked-up"]').click();
            await expect(admin.locator('[data-backend-action="open-return-item"]')).toBeEnabled();
            await admin.locator('[data-backend-action="open-rental-period"]').click();
            await admin.locator('#rentalPeriodEnd').fill(addIsoCalendarDays(cash.end, 1));
            // The existing extension form creates an online claim; return
            // subsequently offsets its unpaid balance against the held deposit.
            await admin.locator('#submitOrderItemRentalPeriodButton').click();
            await expect(admin.locator('#orderItemRentalPeriodModal')).not.toBeVisible();
            await admin.locator('[data-backend-action="open-return-item"]').click();
            await admin.locator('#returnActualDate').fill(today());
            await admin.locator('#returnIsDamaged').check();
            await admin.locator('#returnDamageDescription').fill('Synthetischer Kratzer im Test');
            await admin.locator('#returnAdditionalChargeReason').fill('Synthetische Reparaturkosten');
            await admin.locator('#returnAdditionalChargeAmount').fill('25');
            await admin.locator('#returnImageUpload').setInputFiles({ name: 'test-return.png', mimeType: 'image/png', buffer: png });
            await admin.locator('#submitOrderItemReturnButton').click();
            await admin.locator('#confirmModalConfirmBtn').click();
            await expect(admin.locator('#orderItemReturnModal')).not.toBeVisible();
            let adminOrder = await readOrder(admin, cash.orderId, true);
            expect(adminOrder.items[0].itemStatus).toBe('returned_damaged');
            expect(adminOrder.financialSummary.offsetCents).toBe(4990);
            expect(adminOrder.financialSummary.refundDueCents).toBe(7510);
            expect(adminOrder.returnImages).toHaveLength(1);
            await admin.locator('[data-backend-action="open-manual-refund"]').first().click();
            await admin.locator('#manualPaymentSubmitButton').click();
            await expect(admin.locator('#manualPaymentModal')).not.toBeVisible();
            adminOrder = await readOrder(admin, cash.orderId, true);
            customerOrder = await readOrder(customer, cash.orderId);
            expect(customerOrder.financialSummary).toEqual(adminOrder.financialSummary);
            expect(customerOrder.financialSummary.refundDueCents).toBe(0);
            const privatePath = `/${customerOrder.returnImages[0].imagePath.replace(/^\//, '')}`;
            expect((await customer.request.get(privatePath)).status()).toBe(200);
            await login(foreign, TEST_FOREIGN_USER);
            expect((await foreign.request.get(`/my-orders/${cash.orderId}`)).status()).toBe(404);
            expect((await foreign.request.get(privatePath)).status()).toBe(404);
            await customer.goto('/profile.html');
            await customer.locator('[data-profile-view="orders"]').click();
            await customer.locator(`[data-profile-action="open-order-details"][data-order-id="${cash.orderId}"]`).click();
            await expect(customer.locator('[data-finance-status="settled"]')).toContainText('0,00');

            // External provider domain only. Provider responses are the same
            // contract-shaped disk fixtures used by the isolated backend adapter.
            await customer.route('https://checkout.test.mollie.local/**', async route => {
                const id = new URL(route.request().url()).pathname.slice(1);
                const fixture = JSON.parse(await fs.readFile(path.join(process.env.MOLLIE_TEST_FIXTURES_DIR, `${id}.json`), 'utf8'));
                providerObservations.set(customer, { orderId: Number(fixture.metadata.orderId) });
                await route.fulfill({ contentType: 'text/html', body: `<html lang="de"><title>Isolierter Zahlungsanbieter</title><a href="${baseURL}/index.html?payment=return&amp;orderId=${Number(fixture.metadata.orderId)}">Zurück zum Mietauftrag</a></html>` });
            });
            const online = await checkout(customer, 'online', scenario.product);
            await expect(customer).toHaveURL(/^https:\/\/checkout\.test\.mollie\.local\//);
            await customer.getByRole('link', { name: 'Zurück zum Mietauftrag' }).click();
            await expect(customer.locator('#paymentResultTitle')).toHaveText('Zahlung nicht abgeschlossen');
            const retry = await retryCheckoutThroughUi(customer, online.orderId);
            const paymentId = new URL(retry.checkoutUrl).pathname.slice(1);
            const fixtureFile = path.join(process.env.MOLLIE_TEST_FIXTURES_DIR, `${paymentId}.json`);
            const paid = JSON.parse(await fs.readFile(fixtureFile, 'utf8'));
            paid.status = 'paid'; paid.method = 'ideal'; paid.paidAt = new Date().toISOString();
            await fs.writeFile(`${fixtureFile}.tmp`, JSON.stringify(paid));
            await fs.rename(`${fixtureFile}.tmp`, fixtureFile);
            expect((await customer.request.post(`${baseURL}/webhooks/mollie`, { form: { id: paymentId } })).status()).toBe(200);
            await customer.getByRole('link', { name: 'Zurück zum Mietauftrag' }).click();
            await expect(customer.locator('#paymentResultTitle')).toHaveText('Mietvorgang erfolgreich bezahlt');
            const onlineOrder = await readOrder(customer, online.orderId);
            expect(onlineOrder.financialSummary.customerDueCents).toBe(0);
            expect(onlineOrder.financialSummary.depositHeldCents).toBe(15000);
            await admin.goto('/backend.html');
            await adminDetails(admin, online.orderNo, online.orderId);
            await admin.locator('[data-backend-action="cancel-order"]').click();
            await admin.locator('#confirmModalConfirmBtn').click();
            await expect.poll(async () => (await readOrder(admin, online.orderId, true)).status).toBe('cancelled');
            await expect.poll(async () => (await readOrder(admin, online.orderId, true)).financialSummary.refundDueCents, { timeout: 30000 }).toBe(0);
            expect(errors).toEqual([]);
        } finally {
            await Promise.allSettled([customerContext.close(), adminContext.close(), foreignContext.close()]);
        }
    });
}
