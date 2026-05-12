function getFormValue(formData, fieldName) {
    const element = formData
        .flatMap(step => step.elements)
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
         LIMIT 1`,
        [`R${year}%`]
    );

    let nextNumber = 1;

    if (rows.length > 0 && rows[0].order_no) {
        nextNumber = Number(rows[0].order_no.slice(5)) + 1;
    }

    return `R${year}${String(nextNumber).padStart(5, '0')}`;
}

function calculateRentalDays(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

function buildOrderSummary(orderNo, cartItems) {
    let rentalTotal = 0;
    let depositTotal = 0;

    const items = cartItems.map(item => {
        const days = calculateRentalDays(item.rentalStart, item.rentalEnd);
        const lineRentalTotal = days * Number(item.pricePerDay || 0) * Number(item.quantity || 1);
        const lineDepositTotal = Number(item.deposit || 0) * Number(item.quantity || 1);

        rentalTotal += lineRentalTotal;
        depositTotal += lineDepositTotal;

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
        status: 'reserved',
        items,
        totals: {
            rentalTotal,
            depositTotal,
            grandTotalBeforeDepositReturn: rentalTotal + depositTotal
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

