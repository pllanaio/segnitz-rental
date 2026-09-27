'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { renderReceiptPdf, receiptFilename, signatureBuffer, date } = require('./receiptService');
const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const attachment = (name, contentType, buffer, contentId) => ({
    '@odata.type': '#microsoft.graph.fileAttachment', name, contentType,
    contentBytes: buffer.toString('base64'),
    ...(contentId ? { isInline: true, contentId } : { isInline: false })
});

async function presentMail(message) {
    const attachments = [attachment('segnitz-logo.png', 'image/png', fs.readFileSync(path.join(__dirname, '../public/img/logo.png')), 'segnitz-logo')];
    let body = message.html || `<p>${escape(message.text).replace(/\n/g, '<br>')}</p>`;
    // Legacy order messages contained data URLs, which many mail clients hide.
    body = body.replace(/<h3>Unterschrift<\/h3>\s*(?:<img[^>]*>|<em>[^<]*<\/em>)/g, '');
    body = body.replace(/<h2>/g, '<h2 style="font-size:24px;line-height:1.3;margin:0 0 24px;color:#092447">')
        .replace(/<h3>/g, '<h3 style="font-size:14px;margin:28px 0 10px;color:#092447">')
        .replace(/<table border="1" cellpadding="6" cellspacing="0">/g, '<table cellpadding="8" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px">')
        .replace(/<th>/g, '<th align="left" style="background:#edf2f8;border-bottom:2px solid #ffcc00">')
        .replace(/<td>/g, '<td style="border-bottom:1px solid #dce3ed">')
        .replace(/<a href=/g, '<a style="display:inline-block;background:#ffcc00;color:#092447;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;word-break:break-word" href=');
    if (message.receipt) {
        const receipt = message.receipt;
        const signature = signatureBuffer(receipt.signature);
        body += '<p style="padding:16px;background:#edf2f8;border-radius:8px">Ihren PDF-Beleg finden Sie im Anhang dieser E-Mail.</p>';
        if (receipt.photos?.length) {
            body += `<p>Der Rückgabenachweis enthält auch die ${receipt.photos.length} bei der Rückgabe dokumentierten Fotos.</p>`;
        }
        if (signature) {
            attachments.push(attachment('unterschrift.png', signature.mime, signature.buffer, 'order-signature'));
            body += `<h3 style="font-size:14px;margin-top:28px">Ihre Unterschrift bei Bestellung</h3><p style="font-size:12px;color:#60718a">Geleistet am ${escape(date(receipt.orderDate))}. Keine erneute Unterschrift für spätere Änderungen.</p><img src="cid:order-signature" alt="Unterschrift bei Bestellung" width="230" style="max-width:100%;height:auto;background:#ffffff;border:1px solid #dce3ed">`;
        }
        attachments.push(attachment(receiptFilename(receipt, message.operationKey), 'application/pdf', await renderReceiptPdf(receipt, message.operationKey)));
    }
    const issuer = message.receipt?.issuer || { name: process.env.RECEIPT_COMPANY_NAME || 'Segnitz Rental', address: process.env.RECEIPT_COMPANY_ADDRESS || '' };
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(message.subject)}</title></head>
<body style="margin:0;padding:0;background:#edf2f8;font-family:Arial,Helvetica,sans-serif;color:#263c58">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#edf2f8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="padding:24px 32px;background:#092447;border-bottom:4px solid #ffcc00"><img src="cid:segnitz-logo" alt="Segnitz Rental" width="210" style="display:block;max-width:100%;height:auto"></td></tr>
<tr><td style="padding:32px 24px;font-size:15px;line-height:1.65">${body}<p style="margin-top:30px">Viele Grüße<br><strong>Ihr Team von ${escape(issuer.name)}</strong></p></td></tr>
<tr><td style="padding:20px 24px;background:#f6f8fb;font-size:12px;line-height:1.6;color:#60718a">${escape(issuer.name)}${issuer.address ? `<br>${escape(issuer.address).replace(/\n/g, '<br>')}` : ''}<br>Diese Nachricht wurde automatisch zu Ihrem Kundenkonto oder Mietauftrag erstellt.</td></tr>
</table></td></tr></table></body></html>`;
    // Graph's JSON sendMail endpoint has a bounded request size. Fail explicitly
    // rather than silently dropping the legally relevant signature or receipt.
    if (Buffer.byteLength(JSON.stringify({ html, attachments })) > 3_500_000) throw new Error('Mail mit Beleg überschreitet die zulässige Anhangsgröße.');
    return { html, attachments };
}

module.exports = { presentMail };
