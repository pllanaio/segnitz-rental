'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { captureReturnPhotos } = require('./returnPhotoReceipt');

const TITLES = { order: 'Bestellbeleg', extension: 'Mietverlängerung', return: 'Rückgabebeleg', completed: 'Abschlussbeleg' };
const LABELS = {
    pending: 'Offen', open: 'Offen', authorized: 'Autorisiert', paid: 'Bezahlt', refunded: 'Erstattet',
    failed: 'Fehlgeschlagen', cancelled: 'Storniert', expired: 'Abgelaufen', offset: 'Verrechnet',
    confirmed: 'Bestätigt', reserved: 'Reserviert', returned: 'Zurückgegeben', active: 'Aktiv',
    picked_up: 'Abgeholt', returned_ok: 'Ordnungsgemäß zurückgegeben', returned_late: 'Verspätet zurückgegeben',
    returned_damaged: 'Beschädigt zurückgegeben', returned_late_damaged: 'Verspätet und beschädigt',
    rental: 'Miete', deposit: 'Kaution', initial_payment: 'Miete und Kaution', rental_adjustment: 'Mietverlängerung',
    return_additional_charge: 'Rückgabe-Nachzahlung', deposit_refund: 'Kautionsrückerstattung',
    order_cancellation_refund: 'Stornoerstattung', duplicate_payment_refund: 'Erstattung Doppelzahlung',
    chargeback: 'Rückbelastung', charged_back: 'Rückbelastet', refund_record: 'Mollie-Erstattung',
    cash: 'Barzahlung', online: 'Onlinezahlung'
};
const label = value => LABELS[value] || value || '–';
const iso = value => {
    if (!(value instanceof Date)) return String(value || '');
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.BUSINESS_TIME_ZONE || 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
};
const date = value => {
    const calendarValue = typeof value === 'string' && /T\d{2}:\d{2}/.test(value) ? new Date(value) : value;
    const match = iso(calendarValue).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : '–';
};
const money = value => Number(value || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }).replace(/\u00a0/g, ' ');

