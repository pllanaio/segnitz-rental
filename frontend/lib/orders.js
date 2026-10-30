// Shared order presentation rules of the customer profile and the admin dashboard.
// Pure functions only: the React components render their results.

export const invoiceMoney = value => Number(value || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

export const INVOICE_LABELS = {
    payment_required: 'Zahlung erneut erforderlich', offset: 'Verrechnet', credit_required: 'Gutschrift in Bearbeitung',
    queued: 'Wird erstellt', draft: 'Entwurf', issued: 'Ausstehend', 'pending-payment': 'Zahlung wird geprüft', paid: 'Bezahlt',
    overdue: 'Überfällig', cancelled: 'Rechnung storniert', failed: 'Erstellung fehlgeschlagen',
    payment_reversed: 'Zahlung zurückgebucht', 'payment-reversed': 'Zahlung zurückgebucht'
};

export const PAYMENT_ROW_LABELS = {
    initial_payment: 'Miete & Kaution', rental: 'Miete', deposit: 'Kaution', invoice_payment: 'Miete & Kaution',
    rental_adjustment: 'Mietverlängerung', return_additional_charge: 'Rückgabe-Nachzahlung',
    deposit_refund: 'Kautionsrückerstattung', rental_refund: 'Mieterstattung', order_cancellation_refund: 'Stornoerstattung',
    duplicate_payment_refund: 'Erstattung Doppelzahlung', refund_record: 'Mollie-Erstattung', chargeback: 'Rückbelastung'
};

export const PAYMENT_METHOD_LABELS = { cash: 'Barzahlung', online: 'Mollie', invoice: 'Überweisung' };

export function visibleOrderPayments(order) {
    const rows = order.payments || [];
    const full = rows.filter(p => ['initial_payment', 'invoice_payment'].includes(p.paymentType));
    return rows.filter(p => {
        if (p.paymentStatus === 'replaced' && p.paymentMethod === 'invoice' && !p.providerPaymentKey) return false;
        if (!['rental', 'deposit'].includes(p.paymentType)) return true;
        if (order.payment_method === 'invoice' && !order.invoice_combined_payment) return true;
        return !full.some(f =>
            (p.providerPaymentKey && p.providerPaymentKey === f.providerPaymentKey) ||
            (/anteil/i.test(p.note || '') && Number(order.invoice_combined_payment) === 1) ||
            (p.paymentStatus === 'paid' && f.paymentStatus === 'paid' && p.paymentMethod === f.paymentMethod));
    }).filter((p, index, all) => !p.providerPaymentKey ||
        !['initial_payment', 'invoice_payment'].includes(p.paymentType) ||
        !all.some(other => other.providerPaymentKey === p.providerPaymentKey &&
            ['initial_payment', 'invoice_payment'].includes(other.paymentType) && Number(other.id) > Number(p.id)));
}

export function orderStateTone(status) {
    if (['paid', 'completed', 'returned', 'picked_up'].includes(status)) return 'is-paid';
    if (['failed', 'charged_back', 'payment_reversed', 'overdue'].includes(status)) return 'is-failed';
    if (['cancelled', 'expired', 'replaced', 'refunded'].includes(status)) return 'is-cancelled';
    return '';
}

export function paymentStatusLabel(status) {
    return ({
        paid: 'Bezahlt', unpaid: 'Ausstehend', pending: 'Ausstehend', open: 'Ausstehend', authorized: 'Autorisiert',
        failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen', expired: 'Abgelaufen', refunded: 'Erstattet',
        refund_pending: 'Erstattung ausstehend', refund_failed: 'Erstattung fehlgeschlagen', charged_back: 'Rückbelastet',
        offset: 'Verrechnet', replaced: 'Ersetzt'
    })[status] || 'Wird geprüft';
}

export function safeInvoiceLink(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && ['mollie.com', 'mollie.nl']
            .some(host => parsed.hostname === host || parsed.hostname.endsWith('.' + host)) ? parsed.href : null;
    } catch {
        return null;
    }
}

export function getSafeCheckoutUrl(value) {
    try {
        const checkoutUrl = new URL(String(value || ''));
        return checkoutUrl.protocol === 'https:' ? checkoutUrl.href : null;
    } catch (error) {
        return null;
    }
}

export function calculateRentalDays(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    return Math.max(Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1, 0);
}

