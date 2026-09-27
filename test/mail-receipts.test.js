'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { captureReceipt, renderReceiptPdf, iso } = require('../services/receiptService');
const { presentMail } = require('../services/mailPresentation');
const { mailMustWaitForConfiguration } = require('../services/mailConfiguration');

// A single opaque pixel is a rendering fixture, not a person's signature.
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';
function sampleReceipt(kind = 'order') {
    return {
        kind, version: 1, issuedAt: '2026-09-27T12:00:00Z', orderDate: '2026-09-26', orderNo: 'TEST-2026-001',
        status: 'confirmed', paymentStatus: 'pending', email: 'kunde@example.invalid',
        issuer: { name: 'Segnitz Rental', address: 'Musterstraße 1\n12345 Musterstadt', email: 'service@example.invalid' },
        customer: ['Musterkunde', 'Testweg 2', '12345 Musterstadt'], signature: pixel,
        items: [{ id: 1, title: 'Rüttelplatte', start: '2026-09-27', end: '2026-09-29', originalStart: '2026-09-27', originalEnd: '2026-09-28', rental: 149.7, deposit: 150, status: 'returned_damaged', returnDate: '2026-09-29', returnStatus: 'returned_damaged', refund: 100, retained: 50, extra: 50, damage: 'Griff beschädigt', extraReason: 'Reparatur' }],
        payments: [{ id: 1, type: 'rental', amount: 149.7, method: 'cash', status: 'paid' }, { id: 2, type: 'deposit_refund', amount: -100, method: 'cash', status: 'pending' }]
    };
}

test('alle vier Belegarten sind echte PDFs mit eingebetteten Bildern', async () => {
    for (const kind of ['order', 'extension', 'return', 'completed']) {
        const pdf = await renderReceiptPdf(sampleReceipt(kind), `test-${kind}`);
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
        assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);
        assert.match(pdf.toString('latin1'), /%%EOF/);
    }
});

