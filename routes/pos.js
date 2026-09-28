'use strict';
const { getMolliePayment, cancelMolliePayment } = require('../services/mollieService');
const { transferDueDate } = require('../services/invoiceTransfer');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { posMode, listTerminals, getTerminal, validateTerminalSettings, getPosLimits } = require('../services/posService');
const { enqueueMolliePaymentCreation } = require('../services/externalEffectsOutbox');
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
function registerPosRoutes(app, { checkAdmin, createConnection, transact, processEffect, reconcile }) {
    const limiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
        keyGenerator: req => String(req.session.user), message: { error: 'Zu viele POS-Aktionen. Bitte kurz warten.' } });
    const syncLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
        keyGenerator: req => String(req.session.user), message: { error: 'Zu viele Statusabfragen. Bitte kurz warten.' } });
    const failure = (res, error) => {
        console.error('POS:', error.message);
        res.status(error.statusCode && error.statusCode < 500 ? error.statusCode : 503)
            .json({ error: error.statusCode && error.statusCode < 500 ? error.message : 'Mollie POS ist momentan nicht erreichbar. Bitte erneut versuchen.' });
    };
    app.get('/admin/pos/terminals', checkAdmin, async (req, res) => {
        let connection;
        try {
            const mode = posMode();
            const terminals = await listTerminals();
            connection = await createConnection();
            const [settings] = await connection.execute('SELECT * FROM pos_terminals WHERE mode = ?', [mode]);
            const items = terminals.map(terminal => {
                const saved = settings.find(item => item.terminal_id === terminal.id);
                return { ...terminal, label: saved?.label || '', location: saved?.location || '', enabled: saved ? Boolean(saved.enabled) : true, revision: saved?.revision || 0 };
            });
            for (const saved of settings.filter(setting => !terminals.some(terminal => terminal.id === setting.terminal_id))) {
                items.push({ id: saved.terminal_id, mode, description: saved.terminal_id, status: 'unavailable', label: saved.label, location: saved.location, enabled: Boolean(saved.enabled), revision: saved.revision });
            }
            res.set('Cache-Control', 'no-store').json({ mode, items });
        } catch (error) { failure(res, error); } finally { if (connection) await connection.end(); }
    });
    app.put('/admin/pos/terminals/:id', checkAdmin, limiter, async (req, res) => {
        try {
            const value = validateTerminalSettings(req.body);
            const terminal = await getTerminal(req.params.id);
            await transact(createConnection, async connection => {
                if (value.revision === 0) {
                    const [created] = await connection.execute(`INSERT IGNORE INTO pos_terminals (terminal_id, mode, label, location, enabled) VALUES (?, ?, ?, ?, ?)`,
                        [terminal.id, terminal.mode, value.label, value.location, Number(value.enabled)]);
                    if (!created.affectedRows) throw fail('Das Terminal wurde zwischenzeitlich geändert. Bitte neu laden.');
                } else {
                    const [updated] = await connection.execute(`UPDATE pos_terminals SET label = ?, location = ?, enabled = ?, revision = revision + 1, updated_at = NOW()
                        WHERE terminal_id = ? AND mode = ? AND revision = ?`, [value.label, value.location, Number(value.enabled), terminal.id, terminal.mode, value.revision]);
                    if (!updated.affectedRows) throw fail('Das Terminal wurde zwischenzeitlich geändert. Bitte neu laden.');
                }
            });
            res.json({ message: 'Terminal-Einstellungen gespeichert.' });
        } catch (error) { failure(res, error); }
    });
    async function syncAdditional(orderId, itemId, type) {
        if (!['rental_adjustment','return_additional_charge'].includes(type)) return;
        const c=await createConnection();
        try {
            const [[source]]=await c.execute('SELECT mollie_payment_id FROM rental_order_payments WHERE order_id=? AND order_item_id=? AND payment_type=? ORDER BY id DESC LIMIT 1',[orderId,itemId,type]);
            if(source?.mollie_payment_id)await reconcile(source.mollie_payment_id);
        } finally { await c.end(); }
    }
    async function releaseAdditional(connection, source) {
        if (!source || !['pending','open','failed','cancelled','expired'].includes(source.payment_status)) throw fail('Keine offene Nachzahlung vorhanden. Bitte Status prüfen.');
        if (source.payment_method === 'online') {
            if (!source.mollie_payment_id) throw fail('Der Zahlungsauftrag wird noch verarbeitet. Bitte erneut prüfen.');
            let remote = await getMolliePayment(source.mollie_payment_id);
            if (remote.status === 'open' && remote.isCancelable !== false) {
                remote = await cancelMolliePayment(source.mollie_payment_id);
            }
            if (!['failed','expired','canceled'].includes(remote.status)) throw fail('Die bisherige Zahlung ist bereits bezahlt oder noch aktiv. Bitte Status prüfen.');
        }
        await connection.execute("UPDATE rental_order_payments SET payment_status='replaced' WHERE id=?", [source.id]);
    }
    app.post('/admin/orders/:id/payments/sync', checkAdmin, syncLimiter, async (req,res) => {
        let c;
        try {
            c=await createConnection();
            const [rows]=await c.execute("SELECT DISTINCT mollie_payment_id FROM rental_order_payments WHERE order_id=? AND payment_method='online' AND mollie_payment_id IS NOT NULL AND payment_status IN ('pending','open','authorized','failed','cancelled','expired')",[req.params.id]);
            for(const row of rows) await reconcile(row.mollie_payment_id);
            res.json({message:'Zahlungsstatus mit Mollie abgeglichen.'});
        }catch(error){failure(res,error);}finally{if(c)await c.end();}
    });
    app.post('/admin/orders/:id/additional-transfer', checkAdmin, limiter, async (req,res) => {
        try {
            const {orderItemId,paymentType}=req.body;
            if(!/^\d+$/.test(req.params.id)||!/^\d+$/.test(String(orderItemId))||!['rental_adjustment','return_additional_charge'].includes(paymentType))throw fail('Ungültige Nachzahlung.',400);
            await syncAdditional(req.params.id,orderItemId,paymentType);
            const result=await transact(createConnection,async c=>{
                const [[order]]=await c.execute('SELECT * FROM rental_orders WHERE id=? FOR UPDATE',[req.params.id]);
                if(!order||['cancelled','expired'].includes(order.status))throw fail('Keine zahlbare Bestellung.');
                const [[source]]=await c.execute('SELECT * FROM rental_order_payments WHERE order_id=? AND order_item_id=? AND payment_type=? ORDER BY id DESC LIMIT 1 FOR UPDATE',[order.id,orderItemId,paymentType]);
                if(!(Number(source?.amount)>0))throw fail('Keine offene Nachzahlung.');
                await require('../services/invoiceSettings').requireIssuer(c);
                await releaseAdditional(c,source);
                const key='additional-transfer-'+crypto.randomUUID();
                const [row]=await c.execute("INSERT INTO rental_order_payments(order_id,order_item_id,payment_type,payment_method,payment_status,amount,external_operation_key,note) VALUES(?,?,?,'online','pending',?,?,'Überweisung über Mollie mit 14 Tagen Zahlungsziel')",[order.id,orderItemId,paymentType,source.amount,key]);
                if(source.billing_document_id)await c.execute('UPDATE rental_order_payments SET billing_document_id=? WHERE id=?',[source.billing_document_id,row.insertId]);
                await enqueueMolliePaymentCreation(c,{
                    operationKey:key,
                    payment:{id:order.id,itemId:orderItemId,type:paymentType,orderNo:order.order_no,totalAmount:Number(source.amount),method:'banktransfer',dueDate:transferDueDate(),locale:'de_DE',billingAddress:{email:order.customer_email},description:'Nachzahlung '+order.order_no,redirectUrl:process.env.BASE_URL.replace(/\/$/,'')+'/profile.html?view=orders'},
                    application:{kind:'payment_records',paymentRecordIds:[row.insertId],additionalInvoice:true}
                });
                return {operationKey:key};
            });
            try{await processEffect(result.operationKey);}catch(error){if(error.code!=='EXTERNAL_EFFECT_PENDING')throw error;}
            res.status(202).json({message:'Überweisung vorbereitet. Der Kunde erhält den Zahlungslink per E-Mail.'});
        }catch(error){failure(res,error);}
    });
    app.post('/admin/pos/payments', checkAdmin, limiter, async (req, res) => {
        try {
            const { orderId, orderItemId = null, paymentType, terminalId } = req.body;
            if (!/^\d+$/.test(String(orderId)) || !['initial_payment', 'rental_adjustment', 'return_additional_charge'].includes(paymentType) ||
                (paymentType !== 'initial_payment' && !/^\d+$/.test(String(orderItemId))) || (paymentType === 'initial_payment' && orderItemId)) throw fail('Ungültige Zahlungsdaten.', 400);
            await syncAdditional(orderId,orderItemId,paymentType);
            const terminal = await getTerminal(terminalId);
            if (terminal.status !== 'active' || terminal.currency !== 'EUR') throw fail('Dieses Terminal ist nicht für EUR-Zahlungen bereit.');
            const limits = await getPosLimits();
            const validateAmount = amount => { if (amount < limits.minimum || amount > limits.maximum) throw fail(`Mollie erlaubt für Kartenzahlungen vor Ort in diesem Zahlungsprofil Beträge von ${limits.minimum.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} bis ${limits.maximum.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}. Bitte eine andere Zahlungsart verwenden.`, 422); };
            const result = await transact(createConnection, async connection => {
                // Lock order before payment rows; terminal lock serializes competing requests on a device.
                const [[order]] = await connection.execute('SELECT * FROM rental_orders WHERE id = ? FOR UPDATE', [orderId]);
                if (!order) throw fail('Bestellung nicht gefunden.', 404);
                if (order.payment_method === 'invoice' && paymentType === 'initial_payment') throw fail('Bei Überweisung bitte die separate Kautionszahlung verwenden.');
                if (['cancelled', 'expired'].includes(order.status)) throw fail('Für diese Bestellung kann keine Zahlung gestartet werden.');
                await connection.execute('INSERT IGNORE INTO pos_terminals (terminal_id, mode) VALUES (?, ?)', [terminal.id, terminal.mode]);
                const [[device]] = await connection.execute('SELECT enabled FROM pos_terminals WHERE terminal_id = ? AND mode = ? FOR UPDATE', [terminal.id, terminal.mode]);
                if (!device.enabled) throw fail('Dieses Terminal ist in Segnitz Rental gesperrt.');
                const [payments] = await connection.execute(`SELECT * FROM rental_order_payments WHERE order_id = ? AND order_item_id <=> ? FOR UPDATE`, [orderId, orderItemId]);
                const target = payments.filter(payment => payment.payment_type === paymentType).sort((a,b) => b.id-a.id);
                const alreadyPaid = paymentType === 'initial_payment'
                    ? order.payment_status === 'paid' || target.some(payment => payment.payment_status === 'paid')
                    : ['paid', 'offset'].includes(target[0]?.payment_status);
                if (alreadyPaid) throw fail('Diese Zahlung wurde bereits abgeschlossen.');
                const active = target.find(payment => ['pending', 'open', 'authorized'].includes(payment.payment_status) && payment.pos_terminal_id);
                if (active) return { recordId: active.id, operationKey: active.external_operation_key, terminalId: active.pos_terminal_id };
                const [[busy]] = await connection.execute(`SELECT id FROM rental_order_payments WHERE pos_terminal_id = ? AND payment_status IN ('pending', 'open', 'authorized') LIMIT 1`, [terminal.id]);
                if (busy) throw fail('Auf diesem Terminal ist noch eine Zahlung offen. Bitte zuerst deren Status prüfen.');
                let amount;
                let recordIds;
                const operationKey = `pos-${crypto.randomUUID()}`;
                if (paymentType === 'initial_payment') {
                    if (order.payment_method !== 'cash' && !target.some(payment => payment.pos_terminal_id)) throw fail('Bitte den bestehenden Online-Zahlungsvorgang zuerst abschließen.');
                    const components = payments.filter(payment => ['rental', 'deposit'].includes(payment.payment_type) &&
                        ['pending', 'open', 'failed', 'cancelled', 'expired'].includes(payment.payment_status));
                    const latest = type => components.filter(payment => payment.payment_type === type).sort((a,b) => b.id-a.id)[0];
                    const rental = Number(latest('rental')?.amount || 0);
                    const deposit = Number(latest('deposit')?.amount || 0);
                    amount = Math.round((rental + deposit) * 100) / 100;
                    if (!(amount > 0)) throw fail('Keine offene Zahlung vorhanden.');
                    validateAmount(amount);
                    await connection.execute(`UPDATE rental_order_payments SET payment_status = 'cancelled' WHERE order_id = ? AND order_item_id IS NULL
                        AND payment_type IN ('initial_payment', 'rental', 'deposit') AND payment_status IN ('pending', 'open')`, [orderId]);
                    recordIds = [];
                    for (const [type, value] of [['initial_payment', amount], ['rental', rental], ['deposit', deposit]]) {
                        const [insert] = await connection.execute(`INSERT INTO rental_order_payments (order_id, payment_type, payment_method, payment_status, amount, pos_terminal_id, external_operation_key, note)
                            VALUES (?, ?, 'online', 'pending', ?, ?, ?, 'Kartenzahlung vor Ort über Mollie')`, [orderId, type, value, terminal.id, type === 'initial_payment' ? operationKey : null]);
                        recordIds.push(insert.insertId);
                    }
                    await connection.execute(`UPDATE rental_orders SET payment_method = 'online', payment_status = 'pending', reserved_until = IF(status='picked_up',NULL,DATE_ADD(NOW(), INTERVAL 15 MINUTE)), status = IF(status='picked_up','picked_up','reserved') WHERE id = ?`, [orderId]);
                } else {
                    const source = target.sort((a,b) => b.id-a.id)[0];
                    if (!source || !['pending', 'open', 'failed', 'cancelled', 'expired'].includes(source.payment_status) ||
                        !['cash','online'].includes(source.payment_method)) throw fail('Keine offene Vor-Ort-Zahlung vorhanden.');
                    amount = Number(source.amount);
                    if (!(amount > 0)) throw fail('Kein offener Betrag vorhanden.');
                    validateAmount(amount);
                    await releaseAdditional(connection, source);
                    const [insert] = await connection.execute(`INSERT INTO rental_order_payments (order_id, order_item_id, payment_type, payment_method, payment_status, amount, pos_terminal_id, external_operation_key, note)
                        VALUES (?, ?, ?, 'online', 'pending', ?, ?, ?, 'Kartenzahlung vor Ort über Mollie')`, [orderId, orderItemId, paymentType, amount, terminal.id, operationKey]);
                    if(source.billing_document_id)await connection.execute('UPDATE rental_order_payments SET billing_document_id=? WHERE id=?',[source.billing_document_id,insert.insertId]);
                    recordIds = [insert.insertId];
                }
                await enqueueMolliePaymentCreation(connection, {
                    operationKey,
                    payment: { id: Number(orderId), itemId: orderItemId, type: paymentType === 'initial_payment' ? 'order_payment' : paymentType, orderNo: order.order_no, totalAmount: amount, terminalId: terminal.id,
                        description: `Segnitz Rental ${order.order_no}`, metadata: { type: paymentType, orderId: String(orderId), itemId: orderItemId ? String(orderItemId) : null },
                        redirectUrl: `${process.env.BASE_URL}/backend.html` },
                    application: { kind: 'payment_records', ...(paymentType === 'initial_payment' ? { orderId: Number(orderId) } : {}), paymentRecordIds: recordIds }
                });
                return { recordId: recordIds[0], operationKey, terminalId: terminal.id };
            });
            try { await processEffect(result.operationKey); } catch (error) { /* Durable intent remains pending; status endpoint retries it. */ }
            res.status(202).json(result);
        } catch (error) { failure(res, error); }
    });
    app.post('/admin/pos/payments/:id/sync', checkAdmin, syncLimiter, async (req, res) => {
        let connection;
        try {
            if (!/^\d+$/.test(req.params.id)) throw fail('Ungültige Zahlung.', 400);
            connection = await createConnection();
            const read = async () => (await connection.execute('SELECT * FROM rental_order_payments WHERE id = ? AND pos_terminal_id IS NOT NULL', [req.params.id]))[0][0];
            let payment = await read();
            if (!payment) throw fail('POS-Zahlung nicht gefunden.', 404);
            if (!payment.mollie_payment_id && payment.external_operation_key && ['pending', 'open', 'authorized'].includes(payment.payment_status)) {
                try { await processEffect(payment.external_operation_key); } catch (error) {
                    const [[state]] = await connection.execute('SELECT status FROM external_effects_outbox WHERE operation_key = ?', [payment.external_operation_key]);
                    if (!state || !['pending', 'processing', 'retry', 'dead'].includes(state.status)) throw error;
                }
            }
            payment = await read();
            if (payment.mollie_payment_id) await reconcile(payment.mollie_payment_id);
            payment = await read();
            const [[effect]] = await connection.execute('SELECT result_json, last_error, status FROM external_effects_outbox WHERE operation_key = ?', [payment.external_operation_key]);
            const effectResult = typeof effect?.result_json === 'string' ? JSON.parse(effect.result_json) : effect?.result_json;
            const simulationUrl = posMode() === 'test' ? effectResult?.links?.changePaymentState?.href : null;
            res.set('Cache-Control', 'no-store').json({ message: effect?.last_error?.includes('amount is higher than the maximum') ? 'Mollie hat den Betrag abgelehnt: Er überschreitet die zulässige Höchstgrenze für dieses Zahlungsprofil.' : null, status: payment.payment_status, terminalId: payment.pos_terminal_id,
                orderId: payment.order_id, simulationUrl: simulationUrl && /^https:\/\/([a-z0-9-]+\.)*mollie\.(com|nl)\//i.test(simulationUrl) ? simulationUrl : null });
        } catch (error) { failure(res, error); } finally { if (connection) await connection.end(); }
    });
}
module.exports = { registerPosRoutes };