export function calculateLateDays(actualReturnDate, plannedReturnDate) {
    if (!actualReturnDate || !plannedReturnDate) return 0;
    const actual = new Date(String(actualReturnDate).slice(0, 10));
    const planned = new Date(String(plannedReturnDate).slice(0, 10));
    if (actual <= planned) return 0;
    return Math.ceil((actual - planned) / (1000 * 60 * 60 * 24));
}

export function calculateOrderItemFinancials(item) {
    const originalDays = calculateRentalDays(item.rentalStart, item.rentalEnd);
    const effectiveStart = item.adjustedRentalStart || item.rentalStart;
    const effectiveEnd = item.adjustedRentalEnd || item.rentalEnd;
    const plannedEnd = item.adjustedRentalEnd || item.rentalEnd;
    const lateDays = calculateLateDays(item.actualReturnDate || null, plannedEnd);
    const effectiveDays = calculateRentalDays(effectiveStart, effectiveEnd);
    const extendedDays = Math.max(
        calculateRentalDays(item.rentalStart, item.adjustedRentalEnd || item.rentalEnd) - originalDays,
        0
    );
    const pricePerDay = Number(item.adjustedPricePerDay || item.pricePerDay || 0);
    const lateFee = lateDays * pricePerDay;
    const rentalTotal = item.adjustedRentalTotal != null
        ? Number(item.adjustedRentalTotal)
        : Math.max(0, (item.rentalHours ? 1 : effectiveDays) * pricePerDay - Number(item.discountAmount || 0));
    const originalRentalTotal = Math.max(0, originalDays * Number(item.pricePerDay || 0) - Number(item.discountAmount || 0));
    const deposit = Number(item.deposit || 0);
    const isReturned = String(item.itemStatus || '').startsWith('returned_') || Boolean(item.returnedAt);
    const depositRefund = isReturned ? Number(item.depositRefundAmount || 0) : 0;
    const depositRetained = isReturned ? Math.max(deposit - depositRefund, 0) : 0;
    const repairCharge = Number(item.additionalChargeAmount || 0);
    const additionalCharge = repairCharge + lateFee;

    return {
        originalDays,
        effectiveDays,
        extendedDays,
        pricePerDay,
        rentalTotal,
        deposit,
        depositRefund,
        depositRetained,
        additionalCharge,
        grossTotalWithDeposit: rentalTotal + deposit,
        customerAdditionalDue: Math.max(additionalCharge - deposit, 0),
        customerCredit: depositRefund,
        originalRentalTotal,
        rentalAdjustment: rentalTotal - originalRentalTotal,
        lateDays,
        lateFee,
        repairCharge,
        additionalChargeReason: item.additionalChargeReason || ''
    };
}

