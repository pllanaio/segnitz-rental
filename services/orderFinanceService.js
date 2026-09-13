'use strict';

// All amounts crossing this boundary are decimal EUR. Round half away from zero
// once per line; all aggregation after that point uses safe integer cents.
function toCents(value = 0) {
    const match = String(value ?? 0).match(/^(-?)(\d+)(?:\.(\d+))?$/u);
    if (!match) throw new TypeError('Ungültiger Geldbetrag.');
    const fraction = (match[3] || '').padEnd(3, '0');
    let cents = BigInt(match[2]) * 100n + BigInt(fraction.slice(0, 2));
    if (fraction[2] >= '5') cents += 1n;
    if (match[1]) cents = -cents;
    const number = Number(cents);
    if (!Number.isSafeInteger(number)) throw new RangeError('Geldbetrag außerhalb des sicheren Bereichs.');
    return number;
}

function sum(values) {
    return values.reduce((total, value) => {
        const result = total + value;
        if (!Number.isSafeInteger(result)) throw new RangeError('Geldsumme außerhalb des sicheren Bereichs.');
        return result;
    }, 0);
}

const field = (record, camel, snake) => record[camel] ?? record[snake];
function day(value) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value || '').slice(0, 10);
}
function rentalDays(start, end) {
    const first = day(start);
    const last = day(end);
    for (const date of [first, last]) {
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
            throw new TypeError('Ungültiger Miettag.');
        }
    }
    const days = (Date.parse(last) - Date.parse(first)) / 86400000 + 1;
    if (!Number.isSafeInteger(days) || days < 1) throw new TypeError('Ungültiger Mietzeitraum.');
    return days;
}

function itemFinancials(item) {
    const start = field(item, 'rentalStart', 'rental_start');
    const end = field(item, 'rentalEnd', 'rental_end');
    const effectiveStart = field(item, 'adjustedRentalStart', 'adjusted_rental_start') || start;
    const effectiveEnd = field(item, 'adjustedRentalEnd', 'adjusted_rental_end') || end;
    const originalDays = rentalDays(start, end);
    const effectiveDays = rentalDays(effectiveStart, effectiveEnd);
    const price = toCents(field(item, 'adjustedPricePerDay', 'adjusted_price_per_day') ?? field(item, 'pricePerDay', 'price_per_day') ?? 0);
    const original = originalDays * toCents(field(item, 'pricePerDay', 'price_per_day') ?? 0);
    const rental = effectiveDays * price;
    const deposit = toCents(item.deposit || 0);
    const returned = String(field(item, 'itemStatus', 'item_status') || field(item, 'returnStatus', 'return_status') || '').startsWith('returned_') || Boolean(field(item, 'returnedAt', 'returned_at'));
    const refund = returned ? toCents(field(item, 'depositRefundAmount', 'deposit_refund_amount') || 0) : 0;
    const retained = returned ? toCents(field(item, 'depositDeductionAmount', 'deposit_deduction_amount') ?? Math.max(deposit - refund, 0) / 100) : 0;
    const actual = field(item, 'actualReturnDate', 'actual_return_date');
    const lateDays = actual && day(actual) > day(effectiveEnd) ? rentalDays(effectiveEnd, actual) - 1 : 0;
    const repair = toCents(field(item, 'additionalChargeAmount', 'additional_charge_amount') || 0);
    const cents = {
        pricePerDay: price, rentalTotal: rental, originalRentalTotal: original,
        rentalAdjustment: rental - original, deposit, depositRefund: refund,
        depositRetained: retained, lateFee: lateDays * price, repairCharge: repair,
        additionalCharge: repair + lateDays * price,
        grossTotalWithDeposit: rental + deposit,
        customerAdditionalDue: Math.max(repair + lateDays * price - deposit, 0),
        customerCredit: refund
    };
    sum(Object.values(cents));
    return {
        originalDays, effectiveDays, lateDays,
        extendedDays: Math.max(rentalDays(start, effectiveEnd) - originalDays, 0),
        ...Object.fromEntries(Object.entries(cents).map(([key, value]) => [key, value / 100])),
        cents,
        additionalChargeReason: field(item, 'additionalChargeReason', 'additional_charge_reason') || ''
    };
}

function normalizePayment(payment) {
    return {
        ...payment,
        type: field(payment, 'paymentType', 'payment_type'),
        status: field(payment, 'paymentStatus', 'payment_status'),
        provider: field(payment, 'molliePaymentId', 'mollie_payment_id') || null,
        refund: field(payment, 'mollieRefundId', 'mollie_refund_id') || null,
        operation: field(payment, 'externalOperationKey', 'external_operation_key') || null,
        group: payment.refundGroupKey || null,
        item: field(payment, 'orderItemId', 'order_item_id') || null,
        method: field(payment, 'paymentMethod', 'payment_method') || 'cash',
        cents: toCents(payment.amount)
    };
}

