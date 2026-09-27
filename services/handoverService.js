'use strict';
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const path = require('node:path');
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const CONFIRMATION = 'Ich bestätige, dass ich die aufgeführten Artikel und die dokumentierten Zustände, Beschädigungen und Bemerkungen gemeinsam mit dem Vermieter geprüft habe.';

async function normalizeImage(value, signature = false) {
    if (typeof value !== 'string' || value.length > 1800000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) fail('Bitte gültige Bilddateien verwenden.');
    const input = Buffer.from(value.split(',')[1], 'base64');
    try {
        const image = sharp(input, { limitInputPixels: 20000000, animated: false });
        const meta = await image.metadata();
        if (!['png', 'jpeg', 'webp'].includes(meta.format) || (meta.pages || 1) > 1) fail('Bildformat nicht unterstützt.');
        if (signature) {
            const stats = await image.clone().flatten({ background: '#ffffff' }).stats();
            if (meta.width < 80 || meta.height < 25 || stats.channels.slice(0, 3).every(channel => channel.stdev < 2)) fail('Bitte eine Unterschrift leisten.');
        }
        const result = await image.rotate().resize({ width: signature ? 1000 : 1100, height: signature ? 400 : 1100, fit: 'inside', withoutEnlargement: true })
            .flatten({ background: '#ffffff' }).jpeg({ quality: 72 }).toBuffer();
        return `data:image/jpeg;base64,${result.toString('base64')}`;
    } catch (error) {
        if (error.statusCode) throw error;
        fail('Ein Bild konnte nicht gelesen werden. Bitte PNG, JPEG oder WebP verwenden.');
    }
}

async function validateDocument(body, finalizing) {
    if (!body || !Number.isInteger(body.revision) || body.revision < 0 || !Array.isArray(body.entries) || body.entries.length > 20) fail('Ungültiges Protokoll. Maximal 20 Einträge sind möglich.');
    const entries = [];
    let count = 0;
    for (const entry of body.entries) {
        if (!entry || !Number.isInteger(entry.itemId) || !['damage', 'scratch', 'note'].includes(entry.kind) || typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 2000 || !Array.isArray(entry.photos) || entry.photos.length > 6) fail('Bitte je Eintrag einen Artikel, eine Bemerkung und höchstens sechs Fotos angeben.');
        count += entry.photos.length;
        if (count > 20) fail('Pro Protokoll sind höchstens 20 Fotos möglich.');
        const photos = [];
        for (const photo of entry.photos) photos.push(await normalizeImage(photo));
        entries.push({ itemId: entry.itemId, kind: entry.kind, text: entry.text.trim(), photos });
    }
    if (!entries.length && body.noDamage !== true) fail('Bitte den Zustand dokumentieren oder bestätigen, dass keine Auffälligkeiten vorhanden sind.');
    if (entries.length && body.noDamage === true) fail('Bitte die Angabe „Keine Auffälligkeiten“ entfernen, wenn Einträge vorhanden sind.');
    let signature = null;
    let signer = '';
    if (finalizing) {
        if (body.confirmed !== true || typeof body.signer !== 'string' || !body.signer.trim() || body.signer.length > 200) fail('Name und Bestätigung der unterschreibenden Person fehlen.');
        signature = await normalizeImage(body.signature, true);
        signer = body.signer.trim();
    }
    const data = { entries, noDamage: body.noDamage === true, signature, signer, confirmation: CONFIRMATION };
    if (Buffer.byteLength(JSON.stringify(data)) > 1900000) fail('Die Fotos sind zusammen zu groß. Bitte weniger oder kleinere Fotos verwenden.');
    return data;
}

const imageBuffer = url => Buffer.from(url.split(',')[1], 'base64');
async function renderHandoverPdf(report) {
    const doc = new PDFDocument({ size: 'A4', margin: 45, bufferPages: true, info: { Title: `Übergabeprotokoll ${report.orderNo}`, Author: report.issuer.name } });
    const chunks = [];
    const result = new Promise((resolve, reject) => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    const ensure = height => { if (doc.y + height > 755) doc.addPage(); };
    const text = (value, bold = false) => { doc.fillColor('#092447').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).text(String(value), { width: 505, lineGap: 3 }).moveDown(0.5); };
    doc.rect(0, 0, 596, 110).fill('#092447');
    doc.image(path.join(__dirname, '../public/img/logo.png'), 45, 15, { fit: [175, 78] });
    doc.y = 130;
    doc.font('Helvetica-Bold').fontSize(23).fillColor('#092447').text('Übergabeprotokoll');
    doc.moveDown(0.5);
    text(`Auftrag ${report.orderNo}`, true);
    text(`${report.issuer.name}\n${report.issuer.address || ''}`);
    text(`Kunde: ${report.customerName}\n${report.email}`);
    text(`Erfasst durch: ${report.processedBy}\nUnterzeichnet: ${new Date(report.signedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`);
    text('Artikel bei Übergabe', true);
    for (const item of report.items) { ensure(60); text(`${item.title} · Position ${item.id}\nMietzeitraum: ${item.start} bis ${item.end}`); }
    if (report.noDamage) text('Bei der gemeinsamen Prüfung wurden keine Auffälligkeiten festgestellt.');
    for (const [index, entry] of report.entries.entries()) {
        ensure(100);
        text(`${index + 1}. ${({ damage: 'Beschädigung', scratch: 'Kratzer', note: 'Bemerkung' })[entry.kind]} · ${report.items.find(item => item.id === entry.itemId)?.title || ''}`, true);
        text(entry.text);
        for (const [photoIndex, photo] of entry.photos.entries()) {
            ensure(235);
            text(`Eintrag ${index + 1} · Foto ${photoIndex + 1}`);
            const top = doc.y;
            doc.image(imageBuffer(photo), 45, top, { fit: [505, 195], align: 'left' });
            doc.y = top + 210;
        }
    }
    ensure(210);
    text('Bestätigung und Kundenunterschrift', true);
    text(report.confirmation);
    text(report.signer);
    const top = doc.y;
    doc.image(imageBuffer(report.signature), 45, top, { fit: [300, 90] });
    const range = doc.bufferedPageRange();
    for (let page = 0; page < range.count; page++) {
        doc.switchToPage(page); doc.font('Helvetica').fontSize(9).fillColor('#52647b');
        doc.text(`${report.orderNo} · Übergabeprotokoll · Seite ${page + 1} / ${range.count}`, 45, 785, { lineBreak: false });
    }
    doc.end();
    return result;
}
module.exports = { validateDocument, renderHandoverPdf, CONFIRMATION };
