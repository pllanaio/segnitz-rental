const { createMollieClient } = require('@mollie/api-client');

let mollieClient = null;
let testPaymentCounter = 0;
let testRefundCounter = 0;
let testCustomerCounter = 0;

function isTestMode() {
    return process.env.MOLLIE_TEST_MODE === '1';
}

function getMollieClient() {
    if (!process.env.MOLLIE_API_KEY) {
        throw new Error('MOLLIE_API_KEY fehlt in der .env');
    }

    if (!mollieClient) {
        mollieClient = createMollieClient({
            apiKey: process.env.MOLLIE_API_KEY
        });
    }

    return mollieClient;
}

function getBaseUrl() {
    if (!process.env.BASE_URL) {
        throw new Error('BASE_URL fehlt in der .env');
    }

    return process.env.BASE_URL.replace(/\/$/, '');
}

function formatMollieAmount(amount, options = {}) {
    const { allowZero = false } = options;
    const numericAmount = Number(amount || 0);

    if (!Number.isFinite(numericAmount)) {
        throw new Error('Mollie-Betrag ist ungültig.');
    }

    if (allowZero ? numericAmount < 0 : numericAmount <= 0) {
        throw new Error(
            allowZero
                ? 'Mollie-Betrag darf nicht negativ sein.'
                : 'Mollie-Betrag muss größer als 0 sein.'
        );
    }

    return numericAmount.toFixed(2);
}

function getMollieCheckoutUrl(payment) {
    return typeof payment.getCheckoutUrl === 'function'
        ? payment.getCheckoutUrl()
        : payment._links?.checkout?.href;
}

function buildPaymentMetadata(order, overrides = {}) {
    return {
        orderId: String(order.id),
        orderNo: String(order.orderNo),
        type: order.type || 'order_payment',
        itemId: order.itemId ? String(order.itemId) : null,
        ...overrides
    };
}

function getTestPaymentStatus(paymentId) {
    const normalized = String(paymentId || '').toLowerCase();

    if (normalized.includes('_paid')) return 'paid';
    if (normalized.includes('_failed')) return 'failed';
    if (normalized.includes('_canceled') || normalized.includes('_cancelled')) return 'canceled';
    if (normalized.includes('_expired')) return 'expired';
    if (normalized.includes('_charged_back')) return 'charged_back';
    if (normalized.includes('_authorized')) return 'authorized';

    return 'open';
}

function createTestPayment(order, status = 'open') {
    testPaymentCounter += 1;
    const id = `tr_test_${status}_${testPaymentCounter}`;
    const checkoutUrl = `https://checkout.test.mollie.local/${id}`;

    return {
        id,
        status,
        method: status === 'paid' ? 'ideal' : null,
        amount: {
            currency: order.currency || 'EUR',
            value: formatMollieAmount(order.totalAmount, {
                allowZero: Boolean(order.allowZeroAmount)
            })
        },
        metadata: buildPaymentMetadata(order, order.metadata || {}),
        getCheckoutUrl() {
            return checkoutUrl;
        },
        _links: {
            checkout: {
                href: checkoutUrl
            }
        }
    };
}

async function createMollieCustomer({ name, email, metadata = {} }) {
    if (!email) {
        throw new Error('E-Mail ist für Mollie Customer erforderlich.');
    }

    if (isTestMode()) {
        testCustomerCounter += 1;
        return {
            id: `cst_test_${testCustomerCounter}`,
            name: name || email,
            email,
            metadata
        };
    }

    const mollie = getMollieClient();

    return mollie.customers.create({
        name: name || email,
        email,
        metadata
    });
}

async function getMollieCustomer(customerId) {
    if (!customerId) {
        throw new Error('customerId ist erforderlich.');
    }

    if (isTestMode()) {
        return { id: customerId };
    }

    const mollie = getMollieClient();

    return mollie.customers.get(customerId);
}

async function getMollieCustomerMandates(customerId) {
    if (!customerId) {
        throw new Error('customerId ist erforderlich.');
    }

    if (isTestMode()) {
        return { _embedded: { mandates: [] } };
    }

    const mollie = getMollieClient();

    return mollie.customerMandates.page({
        customerId
    });
}

async function getValidMollieMandate(customerId) {
    const mandates = await getMollieCustomerMandates(customerId);

    const mandateList =
        mandates?._embedded?.mandates ||
        mandates?._embedded?.customer_mandates ||
        mandates ||
        [];

    return mandateList.find(mandate => mandate.status === 'valid') || null;
}

