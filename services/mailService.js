const nodemailer = require('nodemailer');

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
// hier deine Mail-Funktionen einfügen

async function sendOrderEmail(recipients, orderSummary, customer, signatureDataUrl) {
    if (!recipients || recipients.length === 0) {
        return false;
    }

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'mail.your-server.de',
        port: Number(process.env.SMTP_PORT || 465),
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    const itemsHtml = orderSummary.items.map(item => `
        <tr>
            <td>${escapeHtml(item.title)}</td>
            <td>${escapeHtml(item.rentalStart)} bis ${escapeHtml(item.rentalEnd)}</td>
            <td>${escapeHtml(item.quantity)}</td>
            <td>${Number(item.rentalTotal || 0).toFixed(2)} €</td>
            <td>${Number(item.depositTotal || 0).toFixed(2)} €</td>
        </tr>
    `).join('');

    const signatureHtml = signatureDataUrl
        ? `<img src="${signatureDataUrl}" alt="Unterschrift" style="max-width:180px; max-height:70px; border:1px solid #ddd; padding:6px;">`
        : `<em>Keine Unterschrift vorhanden</em>`;

    const html = `
        <h2>Mietauftrag ${escapeHtml(orderSummary.orderNo)}</h2>

        <h3>Kundendaten</h3>
        <p>
            ${escapeHtml(customer.firstName)} ${escapeHtml(customer.lastName)}<br>
            ${customer.company ? `${escapeHtml(customer.company)}<br>` : ''}
            ${escapeHtml(customer.email)}<br>
            ${escapeHtml(customer.phone)}<br>
            ${escapeHtml(customer.address)}<br>
            ${escapeHtml(customer.zip)} ${escapeHtml(customer.city)}
        </p>

        <h3>Mietprodukte</h3>
        <table border="1" cellpadding="6" cellspacing="0">
            <thead>
                <tr>
                    <th>Produkt</th>
                    <th>Zeitraum</th>
                    <th>Menge</th>
                    <th>Miete</th>
                    <th>Kaution</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHtml}
            </tbody>
        </table>

        <h3>Summen</h3>
        <p>
            Miete: ${Number(orderSummary.totals.rentalTotal || 0).toFixed(2)} €<br>
            Kaution: ${Number(orderSummary.totals.depositTotal || 0).toFixed(2)} €<br>
            Gesamt vor Kautionsrückgabe: ${Number(orderSummary.totals.grandTotalBeforeDepositReturn || 0).toFixed(2)} €
        </p>

        <h3>Unterschrift</h3>
        ${signatureHtml}

        <p style="margin-top:24px;">
            Hinweis: Die Rechnungsstellung erfolgt später über Stripe.
        </p>
    `;

    const customerRecipient = recipients[0]; // erster = Kunde
    const internalRecipient = 'orders@segnitzbau.de';

    await transporter.sendMail({
        from: `"Segnitz Rental" <${process.env.SMTP_USER}>`,
        to: customerRecipient,
        bcc: internalRecipient,
        subject: `Mietauftrag ${orderSummary.orderNo}`,
        html
    });

    return true;
}


async function getRentalOrderSnapshot(connection, orderId) {
    const [orders] = await connection.execute(
        `SELECT *
         FROM rental_orders
         WHERE id = ?
         LIMIT 1`,
        [orderId]
    );

    if (orders.length === 0) return null;

    const [items] = await connection.execute(
        `SELECT
            roi.*,
            p.title
         FROM rental_order_items roi
         JOIN rental_products p ON p.id = roi.product_id
         WHERE roi.order_id = ?
         ORDER BY roi.id ASC`,
        [orderId]
    );

    const [images] = await connection.execute(
        `SELECT
            order_item_id AS orderItemId,
            image_path AS imagePath
         FROM rental_order_return_images
         WHERE order_id = ?
         ORDER BY id ASC`,
        [orderId]
    );

    const imagesByItemId = images.reduce((map, image) => {
        const itemId = Number(image.orderItemId);
        if (!map[itemId]) map[itemId] = [];
        map[itemId].push(image);
        return map;
    }, {});

    return {
        ...orders[0],
        items: items.map(item => ({
            ...item,
            returnImages: imagesByItemId[Number(item.id)] || []
        }))
    };
}


function calculateMailRentalDays(startDate, endDate) {
    if (!startDate || !endDate) return 0;

    const start = new Date(startDate);
    const end = new Date(endDate);

    return Math.max(
        Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1,
        0
    );
}

