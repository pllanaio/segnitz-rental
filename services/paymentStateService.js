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
        case 'charged_back':
            return 'charged_back';
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

function deriveOrderStatusFromInitialPayment(currentOrderStatus, mollieStatus) {
    const current = String(currentOrderStatus || 'reserved').toLowerCase();
    const payment = mapMolliePaymentStatus(mollieStatus);

    if (payment === 'charged_back') return 'payment_dispute';

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

module.exports = {
    calculateReturnSettlement,
    deriveOrderStatusFromInitialPayment,
    isDuplicateKeyError,
    isOpenPaymentStatus,
    isStrictIsoDate,
    mapMolliePaymentStatus,
    mapMollieRefundStatus,
    roundMoney
};
