'use strict';

const PRODUCT_INPUT_LIMITS = Object.freeze({
    productKey: 100,
    title: 150,
    descriptionBytes: 65_535,
    imagePath: 500,
    category: 100
});

function normalizeCategory(value) {
    return String(value || '').trim().replace(/\s+/gu, ' ');
}

function validateProductInput(payload, { requireProductKey = false } = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { error: 'Ungültige Produktdaten.' };
    }

    const rawCategories = Array.isArray(payload.categories)
        ? payload.categories
        : (payload.category ? [payload.category] : []);
    if (rawCategories.some(category => typeof category !== 'string')) {
        return { error: 'Kategorien müssen als Text angegeben werden.' };
    }

    const hasImagePath = Object.prototype.hasOwnProperty.call(payload, 'imagePath');
    const value = {
        productKey: String(payload.productKey || '').trim(),
        title: String(payload.title || '').trim(),
        description: String(payload.description || ''),
        categories: rawCategories.map(normalizeCategory).filter(Boolean),
        ...(hasImagePath ? { imagePath: String(payload.imagePath || '') } : {})
    };

    if (requireProductKey && !value.productKey) {
        return { error: 'Produkt-Key und Titel sind Pflichtfelder.' };
    }
    if (!value.title) {
        return { error: requireProductKey
            ? 'Produkt-Key und Titel sind Pflichtfelder.'
            : 'Titel ist ein Pflichtfeld.' };
    }
    if (value.productKey.length > PRODUCT_INPUT_LIMITS.productKey) {
        return { error: `Der Produkt-Key darf maximal ${PRODUCT_INPUT_LIMITS.productKey} Zeichen lang sein.` };
    }
    if (value.title.length > PRODUCT_INPUT_LIMITS.title) {
        return { error: `Der Titel darf maximal ${PRODUCT_INPUT_LIMITS.title} Zeichen lang sein.` };
    }
    if (Buffer.byteLength(value.description, 'utf8') > PRODUCT_INPUT_LIMITS.descriptionBytes) {
        return { error: 'Die Produktbeschreibung ist zu lang.' };
    }
    if (value.imagePath !== undefined && value.imagePath.length > PRODUCT_INPUT_LIMITS.imagePath) {
        return { error: 'Der Bildpfad ist zu lang.' };
    }
    if (value.categories.some(category => category.length > PRODUCT_INPUT_LIMITS.category)) {
        return { error: `Kategorien dürfen maximal ${PRODUCT_INPUT_LIMITS.category} Zeichen lang sein.` };
    }

    return { value };
}

module.exports = {
    PRODUCT_INPUT_LIMITS,
    validateProductInput
};