function calculateMailItemFinancials(item) {
    const taxRate = 0.19;

    const originalDays = calculateMailRentalDays(item.rental_start, item.rental_end);
    const adjustedDays = calculateMailRentalDays(
        item.adjusted_rental_start || item.rental_start,
        item.adjusted_rental_end || item.actual_return_date || item.rental_end
    );

    const originalGross = originalDays * Number(item.price_per_day || 0) * (1 + taxRate);
    const adjustedGross = adjustedDays * Number(item.adjusted_price_per_day || item.price_per_day || 0) * (1 + taxRate);

    const deposit = Number(item.deposit || 0);
    const depositRefund = Number(item.deposit_refund_amount ?? deposit);
    const additionalCharge = Number(item.additional_charge_amount || 0);

    return {
        originalGross,
        adjustedGross,
        rentalDeltaGross: adjustedGross - originalGross,
        deposit,
        depositRefund,
        depositRetained: Math.max(deposit - depositRefund, 0),
        additionalCharge
    };
}

async function sendRentalAdjustmentEmail(connection, orderId, changedItemId) {
    const order = await getRentalOrderSnapshot(connection, orderId);
    if (!order || !order.customer_email) return;

    const changedItem = order.items.find(item => Number(item.id) === Number(changedItemId));

    const rows = order.items.map(item => {
        const start = item.adjusted_rental_start || item.rental_start;
        const end = item.adjusted_rental_end || item.rental_end;
        const price = Number(item.adjusted_price_per_day || item.price_per_day || 0);

        return `
            <tr>
                <td>${escapeHtml(item.title)}</td>
                <td>${escapeHtml(start)} bis ${escapeHtml(end)}</td>
                <td>${price.toFixed(2)} €</td>
                <td>${Number(item.deposit || 0).toFixed(2)} €</td>
            </tr>
        `;
    }).join('');

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'mail.your-server.de',
        port: Number(process.env.SMTP_PORT || 465),
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: `"Segnitz Rental" <${process.env.SMTP_USER}>`,
        to: order.customer_email,
        bcc: 'orders@segnitzbau.de',
        subject: `Aktualisierter Mietauftrag ${order.order_no}`,
        html: `
            <h2>Aktualisierter Mietauftrag ${escapeHtml(order.order_no)}</h2>

            <p>
                Ihr Mietauftrag wurde aktualisiert.
                ${changedItem ? `Geändert wurde der Mietzeitraum für: <strong>${escapeHtml(changedItem.title)}</strong>.` : ''}
            </p>

            <h3>Aktuelle Mietartikel</h3>
            <table border="1" cellpadding="6" cellspacing="0">
                <thead>
                    <tr>
                        <th>Artikel</th>
                        <th>Mietzeitraum</th>
                        <th>Preis / Tag</th>
                        <th>Kaution</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>

            <p style="margin-top:20px;">
                Dies ist die aktualisierte Fassung Ihres Mietauftrags.
            </p>
        `
    });
}

function getReadableReturnStatus(status) {
    switch (String(status || '').trim()) {
        case 'returned_ok':
            return 'Ordnungsgemäß zurückgegeben';

        case 'returned_late':
            return 'Verspätet zurückgegeben';

        case 'returned_damaged':
            return 'Beschädigt zurückgegeben';

        case 'returned_late_damaged':
            return 'Verspätet und beschädigt zurückgegeben';

        case 'pending':
            return 'Rückgabe offen';

        default:
            return status || '-';
    }
}

function formatGermanDate(dateValue) {
    if (!dateValue) return '-';

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return '-';
    }

    return date.toLocaleDateString('de-DE');
}

