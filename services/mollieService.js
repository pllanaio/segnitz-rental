const { createMollieClient } = require('@mollie/api-client');

const mollieClient = createMollieClient({
    apiKey: process.env.MOLLIE_API_KEY
});

function getMollieClient() {
    if (!process.env.MOLLIE_API_KEY) {
        throw new Error('MOLLIE_API_KEY fehlt in der .env');
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

async function createMollieCustomer({ name, email, metadata = {} }) {
    if (!email) {
        throw new Error('E-Mail ist für Mollie Customer erforderlich.');
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

    const mollie = getMollieClient();

    return mollie.customers.get(customerId);
}

async function getMollieCustomerMandates(customerId) {
    if (!customerId) {
        throw new Error('customerId ist erforderlich.');
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

    if (order.customerId) {
        payload.customerId = order.customerId;
    }

    if (order.sequenceType) {
        payload.sequenceType = order.sequenceType;
    }

    if (order.mandateId) {
        payload.mandateId = order.mandateId;
    }

    if (Array.isArray(order.methods) && order.methods.length > 0) {
        payload.method = order.methods;
    } else if (order.method) {
        payload.method = order.method;
    }

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

    const mollie = getMollieClient();

    return mollie.payments.get(paymentId);
}

async function createMollieRefundForPayment({
    paymentId,
    amount,
    description,
    metadata = {}
}) {
    if (!paymentId) {
        throw new Error('paymentId ist für eine Erstattung erforderlich.');
    }

    const mollie = getMollieClient();

    return mollie.paymentRefunds.create({
        paymentId,
        amount: {
            currency: 'EUR',
            value: formatMollieAmount(amount)
        },
        description,
        metadata
    });
}

async function listMollieRefundsForPayment(paymentId) {
    if (!paymentId) {
        throw new Error('paymentId ist erforderlich.');
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