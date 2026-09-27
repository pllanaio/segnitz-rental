'use strict';

const money = value => ({ currency: 'EUR', value: Number(value).toFixed(2) });
const line = (description, amount) => ({
    description: description.slice(0, 255), quantity: 1,
    unitPrice: money(amount), totalAmount: money(amount)
});

// Snapshot the actual customer and amounts in the same transaction as the intent.
async function captureMolliePaymentDetails(connection, payment) {
    const [orders] = await connection.execute(
        `SELECT customer_first_name, customer_last_name, customer_email,
                customer_address, customer_zip, customer_city
         FROM rental_orders WHERE id = ?`, [payment.id]
    );
    const customer = orders[0];
    if (!customer) throw new Error('Bestellung für Mollie nicht gefunden.');
    const billingAddress = Object.fromEntries(Object.entries({
        givenName: customer.customer_first_name,
        familyName: customer.customer_last_name,
        email: customer.customer_email,
        streetAndNumber: customer.customer_address,
        postalCode: customer.customer_zip,
        city: customer.customer_city,
        country: process.env.MOLLIE_BILLING_COUNTRY || 'DE'
    }).filter(([, value]) => value));
    let lines = [];
    if (!payment.type || payment.type === 'order_payment') {
        const [items] = await connection.execute(
            `SELECT p.title, roi.price_per_day, roi.deposit,
                    DATEDIFF(roi.rental_end, roi.rental_start) + 1 AS rental_days
             FROM rental_order_items roi JOIN rental_products p ON p.id = roi.product_id
             WHERE roi.order_id = ? AND COALESCE(roi.item_status, 'active') NOT IN ('cancelled', 'expired')
             ORDER BY roi.id`, [payment.id]
        );
        for (const item of items) {
            if (Number(item.price_per_day) > 0) lines.push(line(
                `${item.title} – Miete (${item.rental_days} Tage)`, Number(item.price_per_day) * item.rental_days
            ));
            if (Number(item.deposit) > 0) lines.push(line(`${item.title} – Kaution`, item.deposit));
        }
    }
    const sum = lines.reduce((total, item) => total + Math.round(Number(item.totalAmount.value) * 100), 0);
    if (!lines.length || sum !== Math.round(Number(payment.totalAmount) * 100)) {
        lines = [line(payment.description || `Mietauftrag ${payment.orderNo} inkl. Kaution`, payment.totalAmount)];
    }
    return { billingAddress, lines, locale: 'de_DE' };
}

module.exports = { captureMolliePaymentDetails };
