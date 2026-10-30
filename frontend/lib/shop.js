// Pure catalogue, cart and checkout helpers of the public shop page. They contain
// no DOM access so the unit tests can exercise them directly.
export const VAT_RATE = 0.19;
export const PRODUCTS_PER_PAGE = 12;
export const CUSTOMER_REQUIRED_FIELDS = [
    'FirstName',
    'LastName',
    'CustomerEmail',
    'CustomerPhone',
    'CustomerAddress',
    'CustomerZip',
    'CustomerCity'
];

export function calculateRentalDays(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

export function formatCurrency(value) {
    return `${Number(value || 0).toFixed(2).replace('.', ',')} €`;
}

export function getItemPricePerDay(item) {
    return Number(item.pricePerDay ?? item.price_per_day ?? item.price_per_day_gross ?? 0);
}

export function getItemDeposit(item) {
    return Number(item.deposit ?? 0);
}

export function calculateCartTotals(items) {
    return items.reduce((totals, item) => {
        const days = calculateRentalDays(item.rentalStart, item.rentalEnd);
        totals.rentalTotal += days * getItemPricePerDay(item);
        totals.depositTotal += getItemDeposit(item);
        return totals;
    }, {
        rentalTotal: 0,
        depositTotal: 0
    });
}

export function splitGrossRental(rentalGross) {
    const rentalNet = rentalGross / (1 + VAT_RATE);
    return { rentalGross, rentalNet, rentalVat: rentalGross - rentalNet };
}

export function describeCartItemDuration(item) {
    const days = calculateRentalDays(item.rentalStart, item.rentalEnd);
    return item.rentalHours
        ? `${item.rentalHours} Stunden ab ${item.rentalStartTime}`
        : `${days} Tag${days === 1 ? '' : 'e'}`;
}

export function parseHourlyPrices(product) {
    return typeof product?.hourly_prices === 'string'
        ? JSON.parse(product.hourly_prices)
        : product?.hourly_prices;
}

export function getProductCategoryNames(product) {
    if (!Array.isArray(product.categories)) {
        return [];
    }

    return product.categories
        .map(category => typeof category === 'string' ? category : category.name)
        .filter(Boolean);
}

export function normalizeProductSearch(value) {
    return String(value ?? '')
        .toLocaleLowerCase('de')
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '');
}

export function productMatchesSearch(product, query, categoryNames = getProductCategoryNames) {
    const values = [product.title, product.description, product.product_key, product.manufacturer, product.model,
        product.product_kind, product.color, product.power_value, product.power_unit,
        product.operating_hours, product.mileage_km, ...categoryNames(product)];
    for (const [value, unit] of [
        [product.power_value, product.power_unit],
        [product.operating_hours, 'Betriebsstunden h'],
        [product.mileage_km, 'Kilometer km']
    ]) {
        if (value !== null && value !== undefined && value !== '') {
            values.push(value + ' ' + unit, Number(value).toLocaleString('de-DE') + ' ' + unit);
        }
    }
    const text = normalizeProductSearch(values.filter(value => value !== null && value !== undefined).join(' '));
    return normalizeProductSearch(query).trim().split(/\s+/).filter(Boolean).every(word => text.includes(word));
}

export function filterProducts(products, { category = 'all', query = '', kind = '' } = {}) {
    const byCategory = category === 'all'
        ? [...products]
        : products.filter(product => getProductCategoryNames(product)
            .some(name => name.toLowerCase() === category.toLowerCase()));

    return byCategory.filter(product => (!kind || product.product_kind === kind) && productMatchesSearch(product, query));
}

export function countCategories(products) {
    const categoryMap = new Map();

    products.forEach(product => {
        getProductCategoryNames(product).forEach(categoryName => {
            categoryMap.set(categoryName, (categoryMap.get(categoryName) || 0) + 1);
        });
    });

    return [...categoryMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'));
}

export function listProductKinds(products) {
    return [...new Set(products.map(product => product.product_kind).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'de'));
}

export function sortReviews(reviews) {
    return (reviews || []).sort((a, b) => {
        const ratingA = Number(a.rating || 0);
        const ratingB = Number(b.rating || 0);

        if (ratingB !== ratingA) {
            return ratingB - ratingA;
        }

        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
}

export function rangesOverlap(startDate, endDate, period) {
    return startDate <= period.rentalEnd && endDate >= period.rentalStart;
}

// Returns { fieldId: message } for every invalid checkout field, in display order.
export function validateCustomerFields(values) {
    const errors = {};

    CUSTOMER_REQUIRED_FIELDS.forEach(fieldId => {
        if (!String(values[fieldId] || '').trim()) {
            errors[fieldId] = 'Dieses Pflichtfeld muss ausgefüllt werden.';
        }
    });

    const email = String(values.CustomerEmail || '').trim();
    const phone = String(values.CustomerPhone || '').trim();
    const zip = String(values.CustomerZip || '').trim();
    const address = String(values.CustomerAddress || '').trim();

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.CustomerEmail = 'Bitte geben Sie eine gültige E-Mail-Adresse ein.';
    }

    if (phone && !/^[0-9]+$/.test(phone)) {
        errors.CustomerPhone = 'Telefon darf nur Ziffern enthalten.';
    }

    if (zip && !/^[0-9]+$/.test(zip)) {
        errors.CustomerZip = 'PLZ darf nur Ziffern enthalten.';
    }

    if (address && !/^[a-zA-Z0-9äöüÄÖÜß\s]+$/.test(address)) {
        errors.CustomerAddress = 'Adresse darf nur Buchstaben, Zahlen und Leerzeichen enthalten.';
    }

    return errors;
}

export function firstInvalidCustomerField(errors) {
    const order = ['FirstName', 'LastName', 'CustomerEmail', 'CustomerPhone', 'CustomerAddress', 'CustomerZip', 'CustomerCity'];
    // Required-field errors win first, then the format checks in their original order.
    const required = order.find(fieldId => errors[fieldId] === 'Dieses Pflichtfeld muss ausgefüllt werden.');
    if (required) return required;
    return ['CustomerEmail', 'CustomerPhone', 'CustomerZip', 'CustomerAddress'].find(fieldId => errors[fieldId]) || null;
}

export const allowOnlyDigits = value => value.replace(/[^0-9]/g, '');
export const allowAddressChars = value => value.replace(/[^a-zA-Z0-9äöüÄÖÜß\s]/g, '');

// The order endpoint expects the historic step-wise form serialisation.
export function buildOrderForm({ customer, signature, agbs, dsgvo, paymentMethod }) {
    const checkbox = (name, checked) => ({ name, value: checked ? 'on' : '', checked });

    return [
        { step: 1, elements: [] },
        { step: 2, elements: [] },
        {
            step: 3,
            elements: ['FirstName', 'LastName', 'CustomerCompany', 'CustomerEmail', 'CustomerPhone',
                'CustomerAddress', 'CustomerZip', 'CustomerCity']
                .map(name => ({ name, value: customer[name] ?? '' }))
        },
        {
            step: 4,
            elements: [
                { name: 'Signature', value: signature },
                checkbox('agbs', agbs),
                checkbox('dsgvo', dsgvo),
                { name: 'paymentMethod', value: paymentMethod, checked: true }
            ]
        }
    ];
}