function initialReceipts(payments, originalRentalCents, originalDepositCents) {
    const groups = new Map();
    for (const payment of payments) {
        if (!['initial_payment', 'rental', 'deposit'].includes(payment.type)) continue;
        const key = payment.provider ? `provider:${payment.provider}` : `method:${payment.method}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(payment);
    }
    let rental = 0;
    let deposit = 0;
    let received = 0;
    let unallocated = 0;
    for (const rows of groups.values()) {
        const paid = rows.filter(payment => payment.status === 'paid');
        const aggregates = paid.filter(payment => payment.type === 'initial_payment').map(payment => payment.cents);
        // A provider ID represents exactly one receipt. Cash can have several
        // recorded receipts. Allocation rows describe that money, not extra cash.
        const aggregate = rows[0].provider ? aggregates.reduce((maximum, amount) => Math.max(maximum, amount), 0) : sum(aggregates);
        let rentalPart = sum(paid.filter(payment => payment.type === 'rental').map(payment => payment.cents));
        let depositPart = sum(paid.filter(payment => payment.type === 'deposit').map(payment => payment.cents));
        const captured = Math.max(aggregate, sum([rentalPart, depositPart]));
        let remaining = captured - rentalPart - depositPart;
        const rentalRows = rows.filter(payment => payment.type === 'rental');
        const depositRows = rows.filter(payment => payment.type === 'deposit');
        const rentalTarget = rentalRows.length ? sum(rentalRows.map(payment => payment.cents)) : originalRentalCents;
        const depositTarget = depositRows.length ? sum(depositRows.map(payment => payment.cents)) : originalDepositCents;
        const rentalCredit = Math.min(remaining, Math.max(rentalTarget - rentalPart, 0));
        rentalPart += rentalCredit;
        remaining -= rentalCredit;
        const depositCredit = Math.min(remaining, Math.max(depositTarget - depositPart, 0));
        depositPart += depositCredit;
        remaining -= depositCredit;
        rental = sum([rental, rentalPart]);
        deposit = sum([deposit, depositPart]);
        received = sum([received, captured]);
        unallocated = sum([unallocated, remaining]);
    }
    return { rental, deposit, received, unallocated };
}

function summarizeOrderFinance(order) {
    const items = order.items || [];
    const active = items.filter(item => !['cancelled', 'expired'].includes(field(item, 'itemStatus', 'item_status')));
    const details = active.map(itemFinancials);
    const payments = (order.payments || []).map(normalizePayment);
    const paid = payments.filter(payment => payment.status === 'paid');
    const rentalContractCents = sum(details.map(item => item.cents.originalRentalTotal));
    const depositContractCents = sum(details.map(item => item.cents.deposit));
    // Receipts survive cancellation and refund. Use the original full contract
    // to classify legacy aggregate-only receipts; active items govern amounts due.
    const originalDetails = items.map(itemFinancials);
    const receipts = initialReceipts(payments,
        sum(originalDetails.map(item => item.cents.originalRentalTotal)),
        sum(originalDetails.map(item => item.cents.deposit)));
    const rentalReceivedCents = receipts.rental;
    const depositReceivedCents = receipts.deposit;
    const unallocatedReceivedCents = receipts.unallocated;
    const openStatuses = new Set(['pending', 'open', 'authorized', 'failed', 'cancelled', 'expired']);
    const additional = payments.filter(payment => ['rental_adjustment', 'return_additional_charge'].includes(payment.type));
    const inactiveItemIds = new Set(items.filter(item => !active.includes(item)).map(item => String(item.id)));
    const additionalDueCents = sum(additional.filter(payment => active.length > 0 &&
        !inactiveItemIds.has(String(payment.item)) && openStatuses.has(payment.status)).map(payment => Math.max(payment.cents, 0)));
    const offsetCents = sum(additional.filter(payment => payment.status === 'offset').map(payment => payment.cents));

    // Retry rows may replace a failed refund. A provider refund ID identifies a
    // real transfer; before creation, the existing business target groups retries.
    const refunds = new Map();
    const byId = new Map(payments.filter(payment => payment.id).map(payment => [String(payment.id), payment]));
    const refundRoot = payment => {
        let root = payment;
        const visited = new Set();
        while (root && !visited.has(root)) {
            visited.add(root);
            const retry = /^retry-refund-(\d+)-\d+$/u.exec(root.operation || '');
            if (!retry || !byId.has(retry[1])) break;
            root = byId.get(retry[1]);
        }
        return root;
    };
    payments.filter(payment => ['deposit_refund', 'order_cancellation_refund', 'duplicate_payment_refund'].includes(payment.type))
        .sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
        .forEach(payment => {
            const root = refundRoot(payment);
            const key = root.operation ? `intent:${root.id || root.operation}` : root.refund || `${root.type}:${root.item || 'order'}:${root.group || root.provider || root.method}`;
            const existing = refunds.get(key);
            if (!existing || existing.status !== 'paid') refunds.set(key, payment);
        });
    const transfers = new Map();
    for (const [intent, payment] of refunds) {
        const identity = payment.refund ? `refund:${payment.refund}` : intent;
        const existing = transfers.get(identity);
        if (existing && (existing.cents !== payment.cents || existing.provider !== payment.provider)) {
            throw new TypeError('Widersprüchliche Buchungen zu derselben Provider-Erstattung.');
        }
        if (!existing || existing.status !== 'paid') transfers.set(identity, payment);
    }
    const refundRows = [...transfers.values()];
    const refundedCents = sum(refundRows.filter(payment => payment.status === 'paid').map(payment => Math.abs(payment.cents)));
    const pendingRefunds = refundRows.filter(payment => payment.status !== 'paid');
    const recordedDepositClaims = sum(refundRows.filter(payment => payment.type === 'deposit_refund').map(payment => Math.abs(payment.cents)));
    const legacyDepositClaim = Math.max(sum(details.map(item => item.cents.depositRefund)) - recordedDepositClaims, 0);
    const refundDueCents = sum(pendingRefunds.map(payment => Math.abs(payment.cents))) + legacyDepositClaim;
    const refundFailedCents = sum(pendingRefunds.filter(payment => ['failed', 'cancelled'].includes(payment.status)).map(payment => Math.abs(payment.cents)));
    const refundPendingCents = refundDueCents - refundFailedCents;
    const depositRetainedCents = sum(details.map(item => item.cents.depositRetained));
    const unreturnedDeposit = sum(active.filter(item => !String(field(item, 'itemStatus', 'item_status') || '').startsWith('returned_') && !field(item, 'returnedAt', 'returned_at')).map(item => toCents(item.deposit || 0)));
    const depositHeldCents = Math.min(depositReceivedCents, unreturnedDeposit);
    const rentalDueCents = Math.max(rentalContractCents - rentalReceivedCents, 0);
    const depositDueCents = Math.max(unreturnedDeposit - depositReceivedCents, 0);
    const customerDueCents = sum([rentalDueCents, depositDueCents, additionalDueCents]);
    const disputedCents = sum(payments.filter(payment => payment.type === 'chargeback' && payment.status === 'charged_back').map(payment => Math.abs(payment.cents)));
    const receivedCents = sum([receipts.received, ...paid.filter(payment => ['rental_adjustment', 'return_additional_charge'].includes(payment.type)).map(payment => payment.cents)]);
    const balanceCents = customerDueCents - refundDueCents;
    const status = disputedCents > 0 ? 'disputed' : customerDueCents > 0 ? 'payment_due' : refundFailedCents > 0 ? 'refund_failed' : refundDueCents > 0 ? 'refund_due' : depositHeldCents > 0 ? 'deposit_held' : 'settled';
    const statusLabels = { disputed: 'Zahlung in Klärung', payment_due: 'Zahlung offen', refund_failed: 'Erstattung fehlgeschlagen', refund_due: 'Erstattung offen', deposit_held: 'Miete bezahlt; Kaution wird gehalten', settled: 'Bestellung vollständig ausgeglichen' };
    return { version: 1, currency: 'EUR', rentalContractCents, depositContractCents, rentalReceivedCents, depositReceivedCents, unallocatedReceivedCents, rentalDueCents, depositDueCents, depositHeldCents, depositRetainedCents, additionalDueCents, offsetCents, receivedCents, refundedCents, refundDueCents, refundFailedCents, refundPendingCents, disputedCents, customerDueCents, balanceCents, status, statusLabel: statusLabels[status] };
}

function attachOrderFinance(order) {
    const items = (order.items || []).map(item => ({ ...item, financials: itemFinancials(item) }));
    return { ...order, items, financialSummary: summarizeOrderFinance({ ...order, items }) };
}

async function loadOrderFinance(connection, orderId) {
    const [items] = await connection.execute(
        `SELECT roi.*, DATE_FORMAT(rental_start, '%Y-%m-%d') AS rentalStart,
                DATE_FORMAT(rental_end, '%Y-%m-%d') AS rentalEnd,
                DATE_FORMAT(adjusted_rental_start, '%Y-%m-%d') AS adjustedRentalStart,
                DATE_FORMAT(adjusted_rental_end, '%Y-%m-%d') AS adjustedRentalEnd,
                DATE_FORMAT(actual_return_date, '%Y-%m-%d') AS actualReturnDate
         FROM rental_order_items roi WHERE order_id = ? ORDER BY id`, [orderId]);
    const [payments] = await connection.execute('SELECT * FROM rental_order_payments WHERE order_id = ? ORDER BY id', [orderId]);
    return summarizeOrderFinance({ items, payments });
}

module.exports = { loadOrderFinance, attachOrderFinance, itemFinancials, rentalDays, summarizeOrderFinance, toCents };
