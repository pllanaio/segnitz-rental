'use strict';
const { formatDateInTimeZone } = require('../utils/businessDate');
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
function normalizeCode(value) {
    if (typeof value !== 'string') fail('Bitte einen Gutscheincode eingeben.');
    const code = value.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) fail('Der Code muss 3 bis 40 Zeichen enthalten: Buchstaben, Zahlen, Bindestrich oder Unterstrich.');
    return code;
}
function validateCoupon(body) {
    if (!body || typeof body !== 'object') fail('Ungültiger Gutschein.');
    const code = normalizeCode(body.code);
    const percent = Number(body.percent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100 || Math.abs(percent * 100 - Math.round(percent * 100)) > 0.00001) fail('Der Rabatt muss größer als 0 und höchstens 100 Prozent sein (maximal zwei Nachkommastellen).');
    const dates = {};
    for (const key of ['validFrom', 'validUntil']) {
        const value = body[key];
        if (value === null || value === '') { dates[key] = null; continue; }
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('Bitte ein gültiges Datum eingeben.');
        dates[key] = value;
    }
    if (dates.validFrom && dates.validUntil && dates.validUntil < dates.validFrom) fail('Das Gültigkeitsende darf nicht vor dem Beginn liegen.');
    if (typeof body.active !== 'boolean') fail('Ungültiger Aktivierungsstatus.');
    return { code, percent, active: body.active, ...dates };
}
async function loadValidCoupon(connection, code, lock = false) {
    const [[coupon]] = await connection.execute(`SELECT id, code, percent, revision, active,
        DATE_FORMAT(valid_from, '%Y-%m-%d') AS validFrom, DATE_FORMAT(valid_until, '%Y-%m-%d') AS validUntil
        FROM discount_codes WHERE code = ?${lock ? ' FOR UPDATE' : ''}`, [normalizeCode(code)]);
    const today = formatDateInTimeZone();
    if (!coupon || !coupon.active || (coupon.validFrom && coupon.validFrom > today) || (coupon.validUntil && coupon.validUntil < today)) fail('Dieser Gutscheincode ist ungültig, noch nicht gültig oder abgelaufen.');
    return coupon;
}
function applyCouponToSummary(summary, coupon) {
    const basisPoints = Math.round(Number(coupon.percent) * 100);
    const amounts = summary.items.map(item => Math.round(item.rentalTotal * 100));
    const originalCents = amounts.reduce((sum, value) => sum + value, 0);
    const target = Math.round(originalCents * basisPoints / 10000);
    const discounts = amounts.map(amount => Math.floor(amount * basisPoints / 10000));
    let remainder = target - discounts.reduce((sum, value) => sum + value, 0);
    const priority = amounts.map((amount, index) => ({ index, fraction: amount * basisPoints % 10000 }))
        .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (const entry of priority) { if (remainder-- <= 0) break; discounts[entry.index]++; }
    summary.items.forEach((item, index) => { item.originalRentalTotal = amounts[index] / 100; item.discountAmount = discounts[index] / 100; item.rentalTotal = (amounts[index] - discounts[index]) / 100; });
    summary.coupon = { code: coupon.code, percent: Number(coupon.percent), revision: coupon.revision };
    summary.totals.originalRentalTotal = originalCents / 100;
    summary.totals.discountAmount = target / 100;
    summary.totals.rentalTotal = (originalCents - target) / 100;
    summary.totals.grandTotalBeforeDepositReturn = (originalCents - target + Math.round(summary.totals.depositTotal * 100)) / 100;
    return summary;
}
module.exports = { normalizeCode, validateCoupon, loadValidCoupon, applyCouponToSummary };
