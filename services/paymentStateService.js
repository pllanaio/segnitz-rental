'use strict';

const OPEN_PAYMENT_STATUSES = new Set(['pending', 'open', 'authorized']);
const SETTLED_REFUND_STATUSES = new Set(['refunded']);
const FAILED_REFUND_STATUSES = new Set(['failed']);
const CANCELLED_REFUND_STATUSES = new Set(['canceled', 'cancelled']);
const MUTABLE_INITIAL_ORDER_STATUSES = new Set([
    'reserved',
    'pending_payment',
    'payment_failed'
]);

function roundMoney(value) {
    return Number((Number(value || 0)).toFixed(2));
}

function mapMolliePaymentStatus(status) {
    switch (String(status || '').toLowerCase()) {
        case 'paid':
            return 'paid';
        case 'failed':
            return 'failed';
        case 'canceled':
        case 'cancelled':
            return 'cancelled';
        case 'expired':
            return 'expired';
        case 'authorized':
            return 'authorized';
        default:
            return 'pending';
    }
}

function mapMollieRefundStatus(status) {
    const normalized = String(status || '').toLowerCase();

    if (SETTLED_REFUND_STATUSES.has(normalized)) return 'paid';
    if (FAILED_REFUND_STATUSES.has(normalized)) return 'failed';
    if (CANCELLED_REFUND_STATUSES.has(normalized)) return 'cancelled';

    return 'pending';
}

// Provider observations are not an ordered event stream. Success is authoritative;
// an older open/failure snapshot may never undo money already received/returned.
const PAYMENT_TRANSITIONS = Object.freeze({
    pending: ['authorized', 'failed', 'cancelled', 'expired', 'paid', 'offset', 'replaced'],
    open: ['pending', 'authorized', 'failed', 'cancelled', 'expired', 'paid', 'offset', 'replaced'],
    authorized: ['failed', 'cancelled', 'expired', 'paid', 'offset', 'replaced'],
    failed: ['paid', 'offset', 'replaced'],
    cancelled: ['paid', 'offset', 'replaced'],
    expired: ['paid', 'offset', 'replaced'],
    offset: ['paid'],
    replaced: ['paid'],
    paid: [], refunded: [], charged_back: []
});
function transitionPaymentStatus(currentStatus, observedStatus) {
    const current = String(currentStatus || 'pending').toLowerCase();
    const observed = String(observedStatus || 'pending').toLowerCase();
    return (PAYMENT_TRANSITIONS[current] || []).includes(observed) ? observed : current;
}
function transitionRefundStatus(currentStatus, observedStatus) {
    return transitionPaymentStatus(currentStatus, observedStatus);
}
function providerContractError() {
    const error = new Error('Providerdaten stimmen nicht mit der lokalen Zahlungsabsicht überein.');
    error.code = 'PROVIDER_CONTRACT_MISMATCH';
    return error;
}
function validateProviderAmount(amount, expectedAmount = null) {
    if (amount?.currency !== 'EUR' || !/^(0|[1-9]\d*)\.\d{2}$/.test(String(amount?.value || ''))) {
        throw providerContractError();
    }
    const cents = Number(String(amount.value).replace('.', ''));
    if (!Number.isSafeInteger(cents) || cents < 0 ||
        (expectedAmount !== null && cents !== Math.round(Math.abs(Number(expectedAmount)) * 100))) {
        throw providerContractError();
    }
    return cents;
}

function validateProviderPayment(payment, { paymentId, orderId, amount }) {
    if (payment?.id !== paymentId || !['open', 'pending', 'authorized', 'paid', 'failed', 'canceled', 'expired'].includes(payment.status) ||
        (payment.metadata?.orderId && String(payment.metadata.orderId) !== String(orderId))) throw providerContractError();
    return validateProviderAmount(payment.amount, amount);
}

function deriveOrderStatusFromInitialPayment(currentOrderStatus, mollieStatus) {
    const current = String(currentOrderStatus || 'reserved').toLowerCase();
    const payment = mapMolliePaymentStatus(mollieStatus);

    // Only an order which is still waiting for its initial payment may be moved
    // by that payment. A delayed redirect/webhook must never resurrect a picked
    // up, returned, cancelled or expired rental.
    if (!MUTABLE_INITIAL_ORDER_STATUSES.has(current)) return current;

    switch (payment) {
        case 'paid':
            return 'confirmed';
        case 'cancelled':
        case 'expired':
        case 'failed':
            return 'payment_failed';
        default:
            return current;
    }
}