// Capture only customer-facing fields inside the event's transaction. Never read
// mutable order data in the mail worker, and never copy internal return notes.
async function captureReceipt(connection, orderId, kind, itemId = null) {
    if (!TITLES[kind] || !connection) throw new Error('Belegtyp oder Datenbankverbindung fehlt.');
    const [[order]] = await connection.execute("SELECT *, DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at FROM rental_orders WHERE id = ?", [orderId]);
    if (!order) throw new Error('Bestellung für Beleg nicht gefunden.');
    const [items] = await connection.execute(
        `SELECT i.*, p.title,
         DATE_FORMAT(i.rental_start, '%Y-%m-%d') AS rental_start,
         DATE_FORMAT(i.rental_end, '%Y-%m-%d') AS rental_end,
         DATE_FORMAT(i.adjusted_rental_start, '%Y-%m-%d') AS adjusted_rental_start,
         DATE_FORMAT(i.adjusted_rental_end, '%Y-%m-%d') AS adjusted_rental_end,
         DATE_FORMAT(i.actual_return_date, '%Y-%m-%d') AS actual_return_date
         FROM rental_order_items i JOIN rental_products p ON p.id = i.product_id
         WHERE i.order_id = ? ORDER BY i.id`, [orderId]
    );
    const [payments] = await connection.execute(
        'SELECT * FROM rental_order_payments WHERE order_id = ? ORDER BY id', [orderId]
    );
    const selected = items.filter(item => itemId === null || Number(item.id) === Number(itemId));
    if (!selected.length) throw new Error('Bestellposition für Beleg nicht gefunden.');
    const photos = kind === 'return' ? await captureReturnPhotos(connection, orderId, selected.map(item => item.id)) : [];
    return {
        photos,
        version: 1, kind, issuedAt: new Date().toISOString(), orderNo: order.order_no,
        orderDate: iso(order.created_at), status: order.status, paymentStatus: order.payment_status,
        email: order.customer_email,
        issuer: { name: process.env.RECEIPT_COMPANY_NAME || 'Segnitz Rental', address: process.env.RECEIPT_COMPANY_ADDRESS || '', email: process.env.GRAPH_MAIL_USER || '' },
        customer: [order.customer_company, `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim(), order.customer_address, `${order.customer_zip || ''} ${order.customer_city || ''}`.trim()].filter(Boolean),
        signature: order.signature_data_url || null,
        couponCode: order.coupon_code || null, couponPercent: Number(order.coupon_percent || 0),
        items: selected.map(item => {
            const start = iso(item.adjusted_rental_start || item.rental_start).slice(0, 10);
            const end = iso(item.adjusted_rental_end || item.rental_end).slice(0, 10);
            const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1);
            return {
                id: item.id, title: item.title, start, end, status: item.item_status,
                originalStart: iso(item.rental_start), originalEnd: iso(item.rental_end),
                rental: Number(item.adjusted_rental_total ?? Math.max(0, days * Number(item.adjusted_price_per_day ?? item.price_per_day) - Number(item.discount_amount || 0))),
                discountAmount: Number(item.discount_amount || 0),
                deposit: Number(item.deposit || 0), returnDate: iso(item.actual_return_date),
                returnStatus: item.return_status, refund: Number(item.deposit_refund_amount || 0),
                retained: Number(item.deposit_deduction_amount || 0), extra: Number(item.additional_charge_amount || 0),
                damage: item.damage_description || '', extraReason: item.additional_charge_reason || '',
                deductionReason: item.deposit_deduction_reason || ''
            };
        }),
        // The initial payment duplicates the rental/deposit component rows.
        payments: payments.filter(p => (p.payment_type !== 'initial_payment' || !payments.some(component => ['rental', 'deposit'].includes(component.payment_type))) &&
            (itemId === null || Number(p.order_item_id) === Number(itemId))).map(p => ({
            id: p.id, type: p.payment_type, method: p.payment_method, status: p.payment_status, amount: Number(p.amount)
        }))
    };
}

function signatureBuffer(dataUrl) {
    if (!dataUrl) return null;
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
    if (!match || dataUrl.length > 800000) throw new Error('Unterschrift hat ein ungültiges Bildformat.');
    return { buffer: Buffer.from(match[2], 'base64'), mime: `image/${match[1]}` };
}

function receiptFilename(receipt, operationKey = '') {
    const id = crypto.createHash('sha256').update(operationKey || JSON.stringify(receipt)).digest('hex').slice(0, 10);
    return `${TITLES[receipt.kind]}-${String(receipt.orderNo).replace(/[^a-zA-Z0-9_-]/g, '_')}-${id}.pdf`;
}

async function renderReceiptPdf(receipt, operationKey = '') {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 44, right: 44, bottom: 86, left: 44 }, bufferPages: true, info: { Title: `${TITLES[receipt.kind]} ${receipt.orderNo}`, Author: receipt.issuer.name, CreationDate: new Date(receipt.issuedAt) } });
    const chunks = [];
    const result = new Promise((resolve, reject) => {
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
    const navy = '#092447';
    const ensure = height => { if (doc.y + height > 755) doc.addPage(); };
    const text = (value, options = {}) => {
        doc.font('Helvetica').fontSize(10).fillColor(navy);
        const content = String(value || '');
        ensure(Math.min(160, doc.heightOfString(content, { width: 507 }) + 9));
        doc.text(content, 44, doc.y, { width: 507, lineGap: 2, ...options }).moveDown(0.25);
    };
    const heading = value => { ensure(65); doc.moveDown(0.45).font('Helvetica-Bold').fontSize(13).fillColor(navy).text(value, 44, doc.y).moveDown(0.4); };
    const row = (name, value) => text(`${name}: ${value}`);
    try {
        doc.rect(0, 0, 595.28, 112).fill(navy);
        doc.image(path.join(__dirname, '../public/img/logo.png'), 42, 15, { fit: [178, 82] });
        doc.rect(0, 112, 595.28, 4).fill('#ffcc00');
        doc.y = 140;
        doc.font('Helvetica-Bold').fontSize(25).fillColor(navy).text(TITLES[receipt.kind], 44, doc.y);
        doc.moveDown(0.4);
        text(`Auftrag ${receipt.orderNo}  |  Belegdatum ${date(receipt.issuedAt)}`);
        text(`Beleg-ID: ${receiptFilename(receipt, operationKey).replace(/\.pdf$/, '')}`, { lineGap: 0 });
        const addressTop = doc.y + 14;
        doc.font('Helvetica-Bold').fontSize(11).text('Vermieter', 44, addressTop, { width: 240 });
        doc.font('Helvetica').fontSize(10).text([receipt.issuer.name, receipt.issuer.address, receipt.issuer.email].filter(Boolean).join('\n'), 44, addressTop + 20, { width: 240, lineGap: 3 });
        const issuerBottom = doc.y;
        doc.font('Helvetica-Bold').fontSize(11).text('Kunde', 310, addressTop, { width: 241 });
        doc.font('Helvetica').fontSize(10).text([...receipt.customer, receipt.email].filter(Boolean).join('\n'), 310, addressTop + 20, { width: 241, lineGap: 3 });
        doc.y = Math.max(issuerBottom, doc.y) + 18;
        if (receipt.kind === 'order' || receipt.kind === 'completed') {
            row('Bestellstatus', label(receipt.status));
            row('Zahlungsstatus der ursprünglichen Bestellung', label(receipt.paymentStatus));
        }
        for (const item of receipt.items) {
            heading(`${item.title} · Position ${item.id}`);
            row('Mietzeitraum', `${date(item.start)} bis ${date(item.end)}`);
            if (receipt.kind === 'extension') row('Ursprünglich bestellt', `${date(item.originalStart)} bis ${date(item.originalEnd)}`);
            if (item.discountAmount > 0) row(`Gutschein ${receipt.couponCode || ''} (${receipt.couponPercent} %) · Rabatt auf ursprüngliche Miete`, `-${money(item.discountAmount)}`);
            row('Miete für diesen Zeitraum', money(item.rental));
            row('Ursprüngliche Kaution', money(item.deposit));
            if (item.status === 'cancelled') row('Position', 'Storniert');
            if (['return', 'completed'].includes(receipt.kind) && item.returnDate) {
                row('Rückgabe', `${date(item.returnDate)} · ${label(item.returnStatus)}`);
                row('Kaution zurückzuzahlen', money(item.refund));
                row('Kaution einbehalten / verrechnet', money(item.retained));
                row('Zusatzkosten bei Rückgabe', money(item.extra));
                if (item.damage) row('Schaden', item.damage);
                if (item.extraReason) row('Grund der Zusatzkosten', item.extraReason);
                if (item.deductionReason) row('Kautionsabrechnung', item.deductionReason);
            }
        }
        if (receipt.kind === 'order') {
            const activeItems = receipt.items.filter(item => item.status !== 'cancelled');
            const rental = activeItems.reduce((sum, item) => sum + item.rental, 0);
            const deposit = activeItems.reduce((sum, item) => sum + item.deposit, 0);
            heading('Bestellsumme');
            row('Miete gesamt', money(rental));
            row('Kaution gesamt', money(deposit));
            row('Gesamt vor Kautionsrückgabe', money(rental + deposit));
        }
        if (receipt.payments.length) {
            heading('Zahlungsübersicht zum Belegdatum');
            for (const payment of receipt.payments) {
                text(`${label(payment.type)} · ${money(payment.amount)} · ${label(payment.method)} · ${label(payment.status)}`);
            }
        }
        ensure(180);
        heading('Unterschrift bei Bestellung');
        text(`Bei Bestellung am ${date(receipt.orderDate)} geleistet. Keine erneute Unterschrift für spätere Vorgänge.`);
        const signature = signatureBuffer(receipt.signature);
        if (signature) {
            ensure(95);
            const signatureImage = doc.openImage(signature.buffer);
            if (signatureImage.width * signatureImage.height > 4_000_000 || signatureImage.width > 4096 || signatureImage.height > 4096) {
                throw new Error('Die gespeicherte Unterschrift ist zu groß für den PDF-Beleg.');
            }
            const top = doc.y;
            doc.roundedRect(44, top, 250, 72, 5).lineWidth(0.5).stroke('#c8d1df');
            doc.image(signature.buffer, 53, top + 6, { fit: [230, 60] });
            doc.y = top + 86;
        } else text('Für diese Bestellung ist keine Unterschrift gespeichert.');
        text('Beleg zum Bestellstand; keine Umsatzsteuerrechnung. Offene Beträge sind nicht als bezahlt bestätigt.');
        const photos = receipt.photos || [];
        for (let index = 0; index < photos.length; index++) {
            if (index % 2 === 0) {
                doc.addPage();
                heading('Rückgabefotos');
                text(`Auftrag ${receipt.orderNo} · Rückgabedokumentation`);
            }
            const photo = photos[index];
            const top = index % 2 === 0 ? 112 : 430;
            doc.y = top;
            text(`Foto ${index + 1} von ${photos.length} · Position ${photo.itemId}`);
            doc.image(Buffer.from(photo.contentBase64, 'base64'), 44, top + 25, {
                fit: [507, 275], align: 'center', valign: 'center'
            });
        }
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            const bottomMargin = doc.page.margins.bottom;
            doc.page.margins.bottom = 0;
            doc.font('Helvetica').fontSize(8).fillColor('#60718a').text(`${receipt.issuer.name} · ${receipt.orderNo} · Seite ${i + 1} von ${range.count}`, 44, 790, { width: 507, lineBreak: false });
            doc.page.margins.bottom = bottomMargin;
        }
        doc.end();
    } catch (error) { doc.destroy(error); }
    return result;
}

module.exports = { captureReceipt, renderReceiptPdf, receiptFilename, signatureBuffer, TITLES, label, date, money, iso };
