'use strict';
const { formatDateInTimeZone } = require('./businessDate');
const { rentalDays, toCents } = require('../services/orderFinanceService');

function isBookableRentalPeriod(start, end, now = new Date()) {
    try {
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(start) || !/^\d{4}-\d{2}-\d{2}$/u.test(end)) return false;
        rentalDays(start, end);
        return start >= formatDateInTimeZone(now);
    } catch {
        return false;
    }
}

function isActualReturnDay(date, now = new Date()) {
    try {
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
        rentalDays(date, date);
        return date <= formatDateInTimeZone(now);
    } catch {
        return false;
    }
}

function isAgreedRentalPrice(value) {
    try { return Number(value) >= 0 && toCents(value) >= 0; } catch { return false; }
}

module.exports = { isActualReturnDay, isAgreedRentalPrice, isBookableRentalPeriod };
