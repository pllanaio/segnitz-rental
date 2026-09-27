'use strict';
const multer = require('multer');
const { validateDocument, renderHandoverPdf, CONFIRMATION } = require('../services/handoverService');
const { sendGraphMail, escapeHtml } = require('../services/mailService');
const { presentMail } = require('../services/mailPresentation');
const error = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const parseDocument = value => typeof value === 'string' ? JSON.parse(value) : value;

function registerHandoverReports(app, { checkAdmin, createConnection, transact, limiter }) {
    const upload = multer({ limits: { fieldSize: 8 * 1024 * 1024, fields: 1, files: 0, parts: 2 } }).none();
    const base = '/admin/orders/:orderId/handover';
    const run = work => transact(createConnection, work);
    const failure = (res, err) => {
        console.error('Ãœbergabeprotokoll:', err.message);
        return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Das Ãœbergabeprotokoll konnte nicht verarbeitet werden.' });
    };
    app.get('/my-orders/:orderId/handover/pdf', async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        if (!req.session.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
        if (!/^\d+$/.test(req.params.orderId)) return res.status(404).json({ error: 'Übergabeprotokoll nicht gefunden.' });
        let connection;
        try {
            connection = await createConnection();
            const [[report]] = await connection.execute(`SELECT h.pdf_data, o.order_no
                FROM rental_orders o JOIN handover_reports h ON h.order_id = o.id
                WHERE o.id = ? AND o.customer_email = ? AND h.status = 'signed'
                AND h.signed_at IS NOT NULL AND h.pdf_data IS NOT NULL`, [req.params.orderId, req.session.user]);
            if (!report) return res.status(404).json({ error: 'Übergabeprotokoll nicht gefunden.' });
            const disposition = req.query.download === '1' ? 'attachment' : 'inline';
            res.type('pdf').set('Content-Disposition', `${disposition}; filename="Uebergabeprotokoll-${String(report.order_no).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf"`).send(report.pdf_data);
        } catch (err) { failure(res, err); } finally { if (connection) await connection.end(); }
    });
    async function getOrder(connection, id, lock = false) {
        if (!/^\d+$/.test(String(id))) throw error('Bestellung nicht gefunden.', 404);
        const [[order]] = await connection.execute(`SELECT * FROM rental_orders WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
        if (!order) throw error('Bestellung nicht gefunden.', 404);
        return order;
    }
    async function getItems(connection, id) {
        const [items] = await connection.execute(`SELECT i.id, p.title, i.item_status AS status, i.picked_up_at,
            DATE_FORMAT(COALESCE(i.adjusted_rental_start, i.rental_start), '%d.%m.%Y') AS start,
            DATE_FORMAT(COALESCE(i.adjusted_rental_end, i.rental_end), '%d.%m.%Y') AS end
            FROM rental_order_items i JOIN rental_products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id`, [id]);
        return items;
    }
    app.get(base, checkAdmin, async (req, res) => {
        let connection;
        try {
            connection = await createConnection();
            const order = await getOrder(connection, req.params.orderId);
            const items = await getItems(connection, order.id);
            const [[row]] = await connection.execute('SELECT revision, status, document_json FROM handover_reports WHERE order_id = ?', [order.id]);
            res.json({ orderNo: order.order_no, items: items.filter(item => item.status !== 'cancelled'),
                editable: !['cancelled', 'expired', 'returned', 'completed'].includes(order.status) && !items.some(item => item.picked_up_at || ['picked_up', 'returned_ok', 'returned_late', 'returned_damaged', 'returned_late_damaged'].includes(item.status)),
                revision: row?.revision || 0, status: row?.status || 'new', document: row ? parseDocument(row.document_json) : null, confirmation: CONFIRMATION });
        } catch (err) { failure(res, err); } finally { if (connection) await connection.end(); }
    });
    app.get(`${base}/pdf`, checkAdmin, async (req, res) => {
        let connection;
        try {
            connection = await createConnection();
            const order = await getOrder(connection, req.params.orderId);
            const [[report]] = await connection.execute("SELECT pdf_data FROM handover_reports WHERE order_id = ? AND status = 'signed'", [order.id]);
            if (!report) throw error('Noch kein unterzeichnetes Ãœbergabeprotokoll vorhanden.', 404);
            res.type('pdf').set('Content-Disposition', `attachment; filename="Uebergabeprotokoll-${String(order.order_no).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf"`).send(report.pdf_data);
        } catch (err) { failure(res, err); } finally { if (connection) await connection.end(); }
    });
    app.post(base, checkAdmin, limiter, (req, res, next) => upload(req, res, err => err ? res.status(400).json({ error: 'Der Upload ist zu groÃŸ oder ungÃ¼ltig. Bitte weniger oder kleinere Fotos verwenden.' }) : next()), async (req, res) => {
        try {
            let body;
            try { body = JSON.parse(req.body.payload); } catch { throw error('UngÃ¼ltiges Protokoll.', 400); }
            const finalizing = body.finalize === true;
            const document = await validateDocument(body, finalizing);
            const result = await run(async connection => {
                const order = await getOrder(connection, req.params.orderId, true);
                const [[existing]] = await connection.execute('SELECT revision, status FROM handover_reports WHERE order_id = ? FOR UPDATE', [order.id]);
                if (existing?.status === 'signed') throw error('Das unterzeichnete Protokoll ist festgeschrieben und kann nicht verÃ¤ndert werden.');
                if ((existing?.revision || 0) !== body.revision) throw error('Das Protokoll wurde zwischenzeitlich geÃ¤ndert. Bitte neu Ã¶ffnen.');
                const allItems = await getItems(connection, order.id);
                const items = allItems.filter(item => item.status === 'active');
                if (['cancelled', 'expired', 'returned', 'completed'].includes(order.status) || !items.length || allItems.some(item => item.picked_up_at || ['picked_up', 'returned_ok', 'returned_late', 'returned_damaged', 'returned_late_damaged'].includes(item.status))) throw error('Das Ãœbergabeprotokoll muss vor der ersten Abholung erstellt und unterschrieben werden.');
                if (document.entries.some(entry => !items.some(item => item.id === entry.itemId))) throw error('Ein Eintrag gehÃ¶rt nicht zu einem aktiven Artikel dieses Auftrags.', 400);
                const signedAt = finalizing ? new Date() : null;
                const report = { ...document, orderNo: order.order_no, email: order.customer_email,
                    customerName: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim(),
                    issuer: { name: process.env.RECEIPT_COMPANY_NAME || 'Segnitz Rental', address: process.env.RECEIPT_COMPANY_ADDRESS || '' },
                    items: items.map(({ id, title, start, end }) => ({ id, title, start, end })), processedBy: req.session.user, signedAt: signedAt?.toISOString() || null };
                const pdf = finalizing ? await renderHandoverPdf(report) : null;
                if (pdf) {
                    const message = { to: order.customer_email, bcc: (process.env.ORDER_BCC || '').split(/[;,]/).map(s => s.trim()).filter(Boolean),
                        subject: `Ihr Ãœbergabeprotokoll â€“ ${order.order_no}`,
                        html: `<h2>Ihr Ãœbergabeprotokoll</h2><p>Zum Auftrag <strong>${escapeHtml(order.order_no)}</strong> erhalten Sie das gemeinsam geprÃ¼fte und unterzeichnete Ãœbergabeprotokoll im Anhang. Es enthÃ¤lt alle dokumentierten EintrÃ¤ge und die zugehÃ¶rigen Fotos.</p>`,
                        handoverPdf: { name: `Uebergabeprotokoll-${String(order.order_no).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`, contentBytes: pdf.toString('base64') } };
                    // Validate the actual Graph message size before committing the signed document.
                    await presentMail(message);
                    await sendGraphMail(message, { connection, operationKey: `mail-handover-${order.id}` });
                }
                const revision = body.revision + 1;
                await connection.execute(`INSERT INTO handover_reports (order_id, revision, status, document_json, pdf_data, updated_by, updated_at, signed_at)
                    VALUES (?, ?, ?, ?, ?, ?, NOW(3), ?) ON DUPLICATE KEY UPDATE revision = VALUES(revision), status = VALUES(status),
                    document_json = VALUES(document_json), pdf_data = VALUES(pdf_data), updated_by = VALUES(updated_by), updated_at = NOW(3), signed_at = VALUES(signed_at)`,
                    [order.id, revision, finalizing ? 'signed' : 'draft', JSON.stringify(report), pdf, req.session.user, signedAt]);
                return { revision, status: finalizing ? 'signed' : 'draft', message: finalizing ? 'Ãœbergabeprotokoll festgeschrieben. Die E-Mail wurde zum Versand vorgemerkt.' : 'Entwurf gespeichert.' };
            });
            res.json(result);
        } catch (err) { failure(res, err); }
    });
}
module.exports = { registerHandoverReports };