test('Rückgabefotos bleiben im PDF eingebettet, auch wenn die Quelldatei später fehlt', async () => {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const crypto = require('node:crypto');
    const sharp = require('sharp');
    const { captureReturnPhotos } = require('../services/returnPhotoReceipt');
    const { RETURN_IMAGE_DIRECTORY } = require('../utils/uploads');
    const filename = `receipt-test-${crypto.randomUUID()}.webp`;
    const filePath = path.join(RETURN_IMAGE_DIRECTORY, filename);
    try {
        const source = await sharp({ create: { width: 1000, height: 600, channels: 3, background: '#eab308' } }).webp().toBuffer();
        await fs.writeFile(filePath, source);
        const photos = await captureReturnPhotos({ execute: async (sql, params) => {
            assert.match(sql, /WHERE order_id = \? AND order_item_id IN/);
            assert.deepEqual(params, [17, 1]);
            return [[{ id: 2, order_item_id: 1, image_path: `img/returns/${filename}` }]];
        } }, 17, [1]);
        assert.deepEqual(await fs.readFile(filePath), source, 'Originalfoto wird nicht verändert');
        await fs.unlink(filePath);
        const photoBytes = Buffer.from(photos[0].contentBase64, 'base64');
        const metadata = await sharp(photoBytes).metadata();
        assert.equal(metadata.format, 'jpeg');
        assert.equal(metadata.width, 1000);
        const mail = await presentMail({ subject: 'Rückgabe', receipt: { ...sampleReceipt('return'), photos }, operationKey: 'return-photo-test' });
        assert.match(mail.html, /dokumentierten Fotos/);
        assert.doesNotMatch(mail.html, /img\/returns\//);
        const pdf = Buffer.from(mail.attachments.find(a => a.contentType === 'application/pdf').contentBytes, 'base64');
        assert.ok(pdf.includes(photoBytes), 'PDF enthält die tatsächlichen Foto-Bytes');
        assert.ok(Buffer.byteLength(JSON.stringify(mail)) < 3_500_000);
    } finally { await fs.rm(filePath, { force: true }); }
});

test('Fotoaufbereitung berücksichtigt Ausrichtung und ein gemeinsames Größenbudget', async () => {
    const sharp = require('sharp');
    const crypto = require('node:crypto');
    const { compressReturnPhoto, PHOTO_BUDGET_BYTES, captureReturnPhotos } = require('../services/returnPhotoReceipt');
    const rotated = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#092447' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const metadata = await sharp(await compressReturnPhoto(rotated, PHOTO_BUDGET_BYTES / 10)).metadata();
    assert.equal(metadata.width, 400);
    assert.equal(metadata.height, 800);
    assert.equal(metadata.orientation, undefined);
    const noisy = await sharp(crypto.randomBytes(1800 * 1200 * 3), { raw: { width: 1800, height: 1200, channels: 3 } }).png().toBuffer();
    assert.ok((await compressReturnPhoto(noisy, PHOTO_BUDGET_BYTES / 10)).length <= PHOTO_BUDGET_BYTES / 10);
    await assert.rejects(() => captureReturnPhotos({ execute: async () => [[{ id: 1, order_item_id: 1, image_path: 'img/returns/../../secret.png' }]] }, 17, [1]), /Ungültiger Pfad/);
    await assert.rejects(() => compressReturnPhoto(Buffer.from('kein Bild'), 120000));
});

test('Mail verwendet CID-Unterschrift, PDF-Anhang und escaped Absenderdaten', async () => {
    const receipt = sampleReceipt();
    receipt.issuer.name = '<script>Test</script>';
    const mail = await presentMail({ subject: '<Test>', html: '<h2>Bestellung</h2><a href="https://example.invalid">Öffnen</a>', receipt, operationKey: 'test-order' });
    assert.match(mail.html, /cid:order-signature/);
    assert.doesNotMatch(mail.html, /src="data:|<script>/);
    assert.match(mail.html, /&lt;script&gt;Test/);
    assert.equal(mail.attachments.length, 3);
    const pdf = mail.attachments.find(a => a.contentType === 'application/pdf');
    assert.equal(pdf.isInline, false);
    assert.equal(Buffer.from(pdf.contentBytes, 'base64').subarray(0, 5).toString(), '%PDF-');
    const signature = mail.attachments.find(a => a.contentId === 'order-signature');
    assert.equal(signature.isInline, true);
    assert.equal(signature.contentBytes, pixel.split(',')[1]);
});

test('Kontomail bekommt das gleiche Layout ohne erfundene Unterschrift oder Beleg', async () => {
    const mail = await presentMail({ subject: 'Passwort zurücksetzen', text: 'Bitte bestätigen.' });
    assert.match(mail.html, /cid:segnitz-logo/);
    assert.equal(mail.attachments.length, 1);
    assert.doesNotMatch(mail.html, /cid:order-signature/);
});

test('Belegsnapshot trennt interne Notizen, Datumsgrenzen und doppelte Zahlungszeilen', async () => {
    const results = [
        [{ id: 1, order_no: 'TEST', created_at: new Date('2026-09-26T22:00:00Z'), customer_email: 'kunde@example.invalid', signature_data_url: pixel, customer_first_name: 'Test' }],
        [{ id: 2, title: 'Gerät', rental_start: new Date('2026-09-26T22:00:00Z'), rental_end: new Date('2026-09-27T22:00:00Z'), price_per_day: 20, deposit: 50, return_notes: 'INTERN GEHEIM' }],
        [{ id: 1, payment_type: 'initial_payment', amount: 90 }, { id: 2, payment_type: 'rental', amount: 40 }, { id: 3, payment_type: 'deposit', amount: 50 }]
    ];
    const receipt = await captureReceipt({ execute: async () => [results.shift()] }, 1, 'order');
    assert.equal(receipt.items[0].start, '2026-09-27');
    assert.equal(receipt.items[0].rental, 40);
    assert.equal(receipt.payments.length, 2);
    assert.equal(receipt.signature, pixel);
    assert.doesNotMatch(JSON.stringify(receipt), /INTERN GEHEIM/);
    assert.equal(iso(new Date('2026-03-28T23:00:00Z')), '2026-03-29');
});

test('fehlende Zugangsdaten pausieren echten Versand ohne Testmodus zu verändern', () => {
    const original = { disabled: process.env.DISABLE_EMAILS, secret: process.env.MS_CLIENT_SECRET };
    try {
        delete process.env.MS_CLIENT_SECRET;
        process.env.DISABLE_EMAILS = '0';
        assert.equal(mailMustWaitForConfiguration(), true);
        process.env.DISABLE_EMAILS = '1';
        assert.equal(mailMustWaitForConfiguration(), false);
    } finally {
        for (const [key, value] of [['DISABLE_EMAILS', original.disabled], ['MS_CLIENT_SECRET', original.secret]]) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});

test('ungültige Signatur bricht die Mailaufbereitung ab statt sie still wegzulassen', async () => {
    const receipt = sampleReceipt();
    receipt.signature = 'data:image/svg+xml;base64,PHN2Zz4=';
    await assert.rejects(() => presentMail({ subject: 'Test', receipt }), /Unterschrift/);
});

test('Graph erhält PDF und Inline-Signatur; der Test versendet keine Netzwerk-Anfrage', async () => {
    const fetchPath = require.resolve('node-fetch');
    const servicePath = require.resolve('../services/mailService');
    const oldFetch = require.cache[fetchPath];
    const oldService = require.cache[servicePath];
    const names = ['DISABLE_EMAILS', 'MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'GRAPH_MAIL_USER'];
    const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
    const requests = [];
    try {
        for (const name of names) process.env[name] = name === 'DISABLE_EMAILS' ? '0' : 'mock-only';
        require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: async (url, options) => {
            requests.push({ url, options });
            return { ok: true, json: async () => ({ access_token: 'mock-token', expires_in: 3600 }) };
        } };
        delete require.cache[servicePath];
        const { deliverGraphMail } = require('../services/mailService');
        await deliverGraphMail({ to: 'recipient@example.invalid', subject: 'Test', html: '<h2>Test</h2>', receipt: sampleReceipt(), operationKey: 'test-key' });
        assert.equal(requests.length, 2);
        const payload = JSON.parse(requests[1].options.body);
        assert.equal(payload.message.attachments.filter(a => a.contentType === 'application/pdf').length, 1);
        assert.equal(payload.message.attachments.find(a => a.contentId === 'order-signature').isInline, true);
        assert.equal(payload.message.body.contentType, 'HTML');
        assert.equal(payload.message.toRecipients[0].emailAddress.address, 'recipient@example.invalid');
        assert.equal(payload.message.internetMessageHeaders[0].value, 'test-key');
        process.env.DISABLE_EMAILS = '1';
        assert.deepEqual(await deliverGraphMail({ subject: 'Test' }), { disabled: true });
        assert.equal(requests.length, 2);
    } finally {
        if (oldFetch) require.cache[fetchPath] = oldFetch; else delete require.cache[fetchPath];
        if (oldService) require.cache[servicePath] = oldService; else delete require.cache[servicePath];
        for (const name of names) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; }
    }
});
