const { rentalDays, toCents } = require('./orderFinanceService');
function getFormValue(formData, fieldName) {
    if (!Array.isArray(formData)) return null;

    const element = formData
        .flatMap(step => Array.isArray(step?.elements) ? step.elements : [])
        .find(el => el.name === fieldName);

    return element ? element.value : null;
}

async function getUserIdByEmail(connection, email) {
    if (!email) return null;

    const [rows] = await connection.execute(
        `SELECT id FROM users WHERE username = ? LIMIT 1`,
        [email]
    );

    return rows.length > 0 ? rows[0].id : null;
}

async function generateOrderNo(connection) {
    const year = new Date().getFullYear();

    const [rows] = await connection.execute(
        `SELECT order_no
         FROM rental_orders
         WHERE order_no LIKE ?
         ORDER BY order_no DESC
         LIMIT 1
         FOR UPDATE`,
        [`R${year}%`]
    );

    let nextNumber = 1;

    if (rows.length > 0 && rows[0].order_no) {
        nextNumber = Number(rows[0].order_no.slice(5)) + 1;
    }

    return `R${year}${String(nextNumber).padStart(5, '0')}`;
}

function calculateRentalDays(startDate, endDate) {
    return rentalDays(startDate, endDate);
}

function buildOrderSummary(orderNo, cartItems, status = 'reserved') {
    let rentalTotalCents = 0;
    let depositTotalCents = 0;

    const items = cartItems.map(item => {
        const days = calculateRentalDays(item.rentalStart, item.rentalEnd);
        const quantity = Number(item.quantity ?? 1);
        if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Ungültige Mietmenge.');
        const lineRentalCents = days * toCents(item.pricePerDay || 0) * quantity;
        const lineDepositCents = toCents(item.deposit || 0) * quantity;
        rentalTotalCents += lineRentalCents;
        depositTotalCents += lineDepositCents;
        if (!Number.isSafeInteger(rentalTotalCents + depositTotalCents)) throw new Error('Mietsumme außerhalb des sicheren Bereichs.');
        const lineRentalTotal = lineRentalCents / 100;
        const lineDepositTotal = lineDepositCents / 100;

        return {
            productId: item.productId,
            productKey: item.productKey,
            title: item.title,
            rentalStart: item.rentalStart,
            rentalEnd: item.rentalEnd,
            days,
            quantity: item.quantity,
            pricePerDay: Number(item.pricePerDay || 0),
            deposit: Number(item.deposit || 0),
            rentalTotal: lineRentalTotal,
            depositTotal: lineDepositTotal
        };
    });

    return {
        orderNo,
        status,
        items,
        totals: {
            rentalTotal: rentalTotalCents / 100,
            depositTotal: depositTotalCents / 100,
            grandTotalBeforeDepositReturn: (rentalTotalCents + depositTotalCents) / 100
        }
    };
}

module.exports = {
    getFormValue,
    getUserIdByEmail,
    generateOrderNo,
    calculateRentalDays,
    buildOrderSummary
};