function isOpenPaymentStatus(status) {
    return OPEN_PAYMENT_STATUSES.has(String(status || '').toLowerCase());
}

function isDuplicateKeyError(error) {
    return error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062;
}

function isStrictIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;

    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function calculateReturnSettlement({
    deposit,
    additionalChargeAmount,
    openRentalAdjustmentAmount,
    lateFee
}) {
    const normalizedDeposit = Math.max(roundMoney(deposit), 0);
    const obligations = Math.max(roundMoney(additionalChargeAmount), 0) +
        Math.max(roundMoney(openRentalAdjustmentAmount), 0) +
        Math.max(roundMoney(lateFee), 0);
    const totalObligations = roundMoney(obligations);
    const depositDeductionAmount = roundMoney(Math.min(normalizedDeposit, totalObligations));
    const depositRefundAmount = roundMoney(normalizedDeposit - depositDeductionAmount);
    const customerAdditionalDue = roundMoney(Math.max(totalObligations - normalizedDeposit, 0));

    let depositDecision = 'no_refund';
    if (depositRefundAmount >= normalizedDeposit && normalizedDeposit > 0) {
        depositDecision = 'full_refund';
    } else if (depositRefundAmount > 0) {
        depositDecision = 'partial_refund';
    }

    return {
        totalObligations,
        depositDeductionAmount,
        depositRefundAmount,
        customerAdditionalDue,
        depositDecision,
        depositDeductionPercent: normalizedDeposit > 0
            ? roundMoney((depositDeductionAmount / normalizedDeposit) * 100)
            : 0
    };
}

function deriveAggregateReturnStatus(returnStatuses = []) {
    const normalizedStatuses = returnStatuses
        .map(status => String(status || '').toLowerCase())
        .filter(status => status.startsWith('returned_'));
    const hasLateReturn = normalizedStatuses.some(status =>
        status === 'returned_late' || status === 'returned_late_damaged'
    );
    const hasDamagedReturn = normalizedStatuses.some(status =>
        status === 'returned_damaged' || status === 'returned_late_damaged'
    );

    if (hasLateReturn && hasDamagedReturn) return 'returned_late_damaged';
    if (hasDamagedReturn) return 'returned_damaged';
    if (hasLateReturn) return 'returned_late';
    return normalizedStatuses.length > 0 ? 'returned_ok' : null;
}

function deriveReturnCaseStatus({
    orderStatus,
    orderPaymentStatus,
    pickedUpCount = 0,
    returnedCount = 0,
    pendingPaymentCount = 0,
    failedPaymentCount = 0,
    pendingRefundCount = 0,
    failedRefundCount = 0
}) {
    const normalizedOrderStatus = String(orderStatus || '').toLowerCase();
    const normalizedPaymentStatus = String(orderPaymentStatus || '').toLowerCase();

    if (
        normalizedOrderStatus === 'payment_dispute' ||
        normalizedPaymentStatus === 'charged_back'
    ) {
        return 'payment_dispute';
    }

    if (normalizedOrderStatus === 'returned') {
        if (Number(failedPaymentCount) > 0) return 'payment_failed';
        if (Number(pendingPaymentCount) > 0) return 'payment_pending';
        if (Number(failedRefundCount) > 0) return 'refund_failed';
        if (Number(pendingRefundCount) > 0) return 'refund_pending';
        return 'closed';
    }

    if (Number(pickedUpCount) > 0) {
        return Number(returnedCount) > 0 ? 'partial' : 'open';
    }

    if (Number(returnedCount) > 0) return 'partial';

    return null;
}

module.exports = {
    transitionPaymentStatus, transitionRefundStatus, validateProviderAmount, validateProviderPayment, providerContractError,
    calculateReturnSettlement,
    deriveAggregateReturnStatus,
    deriveOrderStatusFromInitialPayment,
    deriveReturnCaseStatus,
    isDuplicateKeyError,
    isOpenPaymentStatus,
    isStrictIsoDate,
    mapMolliePaymentStatus,
    mapMollieRefundStatus,
    roundMoney
};
