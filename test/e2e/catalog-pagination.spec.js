'use strict';
// Secondary UI contract/fault tests; production-primary still uses the real
// catalog, calendar and every own API against isolated MySQL without mocks.
const { test, expect } = require('@playwright/test');

function catalog(page = 1, total = 25, query = '') {
    const count = Math.min(12, total - (page - 1) * 12);
    return {
        products: Array.from({ length: count }, (_, index) => ({
            id: 8100 + (page - 1) * 12 + index, product_key: `KATALOG-${page}-${index}`,
            title: `${query || 'Katalogseite'} ${(page - 1) * 12 + index + 1}`,
            price_per_day: 10, deposit: 20, is_active: 1, images: [], categories: [{ name: 'Werkzeuge' }]
        })),
        pagination: { page, pageSize: 12, total, totalPages: Math.ceil(total / 12) },
        categories: [{ name: 'Werkzeuge', count: total }], searchTotal: total, categoriesTruncated: false
    };
}

test('catalog pages request bounded server data and debounce combined search/category', async ({ page }) => {
    const requests = [];
    const browserErrors = [];
    page.on('pageerror', () => browserErrors.push('pageerror'));
    page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text())) browserErrors.push('CSP'); });
    await page.route('**/catalog?**', route => {
        const query = new URL(route.request().url()).searchParams;
        requests.push(Object.fromEntries(query));
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog(Number(query.get('page')), query.get('q') ? 1 : 25, query.get('q'))) });
    });
    await page.route('**/products/*/current-availability', route => route.fulfill({ contentType: 'application/json', body: '{"available":true}' }));
    await page.goto('/');
    await expect(page.locator('#productGrid .product-card')).toHaveCount(12);
    await page.getByRole('button', { name: 'Seite 2', exact: true }).click();
    await expect(page.locator('#productGrid .product-card-title').first()).toHaveText('Katalogseite 13');
    await expect(page.locator('#productGrid')).toBeFocused();
    expect(requests.at(-1)).toMatchObject({ page: '2', pageSize: '12', category: 'all' });
    await page.locator('#categoryFilterList button').filter({ hasText: 'Werkzeuge' }).click();
    await expect(page.locator('#productGrid .product-card-title').first()).toHaveText('Katalogseite 1');
    const before = requests.length;
    await page.locator('#productSearchInput').evaluate(input => {
        for (const value of ['S', 'Sä', 'Säge']) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await expect(page.locator('#productGrid .product-card-title')).toHaveText('säge 1');
    expect(requests.slice(before)).toEqual([{ page: '1', pageSize: '12', q: 'säge', category: 'werkzeuge' }]);
    expect(browserErrors).toEqual([]);
});

test('catalog HTTP 503 remains an explicit retryable error rather than an empty result', async ({ page }) => {
    let unavailable = true;
    await page.route('**/catalog?**', route => route.fulfill({
        status: unavailable ? 503 : 200, contentType: 'application/json',
        body: JSON.stringify(unavailable ? { error: 'Datenbank vorübergehend nicht verfügbar.' } : catalog(1, 1))
    }));
    await page.route('**/products/*/current-availability', route => route.fulfill({ contentType: 'application/json', body: '{"available":false}' }));
    await page.goto('/');
    await expect(page.locator('#productGrid [role="alert"]')).toContainText('konnten nicht geladen werden');
    await expect(page.locator('#productGrid')).not.toContainText('keine Produkte gefunden');
    unavailable = false;
    await page.getByRole('button', { name: 'Produkte erneut laden' }).click();
    await expect(page.locator('#productGrid .product-card')).toHaveCount(1);
    await expect(page.locator('#productGrid .availability-badge')).toHaveText('Aktuell vermietet');
});
