export function formatLocalDate(date = new Date()) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
        throw new Error('Ungültiges lokales Datum.');
    }

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

export function addIsoCalendarDays(value, days) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || '').slice(0, 10));
    const amount = Number(days);

    if (!match || !Number.isInteger(amount)) {
        throw new Error('Ungültiges Kalenderdatum.');
    }

    const date = new Date(Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]) + amount
    ));

    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        String(date.getUTCDate()).padStart(2, '0')
    ].join('-');
}

export const SegnitzDate = Object.freeze({ addIsoCalendarDays, formatLocalDate });
