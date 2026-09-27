'use strict';
const crypto = require('node:crypto');
const { sendGraphMail, escapeHtml } = require('../services/mailService');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const receipt = row => ({ id: row.id, kind: row.kind, name: row.customer_name,
    email: row.customer_email, contractReference: row.contract_reference,
    scope: row.contract_scope, declaration: row.declaration_text, receivedAt: row.receivedAt });

function validate(body) {
    const limits = { name: 200, email: 255, contractReference: 200, scope: 2000 };
    if (body.kind !== 'withdrawal' ||
        typeof body.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.id)) throw new Error('Ungültige Erklärung.');
    const data = { id: body.id, kind: body.kind };
    for (const [field, max] of Object.entries(limits)) {
        if (typeof body[field] !== 'string' || body[field].length > max || (field !== 'scope' && !body[field].trim())) {
            throw new Error('Bitte Name, E-Mail und Vertragsreferenz vollständig und korrekt angeben.');
        }
        data[field] = body[field].trim();
    }
    data.email = data.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
    return data;
}

function registerContractDeclarations(app, { createConnection, transact, checkAdmin, limiter }) {
    const run = work => transact(createConnection, work);
    const respondError = (res, error) => {
        console.error('Vertragserklärung:', error.message);
        res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Die Erklärung konnte nicht gespeichert werden. Bitte erneut versuchen.' });
    };

    app.post('/contract-declarations', limiter, async (req, res) => {
        let data;
        try { data = validate(req.body || {}); }
        catch (error) { return res.status(400).json({ error: error.message }); }
        try {
            const result = await run(async connection => {
                const payloadHash = hash(JSON.stringify(data));
                const [[existing]] = await connection.execute(
                    `SELECT *, DATE_FORMAT(received_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS receivedAt
                     FROM contract_declarations WHERE id = ? FOR UPDATE`, [data.id]
                );
                if (existing) {
                    if (existing.payload_hash !== payloadHash) throw Object.assign(new Error('Die Vorgangsnummer wurde bereits für eine andere Erklärung verwendet.'), { statusCode: 409 });
                    return { receipt: receipt(existing) };
                }
                const [[order]] = await connection.execute(
                    'SELECT id FROM rental_orders WHERE order_no = ? AND customer_email = ? LIMIT 1',
                    [data.contractReference, data.email]
                );
                const declaration = `Hiermit widerrufe ich den Vertrag ${data.contractReference}${data.scope ? ` hinsichtlich: ${data.scope}` : ' vollständig'}.`;
                const receivedAt = new Date().toISOString();
                await connection.execute(
                    `INSERT INTO contract_declarations
                     (id, payload_hash, kind, customer_name, customer_email, contract_reference, contract_scope,
                      declaration_text, received_at, order_id, processing_status, confirmation_token_hash, confirmation_expires_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR)))`,
                    [data.id, payloadHash, data.kind, data.name, data.email, data.contractReference, data.scope,
                        declaration, receivedAt.replace('T', ' ').replace('Z', ''), order?.id || null,
                        'received', null, null]
                );
                const row = { id: data.id, kind: data.kind, customer_name: data.name, customer_email: data.email,
                    contract_reference: data.contractReference, contract_scope: data.scope, declaration_text: declaration, receivedAt };
                const title = 'Eingangsbestätigung Ihres Widerrufs';
                const base = String(process.env.BASE_URL || '').replace(/\/$/, '');
                const text = `${title}\n${declaration}\nName: ${data.name}\nE-Mail: ${data.email}\nEingang (UTC): ${receivedAt}\nVorgang: ${data.id}\nIhre Widerrufserklärung ist eingegangen. Eine weitere Bestätigung Ihrerseits ist nicht erforderlich. Wir kümmern uns um die Zuordnung und Rückabwicklung.`;
                await sendGraphMail({ to: data.email, subject: title,
                    text, html: `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`
                }, { connection, operationKey: `mail-declaration-${data.id}` });
                const adminEmail = process.env.CONTRACT_REQUEST_EMAIL || process.env.ORDER_BCC || process.env.GRAPH_MAIL_USER;
                if (adminEmail) await sendGraphMail({ to: adminEmail.split(/[;,]/).map(value => value.trim()).filter(Boolean),
                    subject: `Widerruf eingegangen – ${data.contractReference}`,
                    text: `${declaration}\nName: ${data.name}\nE-Mail: ${data.email}\nEingang (UTC): ${receivedAt}\nVorgang: ${data.id}\n${base}/backend.html`,
                    html: `<h2>Widerruf eingegangen</h2><p>${escapeHtml(declaration)}</p><p>${escapeHtml(data.name)} · ${escapeHtml(data.email)}</p><p>Eingang (UTC): ${receivedAt}<br>Vorgang: ${data.id}</p><p><a href="${base}/backend.html">Im Admin Dashboard bearbeiten</a></p>`
                }, { connection, operationKey: `mail-declaration-admin-${data.id}` });
                return { receipt: receipt(row) };
            });
            res.set('Cache-Control', 'no-store').status(201).json(result);
        } catch (error) { respondError(res, error); }
    });

    app.get('/admin/contract-declarations', checkAdmin, async (req, res) => {
        let connection;
        try {
            connection = await createConnection();
            const [items] = await connection.execute(
                `SELECT id, kind, customer_name, customer_email, contract_reference, contract_scope,
                        declaration_text, DATE_FORMAT(received_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS receivedAt,
                        order_id, processing_status, processing_note
                 FROM contract_declarations ORDER BY (processing_status = 'received') DESC, received_at DESC LIMIT 200`
            );
            res.set('Cache-Control', 'no-store').json({ items });
        } catch (error) { respondError(res, error); }
        finally { if (connection) await connection.end(); }
    });
    app.post('/admin/contract-declarations/:id/processed', checkAdmin, async (req, res) => {
        if (typeof req.body?.note !== 'string' || !req.body.note.trim() || req.body.note.length > 2000) return res.status(400).json({ error: 'Bitte die erfolgte Bearbeitung dokumentieren.' });
        try {
            await run(async connection => {
                const [result] = await connection.execute(
                    `UPDATE contract_declarations SET processing_status = 'processed', processing_note = ?,
                     processed_at = UTC_TIMESTAMP(), processed_by = ? WHERE id = ?`,
                    [req.body.note.trim(), req.session.user, req.params.id]
                );
                if (!result.affectedRows) throw Object.assign(new Error('Vorgang nicht gefunden.'), { statusCode: 404 });
            });
            res.json({ message: 'Bearbeitung dokumentiert.' });
        } catch (error) { respondError(res, error); }
    });
}
module.exports = { registerContractDeclarations, validate };
