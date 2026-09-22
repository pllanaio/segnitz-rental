'use strict';

const { BUSINESS_TIME_ZONE, formatDateInTimeZone } = require('./businessDate');

function midnightInstant(day, timeZone) {
    const naive = Date.parse(`${day}T00:00:00Z`);
    const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone, calendar: 'iso8601', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    const local = instant => {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
        return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
    };
    const offsets = new Set([-86400000, 0, 86400000].map(delta => {
        const sample = naive + delta;
        return Date.parse(`${local(sample)}Z`) - sample;
    }));
    const candidates = [...offsets].map(offset => naive - offset)
        .filter(instant => local(instant) === `${day}T00:00:00`);
    if (candidates.length !== 1) throw new RangeError('Geschäftszeitraum hat keine eindeutige Tagesgrenze.');
    return new Date(candidates[0]);
}

function businessPeriodBounds(yearValue, monthValue, timeZone = BUSINESS_TIME_ZONE) {
    const yearText = String(yearValue || '');
    const monthText = String(monthValue || '');
    const year = Number(yearText);
    if (!/^\d{4}$/u.test(yearText) || year < 1000 || year > 9998 ||
        (monthText && !/^(?:0[1-9]|1[0-2])$/u.test(monthText))) {
        throw new RangeError('Ungültiger Geschäftszeitraum.');
    }
    const month = monthText ? Number(monthText) : 1;
    const endYear = !monthText || month === 12 ? year + 1 : year;
    const endMonth = !monthText || month === 12 ? 1 : month + 1;
    return {
        start: midnightInstant(`${yearText}-${String(month).padStart(2, '0')}-01`, timeZone),
        end: midnightInstant(`${endYear}-${String(endMonth).padStart(2, '0')}-01`, timeZone)
    };
}

function withBusinessPeriod(row, timeZone = BUSINESS_TIME_ZONE) {
    const value = row.createdAt ?? row.created_at;
    // UTC-configured mysql2 returns TIMESTAMP as Date. Explicit ISO instants
    // also work; ambiguous SQL-local strings must never use the host timezone.
    if (!(value instanceof Date) && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value))) {
        throw new TypeError('Erstellungszeitpunkt benötigt eine explizite Zeitzone.');
    }
    const instant = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(instant.getTime())) throw new TypeError('Ungültiger Erstellungszeitpunkt.');
    const calendarDay = formatDateInTimeZone(instant, timeZone);
    return { ...row, year: calendarDay.slice(0, 4), month: calendarDay.slice(5, 7) };
}

module.exports = { businessPeriodBounds, withBusinessPeriod };
