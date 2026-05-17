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
    return Number(amount || 0).toFixed(2);
}

async function createMolliePaymentForOrder(order) {
    const mollie = getMollieClient();

    const amountValue = formatMollieAmount(order.totalAmount);

    const payment = await mollie.payments.create({
        amount: {
            currency: 'EUR',
            value: amountValue
        },
        description: `Segnitz Rental Bestellung ${order.orderNo}`,
        redirectUrl: `${process.env.BASE_URL}/index.html?payment=return&orderId=${encodeURIComponent(order.id)}`,
        webhookUrl: `${process.env.BASE_URL}/webhooks/mollie`,
        metadata: {
            orderId: String(order.id),
            orderNo: String(order.orderNo)
        }
    });

    return payment;
}

async function getMolliePayment(paymentId) {
    const mollie = getMollieClient();

    return mollie.payments.get(paymentId);
}

module.exports = {
    createMolliePaymentForOrder,
    getMolliePayment
};