async function sendReturnSummaryEmail(connection, orderId, returnedItemId) {
    const order = await getRentalOrderSnapshot(connection, orderId);
    if (!order || !order.customer_email) return;

    const returnedItem = order.items.find(item => Number(item.id) === Number(returnedItemId));

    if (!returnedItem) {
        throw new Error('Zurückgegebener Artikel wurde nicht gefunden.');
    }

    const itemFinancials = calculateMailItemFinancials(returnedItem);

    const finalBalance =
        itemFinancials.rentalDeltaGross +
        itemFinancials.additionalCharge -
        itemFinancials.depositRefund;

    const finalLabel = finalBalance > 0
        ? `Noch zu zahlen für diesen Artikel: ${finalBalance.toFixed(2)} €`
        : finalBalance < 0
            ? `Rückzahlung/Gutschrift für diesen Artikel: ${Math.abs(finalBalance).toFixed(2)} €`
            : 'Dieser Artikel ist ausgeglichen: 0,00 €';

    const imageLinks = returnedItem.returnImages.length > 0
        ? returnedItem.returnImages.map(image => `
            <li>
                <a href="${process.env.BASE_URL}/${image.imagePath}">
                    Rückgabefoto ansehen
                </a>
            </li>
        `).join('')
        : '<li>Keine Rückgabefotos vorhanden.</li>';

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'mail.your-server.de',
        port: Number(process.env.SMTP_PORT || 465),
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: `"Segnitz Rental" <${process.env.SMTP_USER}>`,
        to: order.customer_email,
        /*bcc: 'orders@segnitzbau.de',*/
        subject: `Abschlussdaten zu Artikel "${returnedItem.title}" aus Mietauftrag ${order.order_no}`,
        html: `
            <h2>Abschlussdaten zu Ihrem Mietartikel</h2>

            <p>
                Mietauftrag: <strong>${escapeHtml(order.order_no)}</strong><br>
                Artikel: <strong>${escapeHtml(returnedItem.title)}</strong>
            </p>

            <h3>Rückgabe</h3>
            <p>
                Rückgabestatus:
                ${escapeHtml(getReadableReturnStatus(returnedItem.return_status))}<br>
                Rückgabedatum:
                ${escapeHtml(formatGermanDate(returnedItem.actual_return_date))}<br>
                Beschädigt: ${returnedItem.is_damaged ? 'Ja' : 'Nein'}<br>
                Verspätet: ${returnedItem.is_late ? 'Ja' : 'Nein'}<br>
                ${returnedItem.damage_description ? `Schaden: ${escapeHtml(returnedItem.damage_description)}<br>` : ''}
                ${returnedItem.late_description ? `Verspätung: ${escapeHtml(returnedItem.late_description)}<br>` : ''}
            </p>

            <h3>Abrechnung für diesen Artikel</h3>
            <p>
                Miete ursprünglich brutto: ${itemFinancials.originalGross.toFixed(2)} €<br>
                Miete aktuell brutto: ${itemFinancials.adjustedGross.toFixed(2)} €<br>
                Mietdifferenz: ${itemFinancials.rentalDeltaGross.toFixed(2)} €<br><br>

                Kaution: ${itemFinancials.deposit.toFixed(2)} €<br>
                Kaution zurück: ${itemFinancials.depositRefund.toFixed(2)} €<br>
                Kaution einbehalten: ${itemFinancials.depositRetained.toFixed(2)} €<br><br>

                Reparaturkosten / Zusatzforderung: ${itemFinancials.additionalCharge.toFixed(2)} €<br><br>

                <strong>${finalLabel}</strong>
            </p>

            <h3>Rückgabefotos zu diesem Artikel</h3>
            <ul>${imageLinks}</ul>
        `
    });
}

async function sendVerificationEmail(email, token) {
    const verificationUrl = `${process.env.BASE_URL}/verify-email?token=${token}`;

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: `"Segnitz Rental" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'E-Mail-Adresse bestätigen',
        text: `Bitte bestätigen Sie Ihre E-Mail-Adresse über diesen Link: ${verificationUrl}`,
        html: `
            <p>Bitte bestätigen Sie Ihre E-Mail-Adresse.</p>
            <p><a href="${verificationUrl}">E-Mail-Adresse bestätigen</a></p>
            <p>Der Link ist 24 Stunden gültig.</p>
        `
    });
}

async function sendPasswordChangedEmail(email) {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: `"Segnitz Rental" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Ihr Passwort wurde geändert',
        text: 'Ihr Passwort für Ihr Segnitz Rental Kundenkonto wurde erfolgreich geändert.',
        html: `
            <p>Ihr Passwort für Ihr Segnitz Rental Kundenkonto wurde erfolgreich geändert.</p>
            <p>Falls Sie diese Änderung nicht selbst vorgenommen haben, kontaktieren Sie uns bitte umgehend.</p>
        `
    });
}

async function sendPasswordResetEmail(email, resetUrl) {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: `"Segnitz Rental" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Passwort zurücksetzen',
        text: `Sie können Ihr Passwort über folgenden Link zurücksetzen: ${resetUrl}

Der Link ist 30 Minuten gültig.

Falls Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail.`,
        html: `
            <p>Sie haben das Zurücksetzen Ihres Passworts angefordert.</p>
            <p>
                <a href="${resetUrl}">
                    Passwort zurücksetzen
                </a>
            </p>
            <p>Der Link ist 30 Minuten gültig.</p>
            <p>Falls Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail.</p>
        `
    });
}

module.exports = {
    escapeHtml,
    sendOrderEmail,
    getRentalOrderSnapshot,
    sendRentalAdjustmentEmail,
    sendReturnSummaryEmail,
    sendVerificationEmail,
    sendPasswordChangedEmail,
    sendPasswordResetEmail
};