// Calculate the balance from actual receipts, never from failed or replaced attempts.
// Deposits still held are a liability; returned deposits are not a rental expense.
export function orderSettlement(order) {
    const cents = value => Math.round(Number(value || 0) * 100);
    const day = value => Date.parse(String(value || '').slice(0, 10));
    const days = (start, end) => Math.max(1, Math.round((day(end) - day(start)) / 86400000) + 1) || 1;
    const lines = [];
    let costs = 0, held = 0, deposit = 0, retained = 0, returnedCount = 0;
    const items = (order.items || []).filter(item => (item.itemStatus || item.item_status) !== 'cancelled');
    const add = (item, label, reason, amount) => { lines.push({ item: item.title, label, reason, amount }); costs += amount; };
    for (const item of items) {
        const originalDays = days(item.rentalStart, item.rentalEnd);
        const start = item.adjustedRentalStart || item.rentalStart, end = item.adjustedRentalEnd || item.rentalEnd;
        const rate = cents(item.adjustedPricePerDay ?? item.pricePerDay);
        const original = Math.max(0, originalDays * cents(item.pricePerDay) - cents(item.discountAmount));
        const rental = item.adjustedRentalTotal != null
            ? cents(item.adjustedRentalTotal)
            : Math.max(0, days(start, end) * rate - cents(item.discountAmount));
        add(item, 'Ursprüngliche Miete',
            (item.rentalHours ? item.rentalHours + ' Stunden ab ' + item.rentalStartTime : originalDays + ' Miettage') +
            ' · inkl. MwSt.' + (Number(item.discountAmount) ? ' · Gutschein berücksichtigt' : ''), original);
        if (rental !== original) {
            add(item, rental > original ? 'Mietverlängerung / Mietanpassung' : 'Mietkorrektur',
                'Abgerechneter Mietzeitraum: ' + start + ' – ' + end, rental - original);
        }
        const returned = String(item.itemStatus || '').startsWith('returned_') || Boolean(item.returnedAt);
        deposit += cents(item.deposit);
        if (!returned) { held += cents(item.deposit); continue; }
        returnedCount++;
        if (Number(item.earlyReturnRefund)) {
            add(item, 'Vorzeitige Rückgabe', 'Vollständig ungenutzte Miettage · Rabatt berücksichtigt', -cents(item.earlyReturnRefund));
        }
        retained += cents(item.depositDeductionAmount ?? Math.max(Number(item.deposit || 0) - Number(item.depositRefundAmount || 0), 0));
        const lateDays = Math.max(0, Math.round((day(item.actualReturnDate) - day(end)) / 86400000)) || 0;
        if (item.rentalHours && Number(item.lateFee)) {
            add(item, 'Überschreitung Stundentarif', 'Auf den nächstgrößeren vereinbarten Tarif aufgestuft', cents(item.lateFee));
        }
        if (!item.rentalHours && lateDays) {
            add(item, 'Verspätete Rückgabe', lateDays + ' Tage × ' +
                (rate / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) +
                (item.lateDescription ? ' · ' + item.lateDescription : ''), lateDays * rate);
        }
        if (Number(item.additionalChargeAmount)) {
            add(item, 'Reparatur / weitere Kosten', item.additionalChargeReason || item.damageDescription || 'Keine Begründung hinterlegt',
                cents(item.additionalChargeAmount));
        }
    }
    let paid = 0, refunded = 0;
    const incomeTypes = ['initial_payment', 'invoice_payment', 'rental', 'deposit', 'rental_adjustment', 'return_additional_charge'];
    const refundTypes = ['deposit_refund', 'rental_refund', 'order_cancellation_refund', 'duplicate_payment_refund', 'refund_record', 'chargeback'];
    for (const payment of visibleOrderPayments(order)) {
        if (!['paid', 'refunded'].includes(payment.paymentStatus)) continue;
        if (incomeTypes.includes(payment.paymentType)) paid += Math.abs(cents(payment.amount));
        if (refundTypes.includes(payment.paymentType)) refunded += Math.abs(cents(payment.amount));
    }
    return { lines, costs, held, deposit, retained, paid, refunded, balance: costs + held - paid + refunded, complete: items.length === returnedCount };
}

// Payment rows of the order sheet: latest attempts first grouped as in the old view.
export function sheetPaymentRows(order) {
    const payments = visibleOrderPayments(order).sort((a, b) => {
        const priority = p => ['initial_payment', 'invoice_payment', 'rental', 'deposit'].includes(p.paymentType) ? 0 : 1;
        return priority(a) - priority(b) || Number(a.id) - Number(b.id);
    });
    const rental = payments.find(p => p.paymentType === 'rental' && !p.orderItemId);
    const deposit = payments.find(p => p.paymentType === 'deposit' && !p.orderItemId);
    if (rental && deposit && rental.paymentMethod === deposit.paymentMethod && rental.paymentStatus === deposit.paymentStatus &&
        !payments.some(p => p.paymentType === 'initial_payment')) {
        payments.splice(payments.indexOf(deposit), 1);
        payments.splice(payments.indexOf(rental), 1, { ...rental, paymentType: 'initial_payment', amount: Number(rental.amount) + Number(deposit.amount) });
    }
    return payments;
}

export function isLatestSheetPayment(payment, payments) {
    return !payments.some(other => other.paymentType === payment.paymentType &&
        String(other.orderItemId || '') === String(payment.orderItemId || '') && Number(other.id) > Number(payment.id));
}

export function paymentDueDays(payment, now = new Date()) {
    return payment.invoiceDueAt
        ? Math.ceil((new Date(String(payment.invoiceDueAt).slice(0, 10) + 'T00:00:00') - now) / 86400000)
        : null;
}

export function formatSheetDate(value) {
    return value
        ? new Date(String(value).replace(' ', 'T')).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '–';
}

export function formatSheetStamp(value) {
    return value
        ? new Date(String(value).replace(' ', 'T')).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) + ' Uhr'
        : '–';
}

export function formatProtocolDate(value) {
    return value ? new Date(String(value).replace(' ', 'T')).toLocaleDateString('de-DE') : 'Nicht hinterlegt';
}

export function isReturnFinalized(item) {
    return Boolean(item.returnedAt) || String(item.itemStatus || '').startsWith('returned_');
}

