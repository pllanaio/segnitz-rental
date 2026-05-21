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
    const baseUrl = process.env.BASE_URL.replace(/\/$/, '');

    const payment = await mollie.payments.create({
        amount: {
            currency: 'EUR',
            value: amountValue
        },
        description: order.description || `Segnitz Rental Bestellung ${order.orderNo}`,
        redirectUrl: order.redirectUrl || `${baseUrl}/index.html?payment=return&orderId=${encodeURIComponent(order.id)}`,
        webhookUrl: `${baseUrl}/webhooks/mollie`,
        metadata: {
            orderId: String(order.id),
            orderNo: String(order.orderNo),
            type: order.type || 'order_payment',
            itemId: order.itemId ? String(order.itemId) : null
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