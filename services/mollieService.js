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

function formatMollieAmount(amount) {
    const numericAmount = Number(amount || 0);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error('Mollie-Betrag muss größer als 0 sein.');
    }

    return numericAmount.toFixed(2);
}

function getMollieCheckoutUrl(payment) {
    return typeof payment.getCheckoutUrl === 'function'
        ? payment.getCheckoutUrl()
        : payment._links?.checkout?.href;
}

async function createMolliePaymentForOrder(order) {
    const mollie = getMollieClient();

    const amountValue = formatMollieAmount(order.totalAmount);
    const baseUrl = process.env.BASE_URL.replace(/\/$/, '');

    return mollie.payments.create({
        amount: {
            currency: 'EUR',
            value: amountValue
        },
        description:
            order.description ||
            `Segnitz Rental Bestellung ${order.orderNo}`,

        redirectUrl:
            order.redirectUrl ||
            `${baseUrl}/index.html?payment=return&orderId=${encodeURIComponent(order.id)}`,

        webhookUrl: `${baseUrl}/webhooks/mollie`,

        metadata: {
            orderId: String(order.id),
            orderNo: String(order.orderNo),
            type: order.type || 'order_payment',
            itemId: order.itemId
                ? String(order.itemId)
                : null
        }
    });
}

async function getMolliePayment(paymentId) {
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
        throw new Error(
            'paymentId ist für eine Erstattung erforderlich.'
        );
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

module.exports = {
    createMolliePaymentForOrder,
    getMolliePayment,
    createMollieRefundForPayment,
    getMollieCheckoutUrl
};