export const RETURN_PROTOCOL_STATUS = {
    returned_ok: 'Ordnungsgemäß zurückgegeben',
    returned_late: 'Verspätet zurückgegeben',
    returned_damaged: 'Beschädigt zurückgegeben',
    returned_late_damaged: 'Verspätet und beschädigt'
};

export function safeRelativeImagePath(imagePath) {
    const path = String(imagePath || '').replace(/^\//, '');
    if (!path || path.includes(':') || path.startsWith('/')) return null;
    return path;
}

export function deriveOrderDisplayState(order) {
    const items = order.items || [];
    if (!items.length) return order.status || 'unknown';

    const getItemStatus = item => item.itemStatus || item.item_status || 'active';
    const cancelledItems = items.filter(item => getItemStatus(item) === 'cancelled');
    const returnedItems = items.filter(item => String(getItemStatus(item)).startsWith('returned_'));
    const damagedItems = items.filter(item => ['returned_damaged', 'returned_late_damaged'].includes(getItemStatus(item)));

    if (cancelledItems.length === items.length) return 'cancelled';
    const terminalItemsCount = cancelledItems.length + returnedItems.length;
    if (terminalItemsCount === items.length && returnedItems.length > 0 && damagedItems.length > 0) return 'completed_with_issues';
    if (terminalItemsCount === items.length && returnedItems.length > 0) return 'returned';
    if (returnedItems.length > 0) return 'partially_returned';
    if (cancelledItems.length > 0) return 'partially_cancelled';
    return order.status || 'active';
}

export function deriveMyOrderReturnStatus(order) {
    const items = (order.items || []).filter(item =>
        !['cancelled', 'expired'].includes(String(item.itemStatus || '').toLowerCase()) &&
        item.returnStatus !== 'not_required');

    if (!items.length) return 'not_required';

    const hasLateReturn = items.some(item => ['returned_late', 'returned_late_damaged'].includes(item.returnStatus));
    const hasDamagedReturn = items.some(item => ['returned_damaged', 'returned_late_damaged'].includes(item.returnStatus));

    if (hasLateReturn && hasDamagedReturn) return 'returned_late_damaged';
    if (hasDamagedReturn) return 'returned_damaged';
    if (hasLateReturn) return 'returned_late';
    if (items.every(item => item.returnStatus === 'returned_ok')) return 'returned_ok';
    return 'pending';
}

// Badge descriptors: { color, text, spacing } – rendered by components/orders/Badges.jsx.
const CUSTOMER_STATUS = {
    colors: {
        reserved: 'warning', expired: 'danger', paid: 'info', confirmed: 'primary', active: 'success', returned: 'success',
        cancelled: 'dark', picked_up: 'success', pending_payment: 'warning', payment_failed: 'danger', payment_dispute: 'danger'
    },
    labels: {
        reserved: 'Reserviert', expired: 'Abgelaufen', paid: 'Bezahlt', confirmed: 'Bestätigt', active: 'Aktiv',
        returned: 'Zurückgegeben', cancelled: 'Storniert', picked_up: 'Abgeholt', pending_payment: 'Zahlung ausstehend',
        payment_failed: 'Zahlung fehlgeschlagen', payment_dispute: 'Zahlung strittig'
    }
};
const ADMIN_STATUS = {
    colors: {
        reserved: 'warning', expired: 'danger', paid: 'info', confirmed: 'primary', active: 'success', returned: 'success',
        cancelled: 'dark', picked_up: 'success'
    },
    labels: {
        reserved: 'Reserviert', expired: 'Abgelaufen', paid: 'Bezahlt', confirmed: 'Bestätigt', active: 'Aktiv',
        returned: 'Zurückgegeben', cancelled: 'Storniert', picked_up: 'Abgeholt'
    }
};

export function statusBadge(status, admin = false) {
    const table = admin ? ADMIN_STATUS : CUSTOMER_STATUS;
    return { color: table.colors[status] || 'secondary', text: table.labels[status] || status || '-', spacing: admin };
}

export function orderDisplayBadge(order) {
    const state = deriveOrderDisplayState(order);
    const colors = {
        reserved: 'warning', expired: 'danger', paid: 'info', confirmed: 'primary', active: 'success', returned: 'success',
        partially_returned: 'warning', partially_cancelled: 'warning', completed_with_issues: 'danger', cancelled: 'dark',
        picked_up: 'success'
    };
    const labels = {
        reserved: 'Reserviert', expired: 'Abgelaufen', paid: 'Bezahlt', confirmed: 'Bestätigt', active: 'Aktiv',
        returned: 'Zurückgegeben', partially_returned: 'Teilweise zurückgegeben', partially_cancelled: 'Teilweise storniert',
        completed_with_issues: 'Zurückgegeben mit Klärung', cancelled: 'Storniert', picked_up: 'Abgeholt'
    };
    return { color: colors[state] || 'secondary', text: labels[state] || state || '-', spacing: true };
}

export function orderItemStatusBadge(item) {
    const status = item.itemStatus || item.item_status || 'active';
    const colors = {
        active: 'primary', cancelled: 'dark', returned_ok: 'success', returned_late: 'warning', returned_damaged: 'danger',
        returned_late_damaged: 'danger', picked_up: 'success', pending_payment: 'warning', payment_failed: 'danger',
        payment_dispute: 'danger'
    };
    const labels = {
        active: 'Aktiv', cancelled: 'Storniert', returned_ok: 'Zurückgegeben', returned_late: 'Verspätet zurück',
        returned_damaged: 'Beschädigt zurück', returned_late_damaged: 'Verspätet + beschädigt', picked_up: 'Abgeholt',
        pending_payment: 'Zahlung ausstehend', payment_failed: 'Zahlung fehlgeschlagen', payment_dispute: 'Zahlung strittig'
    };
    return { color: colors[status] || 'secondary', text: labels[status] || status || '-', spacing: false };
}

export function paymentBadge(status) {
    const tone = orderStateTone(status);
    const color = tone === 'is-paid' ? 'success' : tone === 'is-failed' || tone === 'is-cancelled' ? 'danger' : 'warning';
    return { color, text: `Zahlung: ${paymentStatusLabel(status)}`, spacing: true };
}

export function returnBadge(status, orderStatus = null, admin = false) {
    const closed = admin ? orderStatus === 'cancelled' : ['cancelled', 'expired'].includes(orderStatus);
    if (closed) return { color: 'dark', text: 'Rückgabe: Geschlossen', spacing: false };

    const colors = {
        pending: 'secondary', returned_ok: 'success', returned_late: 'warning', returned_damaged: 'danger',
        returned_late_damaged: 'danger', not_required: 'dark'
    };
    const labels = {
        pending: 'Offen', returned_ok: 'OK', returned_late: 'Verspätet', returned_damaged: 'Beschädigt',
        returned_late_damaged: 'Verspätet + beschädigt', not_required: admin ? 'Geschlossen' : 'Nicht erforderlich'
    };
    return { color: colors[status] || 'secondary', text: `Rückgabe: ${labels[status] || status || 'pending'}`, spacing: false };
}

export function returnCaseBadge(status, orderStatus = null) {
    const normalizedStatus = String(status || '').toLowerCase();
    const normalizedOrderStatus = String(orderStatus || '').toLowerCase();

    if (!normalizedStatus) return null;
    if (normalizedStatus === 'open' && normalizedOrderStatus !== 'picked_up') return null;

    const colors = {
        open: 'info', partial: 'warning', payment_pending: 'warning', payment_failed: 'danger', refund_pending: 'warning',
        refund_failed: 'danger', payment_dispute: 'danger', closed: 'success'
    };
    const labels = {
        open: 'Rückgabe offen', partial: 'Teilrückgabe offen', payment_pending: 'Nachzahlung offen',
        payment_failed: 'Nachzahlung fehlgeschlagen', refund_pending: 'Erstattung ausstehend',
        refund_failed: 'Erstattung fehlgeschlagen', payment_dispute: 'Zahlung strittig', closed: 'Abgeschlossen'
    };
    return { color: colors[normalizedStatus] || 'secondary', text: `Abwicklung: ${labels[normalizedStatus] || normalizedStatus}`, spacing: true };
}

export function invoiceDocumentStatus(invoice) {
    return invoice.kind === 'credit' ? 'Rechnungskorrektur' : INVOICE_LABELS[invoice.status] || invoice.status;
}

export function invoiceDocumentTone(invoice) {
    return invoice.kind === 'credit' ? 'is-credit' : orderStateTone(invoice.status);
}

export function invoiceDocumentBase(invoice, admin) {
    return (admin ? '/admin/orders/' : '/my-orders/') + Number(invoice.orderId) + '/invoice' +
        (invoice.legacy ? '' : '/documents/' + Number(invoice.id));
}

export async function invoiceFetch(url, method = 'GET', body) {
    const response = await fetch(url, {
        method,
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Rechnung nicht erreichbar.');
    return result;
}
