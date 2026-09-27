"use strict";
let productAttributeOptions = { brands: {}, products: [] };
const productAttributeFields = {
    productKind: ['productKind', 'product_kind'], manufacturer: ['manufacturer', 'manufacturer'],
    model: ['productModel', 'model'], color: ['productColor', 'color'], powerValue: ['powerValue', 'power_value'],
    powerUnit: ['powerUnit', 'power_unit'], operatingHours: ['operatingHours', 'operating_hours'], mileageKm: ['mileageKm', 'mileage_km']
};
function getProductAttributes() {
    return Object.fromEntries(Object.entries(productAttributeFields).map(([key, [id]]) => [key, document.getElementById(id).value.trim()]));
}
function setProductAttributes(product) {
    for (const [key, [id, column]] of Object.entries(productAttributeFields)) {
        document.getElementById(id).value = product[column] ?? (key === 'powerUnit' ? 'kW' : '');
    }
    updateProductAttributeSuggestions();
}
function fillProductOptions(id, values) {
    const list = document.getElementById(id);
    list.replaceChildren();
    const unique = [...new Set(values.filter(Boolean))].filter(value => value !== 'n.V.').sort((a, b) => a.localeCompare(b, 'de'));
    for (const value of ['n.V.', ...unique]) { const option = document.createElement('option'); option.value = value; list.append(option); }
}
function updateProductAttributeSuggestions() {
    const kind = document.getElementById('productKind').value;
    const brand = document.getElementById('manufacturer').value.trim().toLocaleLowerCase('de');
    const entries = productAttributeOptions.products.filter(product => !kind || product.product_kind === kind || !product.product_kind);
    const brands = kind ? productAttributeOptions.brands[kind] || [] : Object.values(productAttributeOptions.brands).flat();
    fillProductOptions('manufacturerOptions', [...brands, ...entries.map(product => product.manufacturer)]);
    fillProductOptions('modelOptions', entries.filter(product => brand && product.manufacturer?.toLocaleLowerCase('de') === brand).map(product => product.model));
}
async function loadProductAttributeOptions() {
    try {
        const response = await fetch('/product-attribute-options');
        if (!response.ok) throw new Error('Vorschläge nicht verfügbar. Marke und Modell können frei eingegeben werden.');
        productAttributeOptions = await response.json();
        updateProductAttributeSuggestions();
    } catch (error) { document.getElementById('productSuggestionsHint').textContent = error.message; }
}
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('productKind').addEventListener('change', updateProductAttributeSuggestions);
    document.getElementById('manufacturer').addEventListener('input', updateProductAttributeSuggestions);
    document.getElementById('resetProductBtn').addEventListener('click', resetForm);
    loadProductAttributeOptions();
});