async function createMolliePaymentForOrder(order) {
    if (isTestMode()) {
        return createTestPayment(order, 'open');
    }

    const mollie = getMollieClient();

    const amountValue = formatMollieAmount(order.totalAmount, {
        allowZero: Boolean(order.allowZeroAmount)
    });

    const baseUrl = getBaseUrl();

    const payload = {
        amount: {
            currency: order.currency || 'EUR',
            value: amountValue
        },

        description:
            order.description ||
            `Segnitz Rental Bestellung ${order.orderNo}`,

        redirectUrl:
            order.redirectUrl ||
            `${baseUrl}/index.html?payment=return&orderId=${encodeURIComponent(order.id)}`,

        webhookUrl:
            order.webhookUrl ||
            `${baseUrl}/webhooks/mollie`,

        metadata: buildPaymentMetadata(order, order.metadata || {})
    };

    if (order.customerId) payload.customerId = order.customerId;
    if (order.sequenceType) payload.sequenceType = order.sequenceType;
    if (order.mandateId) payload.mandateId = order.mandateId;

    if (Array.isArray(order.methods) && order.methods.length > 0) {
        payload.method = order.methods;
    } else if (order.method) {
        payload.method = order.method;
    }

    if (order.idempotencyKey) payload.idempotencyKey = order.idempotencyKey;

    return mollie.payments.create(payload);
}

async function createFirstMolliePayment(order) {
    if (!order.customerId) {
        throw new Error('customerId ist für First Payment erforderlich.');
    }

    return createMolliePaymentForOrder({
        ...order,
        sequenceType: 'first',
        type: order.type || 'order_payment_first'
    });
}

async function createRecurringMolliePayment(order) {
    if (!order.customerId) {
        throw new Error('customerId ist für Recurring Payment erforderlich.');
    }

    return createMolliePaymentForOrder({
        ...order,
        sequenceType: 'recurring',
        type: order.type || 'recurring_payment',
        redirectUrl: order.redirectUrl || undefined
    });
}

async function getMolliePayment(paymentId) {
    if (!paymentId) {
        throw new Error('paymentId ist erforderlich.');
    }

    if (isTestMode()) {
        return {
            id: paymentId,
            status: getTestPaymentStatus(paymentId),
            method: getTestPaymentStatus(paymentId) === 'paid' ? 'ideal' : null
        };
    }

    const mollie = getMollieClient();

    return mollie.payments.get(paymentId);
}

async function createMollieRefundForPayment({
    paymentId,
    amount,
    description,
    metadata = {},
    idempotencyKey
}) {
    if (!paymentId) {
        throw new Error('paymentId ist für eine Erstattung erforderlich.');
    }

    const formattedAmount = formatMollieAmount(amount);

    if (isTestMode()) {
        testRefundCounter += 1;
        return {
            id: `re_test_paid_${testRefundCounter}`,
            status: 'refunded',
            paymentId,
            amount: {
                currency: 'EUR',
                value: formattedAmount
            },
            description,
            metadata
        };
    }

    const mollie = getMollieClient();

    const payload = {
        paymentId,
        amount: {
            currency: 'EUR',
            value: formattedAmount
        },
        description,
        metadata
    };

    if (idempotencyKey) payload.idempotencyKey = idempotencyKey;

    return mollie.paymentRefunds.create(payload);
}

async function listMollieRefundsForPayment(paymentId) {
    if (!paymentId) {
        throw new Error('paymentId ist erforderlich.');
    }

    if (isTestMode()) {
        return { _embedded: { refunds: [] } };
    }

    const mollie = getMollieClient();

    return mollie.paymentRefunds.page({
        paymentId
    });
}

async function cancelMolliePayment(paymentId) {
    if (!paymentId) {
        throw new Error('paymentId ist erforderlich.');
    }

    if (isTestMode()) {
        return {
            id: paymentId,
            status: 'canceled'
        };
    }

    const mollie = getMollieClient();

    return mollie.payments.cancel(paymentId);
}

module.exports = {
    createMolliePaymentForOrder,
    createFirstMolliePayment,
    createRecurringMolliePayment,

    createMollieCustomer,
    getMollieCustomer,
    getMollieCustomerMandates,
    getValidMollieMandate,

    getMolliePayment,
    createMollieRefundForPayment,
    listMollieRefundsForPayment,
    cancelMolliePayment,

    getMollieCheckoutUrl,
    formatMollieAmount
};
