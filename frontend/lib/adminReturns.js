// Pure calculations of the admin return and rental-extension dialogs.
import { addIsoCalendarDays } from './dateUtils.js';
import { calculateLateDays, calculateRentalDays } from './orders.js';
import { earlyReturnCredit, hourlyCharge, hourlyLateFee } from './tariffs.js';

export function normalizeDecimalInput(value) {
    if (value === null || value === undefined || value === '') return null;
    return String(value).replace(',', '.');
}

export function tariffSnapshot(item) {
    return {
        rental_hours: item.rentalHours,
        adjusted_rental_hours: item.adjustedRentalHours,
        rental_start: item.rentalStart,
        rental_end: item.rentalEnd,
        rental_start_time: item.rentalStartTime,
        tariff_prices: item.tariffPrices,
        adjusted_rental_start: item.adjustedRentalStart,
        adjusted_rental_end: item.adjustedRentalEnd,
        price_per_day: item.pricePerDay,
        adjusted_price_per_day: item.adjustedPricePerDay,
        discount_amount: item.discountAmount
    };
}

export const RETURN_STATUS_LABELS = {
    returned_ok: 'Ordnungsgemäß zurückgegeben',
    returned_late: 'Verspätet zurückgegeben',
    returned_damaged: 'Beschädigt zurückgegeben',
    returned_late_damaged: 'Verspätet und beschädigt'
};

export function formatReturnStatusLabel(status) {
    return RETURN_STATUS_LABELS[status] || status || '-';
}

// Derives status, deposit settlement and preview figures of a return.
export function computeReturn(item, payments, form) {
    const actualReturnDate = form.actualDate;
    const adjustedEnd = item.adjustedRentalEnd || item.rentalEnd;
    const lateDays = calculateLateDays(actualReturnDate, adjustedEnd);
    const pricePerDay = Number(item.adjustedPricePerDay || item.pricePerDay || 0);
    let hourlyLate = null;
    try { hourlyLate = hourlyLateFee(tariffSnapshot(item), actualReturnDate, form.actualTime); } catch { /* daily tariff */ }
    const lateFee = hourlyLate ? hourlyLate.amount : lateDays * pricePerDay;
    let earlyCredit = { amount: 0, days: 0 };
    try { earlyCredit = earlyReturnCredit(tariffSnapshot(item), actualReturnDate); } catch { /* invalid date */ }

    const isLate = hourlyLate ? hourlyLate.minutesLate > 0 : lateDays > 0;
    const isDamaged = Boolean(form.isDamaged);
    const repairCosts = Number(normalizeDecimalInput(form.additionalChargeAmount) || 0);
    const deposit = Number(item.deposit || 0);
    const openRentalAdjustment = (payments || [])
        .filter(payment => Number(payment.orderItemId) === Number(item.id) && payment.paymentType === 'rental_adjustment' &&
            ['pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'].includes(payment.paymentStatus))
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const totalObligations = repairCosts + lateFee + openRentalAdjustment;

    let returnStatus = 'returned_ok';
    if (isDamaged && isLate) returnStatus = 'returned_late_damaged';
    else if (isDamaged) returnStatus = 'returned_damaged';
    else if (isLate) returnStatus = 'returned_late';

    const refundAmount = Math.max(deposit - totalObligations, 0);
    const retainedAmount = Math.max(deposit - refundAmount, 0);
    const customerAdditionalDue = Math.max(totalObligations - deposit, 0);

    return {
        lateDays,
        hourlyLate,
        lateFee,
        earlyCredit,
        isLate,
        isDamaged,
        repairCosts,
        deposit,
        openRentalAdjustment,
        returnStatus,
        refundAmount,
        retainedAmount,
        customerAdditionalDue,
        depositDecision: refundAmount >= deposit && deposit > 0 ? 'full_refund' : refundAmount > 0 ? 'partial_refund' : 'no_refund',
        depositRefundAmount: refundAmount.toFixed(2),
        depositDeductionPercent: deposit > 0 ? ((retainedAmount / deposit) * 100).toFixed(2) : 0,
        depositDeductionReason: [
            repairCosts > 0 ? 'Zusatzkosten mit Kaution verrechnet' : '',
            openRentalAdjustment > 0 ? 'Offene Mietverlängerung mit Kaution verrechnet' : '',
            lateFee > 0 ? 'Verspätungskosten mit Kaution verrechnet' : ''
        ].filter(Boolean).join(' | '),
        pricePerDay: pricePerDay.toFixed(2)
    };
}

export function hourlyExtensionOptions(item) {
    const options = [];
    if (!item.rentalHours) return options;
    for (let hours = Number(item.adjustedRentalHours || item.rentalHours) + 2; hours <= 240; hours += 2) options.push(hours);
    return options;
}

// Preview of a rental extension; returns either hourly text or daily figures.
export function rentalPeriodPreview(item, { start, end, hours }) {
    if (item.rentalHours) {
        const prices = typeof item.tariffPrices === 'string' ? JSON.parse(item.tariffPrices) : item.tariffPrices;
        const total = hours ? hourlyCharge(prices, hours * 60) : Number(item.adjustedPricePerDay || item.pricePerDay);
        const endTime = hours ? new Date(Date.parse(item.rentalStart + 'T' + item.rentalStartTime + ':00Z') + hours * 3600000) : null;
        return {
            hourly: true,
            endDate: endTime ? new Date(endTime.getTime() - 1).toISOString().slice(0, 10) : null,
            text: hours
                ? 'Neue Dauer: ' + hours + ' Stunden · Rückgabe: ' + endTime.toISOString().slice(0, 16).replace('T', ' ') +
                    ' · Nachzahlung: ' + (total - Number(item.adjustedPricePerDay || item.pricePerDay))
                    .toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
                : 'Maximale Verlängerungsdauer erreicht.'
        };
    }

    const effectiveStart = start || item.rentalStart;
    const price = Number(item.adjustedPricePerDay || item.pricePerDay || 0);
    const currentStart = item.adjustedRentalStart || item.rentalStart;
    const currentEnd = item.adjustedRentalEnd || item.rentalEnd;
    const extensionDays = calculateRentalDays(addIsoCalendarDays(currentEnd, 1), end);
    const currentTotal = calculateRentalDays(currentStart, currentEnd) * price;
    const newTotal = calculateRentalDays(currentStart, end) * price;

    return {
        hourly: false,
        effectiveStart,
        price: price.toFixed(2),
        currentTotal,
        newTotal,
        extensionDays,
        difference: Math.max(extensionDays * price, 0),
        invalidEnd: Boolean(end) && new Date(end) <= new Date(currentEnd)
    };
}
