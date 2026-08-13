'use strict';

const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'Europe/Berlin';

function formatDateInTimeZone(date = new Date(), timeZone = BUSINESS_TIME_ZONE) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

    return `${values.year}-${values.month}-${values.day}`;
}

function addIsoCalendarDays(value, days) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || '').slice(0, 10));
    const amount = Number(days);

    if (!match || !Number.isInteger(amount)) {
        throw new Error('Ungültiges Kalenderdatum.');
    }

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + amount));
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        String(date.getUTCDate()).padStart(2, '0')
    ].join('-');
}

module.exports = {
    BUSINESS_TIME_ZONE,
    addIsoCalendarDays,
    formatDateInTimeZone
};
