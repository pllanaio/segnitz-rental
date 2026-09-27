"use strict";
const crypto = require('node:crypto');
const fields = {
    productKind: ['product_kind', 'enum', ['Baumaschine', 'Auto', 'Werkzeug']],
    manufacturer: ['manufacturer', 'text', 120], model: ['model', 'text', 160],
    color: ['color', 'text', 80], powerValue: ['power_value', 'number', 999999.99],
    powerUnit: ['power_unit', 'enum', ['kW', 'PS', 'W']],
    operatingHours: ['operating_hours', 'number', 99999999.99],
    mileageKm: ['mileage_km', 'number', 99999999.99]
};
function normalizeProductAttributes(body, partial = false) {
    const result = {};
    for (const [key, [column, type, limit]] of Object.entries(fields)) {
        if (partial && !Object.hasOwn(body, key)) continue;
        const value = body[key];
        if (value === undefined || value === null || value === '') {
            result[column] = ['manufacturer', 'model'].includes(key) ? 'n.V.' : null;
            continue;
        }
        if (type === 'text') {
            if (typeof value !== 'string' || value.trim().length > limit) throw new Error(`Ungültiger Wert für ${key}.`);
            result[column] = value.trim() || (['manufacturer', 'model'].includes(key) ? 'n.V.' : null);
        } else if (type === 'enum') {
            if (!limit.includes(value)) throw new Error(`Ungültiger Wert für ${key}.`);
            result[column] = value;
        } else {
            if (!['number', 'string'].includes(typeof value) || !/^\d+(?:[.,]\d{1,2})?$/.test(String(value))) throw new Error(`Ungültiger Zahlenwert für ${key}.`);
            const number = Number(String(value).replace(',', '.'));
            if (!Number.isFinite(number) || number < 0 || number > limit) throw new Error(`Ungültiger Zahlenwert für ${key}.`);
            result[column] = number;
        }
    }
    if (result.power_value != null && !body.powerUnit && !partial) result.power_unit = 'kW';
    return result;
}
async function saveProductAttributes(connection, productId, attributes) {
    const entries = Object.entries(attributes);
    if (!entries.length) return;
    await connection.execute(`UPDATE rental_products SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`, [...entries.map(([, value]) => value), productId]);
}
function generateProductKey() { return `SR-${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`; }
module.exports = { normalizeProductAttributes, saveProductAttributes, generateProductKey };
