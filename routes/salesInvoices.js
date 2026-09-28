'use strict';
const { syncInvoice, pickupAllowed, invoiceBalance, queueInvoice, orderLines } = require('../services/salesInvoices');
const { enqueueMolliePaymentCreation } = require('../services/externalEffectsOutbox');
const { getMolliePayment } = require('../services/mollieService');
const { getTerminal, getPosLimits, posMode } = require('../services/posService');
const {prepareInvoiceTransfer,transferDueDate}=require('../services/invoiceTransfer');
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
function registerSalesInvoiceRoutes(app, { checkAdmin, limiter, createConnection, transact, processEffect, reconcile, refreshCancelled, refundDeposits, refreshReturns }) {
    const errorResponse = (res, error) => res.status(error.statusCode || 503).json({ error: error.statusCode ? error.message : 'Der Vorgang konnte noch nicht abgeschlossen werden. Bitte erneut prüfen.' });
    const loggedIn = (req,res,next) => req.session?.user ? next() : res.status(401).json({error:'Bitte anmelden.'});
    app.get('/admin/invoices',checkAdmin,async(req,res)=>{let c;try{c=await createConnection();res.set('Cache-Control','no-store').json(await require('../services/invoiceArchive').searchArchive(c,{q:req.query.q,page:req.query.page}));}catch(e){errorResponse(res,e);}finally{if(c)await c.end();}});
    async function owned(connection, req, id, admin) {
        if (!/^\d+$/.test(String(id))) throw fail('Bestellung nicht gefunden.',404);
        const [[order]] = await connection.execute('SELECT * FROM rental_orders WHERE id = ?'+(admin ? '' : ' AND user_id = (SELECT id FROM users WHERE username = ?)'), admin ? [id] : [id,req.session.user]);
        if (!order) throw fail('Bestellung nicht gefunden.',404);
        return order;
    }
    app.get('/my-invoices',loggedIn,async(req,res)=>{let c;try{c=await createConnection();res.set('Cache-Control','no-store').json(await require('../services/invoiceArchive').searchArchive(c,{username:req.session.user,q:req.query.q,page:req.query.page}));}catch(e){errorResponse(res,e);}finally{if(c)await c.end();}});
    app.post('/admin/orders/:id/invoice/offer-transfer',checkAdmin,limiter,async(req,res)=>{
        try {
            const transfer=await transact(createConnection,async c=>{
                let order=await owned(c,req,req.params.id,true);
                [[order]]=await c.execute('SELECT * FROM rental_orders WHERE id=? FOR UPDATE',[order.id]);
                if(order.payment_method==='invoice')throw fail('Überweisung ist bereits vereinbart.');
                if(order.payment_status!=='pending'||!['confirmed','reserved','picked_up'].includes(order.status))throw fail('Nur offene Bestellungen können auf Überweisung umgestellt werden.');
                if(order.status==='reserved'&&(!order.reserved_until||new Date(order.reserved_until)<=new Date()))throw fail('Die Reservierung ist abgelaufen. Bitte Verfügbarkeit erneut prüfen.');
                const [[existing]]=await c.execute('SELECT pdf_data,provider_id FROM rental_invoices WHERE order_id=? FOR UPDATE',[order.id]);
                if((existing?.pdf_data&&!order.invoice_combined_payment)||existing?.provider_id)throw fail('Für diese Bestellung wurde bereits eine Rechnung ausgestellt.');
                const [payments]=await c.execute('SELECT * FROM rental_order_payments WHERE order_id=? FOR UPDATE',[order.id]);
                if(payments.some(p=>p.payment_status==='paid'||['open','authorized'].includes(p.payment_status)))throw fail('Bereits bezahlte oder laufende Zahlungen müssen zuerst geklärt werden.');
                for(const p of payments.filter(p=>p.payment_method==='online')) {
                    if(p.payment_type==='invoice_payment'&&p.payment_status==='replaced'){const [[refund]]=await c.execute("SELECT COALESCE(SUM(ABS(amount)),0) amount FROM rental_order_payments WHERE order_id=? AND mollie_payment_id=? AND payment_type='duplicate_payment_refund' AND payment_status NOT IN ('failed','cancelled')",[order.id,p.mollie_payment_id]);if(Number(refund.amount)>=Number(p.amount))continue;}
                    if(!p.mollie_payment_id)throw fail('Ein Online-Zahlungsauftrag ist noch nicht abschließend geklärt.');
                    const remote=await getMolliePayment(p.mollie_payment_id);
                    if(!['failed','expired','canceled'].includes(remote.status))throw fail('Die Onlinezahlung ist noch aktiv. Bitte zuerst abschließend prüfen.');
                }
                const issuer=await require('../services/invoiceSettings').requireIssuer(c);
                const lines=await orderLines(c,order.id),rent=lines.reduce((sum,l)=>sum+l.grossCents,0)/100;
                const [[total]]=await c.execute("SELECT COALESCE(SUM(deposit),0) amount FROM rental_order_items WHERE order_id=? AND item_status<>'cancelled'",[order.id]);
                await c.execute("UPDATE rental_order_payments SET payment_status='replaced' WHERE order_id=? AND payment_type IN ('initial_payment','rental','deposit') AND payment_status IN ('pending','open','authorized')",[order.id]);
                await c.execute("INSERT INTO rental_order_payments(order_id,payment_type,payment_method,payment_status,amount,recorded_by_user_id,note) VALUES(?,'initial_payment','invoice','pending',?,(SELECT id FROM users WHERE username=?),'Überweisung mit 14 Tagen Zahlungsziel')",[order.id,rent+Number(total.amount),req.session.user]);
                if(Number(total.amount)>0)await c.execute("INSERT INTO rental_order_payments(order_id,payment_type,payment_method,payment_status,amount,note) VALUES(?,'deposit','cash','pending',?,'Kautionsanteil der gemeinsamen Zahlung')",[order.id,total.amount]);
                await c.execute("UPDATE rental_orders SET payment_method='invoice',invoice_combined_payment=1,payment_status='pending',status=IF(status='picked_up','picked_up','confirmed'),reserved_until=NULL WHERE id=?",[order.id]);
                await queueInvoice(c,order.id,rent);
                await c.execute('UPDATE rental_invoices SET amount=?,due_at=?,next_attempt_at=NULL,last_error=NULL WHERE order_id=?',[rent,transferDueDate()+' 12:00:00',order.id]);
                const [[invoice]]=await c.execute('SELECT id FROM rental_invoices WHERE order_id=?',[order.id]);const payment=await prepareInvoiceTransfer(c,order,rent+Number(total.amount),transferDueDate(),{retry:true});return {invoiceId:invoice.id,...payment};
            });
            let pending=false;
            if(transfer.operationKey)try{await processEffect(transfer.operationKey);}catch(e){if(e.code!=='EXTERNAL_EFFECT_PENDING')throw e;pending=true;}
            await syncInvoice(createConnection,transfer.invoiceId);
            res.json({pending,message:pending?'Der Mollie-Überweisungsauftrag wird vorbereitet. Bitte den Status erneut prüfen.':'Überweisung vereinbart. Die Mietrechnung mit 14 Tagen Zahlungsziel wird versandt; Miete und Kaution werden gemeinsam bezahlt.'});
        }catch(e){errorResponse(res,e);}
    });
    for (const admin of [false,true]) {
        const base=admin?'/admin/orders/:id/invoice':'/my-orders/:id/invoice';
        app.get(base,admin?checkAdmin:loggedIn,async(req,res)=>{
            let c;
            try{
                c=await createConnection();const order=await owned(c,req,req.params.id,admin);
                const [[invoice]]=await c.execute('SELECT id,invoice_number AS invoiceNumber,status,amount,due_at AS dueAt,pdf_data IS NOT NULL AS hasPdf,last_error AS lastError FROM rental_invoices WHERE order_id=?',[order.id]);
                const [deposits]=await c.execute("SELECT id,amount,payment_status AS status,payment_method AS method,checkout_url AS checkoutUrl,pos_terminal_id AS terminalId FROM rental_order_payments WHERE order_id=? AND payment_type='deposit' ORDER BY id DESC",[order.id]);
                const balance=await invoiceBalance(c,order.id);
                const [documents]=await c.execute('SELECT id,document_number AS number,kind,gross_cents AS grossCents,created_at AS createdAt FROM billing_documents WHERE order_id=? ORDER BY id',[order.id]);
                if(!admin){if(invoice)delete invoice.lastError;for(const deposit of deposits)delete deposit.checkoutUrl;}
                const [bankRefunds]=admin?await c.execute("SELECT id,amount FROM rental_order_payments WHERE order_id=? AND payment_type IN ('order_cancellation_refund','deposit_refund') AND payment_method='banktransfer' AND payment_status='pending'",[order.id]):[[]];
                let simulationUrl=null;
                if(admin&&deposits[0]?.terminalId&&posMode()==='test'){
                    const [[effect]]=await c.execute('SELECT e.result_json FROM external_effects_outbox e JOIN rental_order_payments p ON p.external_operation_key=e.operation_key WHERE p.id=?',[deposits[0].id]);
                    const result=typeof effect?.result_json==='string'?JSON.parse(effect.result_json):effect?.result_json;
                    const link=result?.links?.changePaymentState?.href;
                    if(link&&/^https:\/\/([a-z0-9-]+\.)*mollie\.(com|nl)\//i.test(link))simulationUrl=link;
                }
                res.set('Cache-Control','no-store').json({paymentMethod:order.payment_method,paymentStatus:order.payment_status,invoice,balance,documents,bankRefunds,simulationUrl,canOfferTransfer:admin&&order.payment_method!=='invoice'&&order.payment_status==='pending'&&['confirmed','reserved','picked_up'].includes(order.status)&&!invoice?.hasPdf,combinedPayment:!!order.invoice_combined_payment,separateDeposit:order.payment_method==='invoice'&&!order.invoice_combined_payment,deposit:deposits[0]||null,pickupAllowed:await pickupAllowed(c,order),cancelled:['cancelled','expired'].includes(order.status)});
            }catch(e){errorResponse(res,e);}finally{if(c)await c.end();}
        });
        app.get(base+'/documents/:documentId/xml',admin?checkAdmin:loggedIn,async(req,res)=>{let c;try{c=await createConnection();const order=await owned(c,req,req.params.id,admin);const [[d]]=await c.execute('SELECT document_number,xml_data FROM billing_documents WHERE id=? AND order_id=?',[req.params.documentId,order.id]);if(!d?.xml_data)throw fail('Keine strukturierte E-Rechnung vorhanden.',404);res.set('Cache-Control','no-store').type('application/xml').set('Content-Disposition','attachment; filename="'+d.document_number+'.xml"').send(d.xml_data);}catch(e){errorResponse(res,e);}finally{if(c)await c.end();}});
        app.get(base+'/documents/:documentId/pdf',admin?checkAdmin:loggedIn,async(req,res)=>{let c;try{c=await createConnection();const order=await owned(c,req,req.params.id,admin);const [[d]]=await c.execute('SELECT document_number,pdf_data FROM billing_documents WHERE id=? AND order_id=?',[req.params.documentId,order.id]);if(!d)throw fail('Dokument nicht gefunden.',404);res.set('Cache-Control','no-store').type('pdf').set('Content-Disposition','attachment; filename="'+d.document_number+'.pdf"').send(d.pdf_data);}catch(e){errorResponse(res,e);}finally{if(c)await c.end();}});
        if(admin)app.post(base+'/bank-transfer',checkAdmin,limiter,(req,res)=>res.status(409).json({error:'Überweisungen und Erstattungen werden ausschließlich durch Mollie bestätigt. Manuelle Bankbuchungen sind nicht möglich.'}));
        if(admin)app.post(base+'/pay',checkAdmin,limiter,async(req,res)=>{try{
            const method=req.body.method;if(!['online','banktransfer'].includes(method))throw fail('Ungültige Zahlungsart.',400);
            const result=await transact(createConnection,async c=>{
                let order=await owned(c,req,req.params.id,admin);[[order]]=await c.execute('SELECT * FROM rental_orders WHERE id=? FOR UPDATE',[order.id]);
                if(order.payment_method!=='invoice'||['cancelled','expired'].includes(order.status))throw fail('Keine offene Mietrechnung.');
                if(order.invoice_combined_payment){const balance=await invoiceBalance(c,order.id);if(balance.openCents<=0)throw fail('Rechnung bereits bezahlt.');const result=await prepareInvoiceTransfer(c,order,balance.openCents/100,transferDueDate(),{retry:true});if(!result)throw fail('Bestehende Mollie-Zahlung zuerst abschließend prüfen.');return result;}
                const [[invoice]]=await c.execute('SELECT pdf_data FROM rental_invoices WHERE order_id=?',[order.id]);if(!invoice?.pdf_data)throw fail('Rechnung noch nicht ausgestellt.');
                const balance=await invoiceBalance(c,order.id);if(balance.openCents<=0)throw fail('Rechnung bereits bezahlt.');
                const [[previous]]=await c.execute("SELECT * FROM rental_order_payments WHERE order_id=? AND payment_type='invoice_payment' ORDER BY id DESC LIMIT 1 FOR UPDATE",[order.id]);
                if(previous&&['pending','open','authorized'].includes(previous.payment_status))return {checkoutUrl:previous.checkout_url,pending:true};
                if(previous&&!previous.mollie_payment_id)throw fail('Letzter Zahlungsauftrag noch nicht eindeutig geklärt.');
                if(previous){const remote=await getMolliePayment(previous.mollie_payment_id);if(!['failed','expired','canceled'].includes(remote.status))throw fail('Bitte zuerst den Zahlungsstatus aktualisieren.');}
                const key='invoice-payment-'+order.id+'-'+(previous?.id||0);
                const [r]=await c.execute("INSERT INTO rental_order_payments(order_id,payment_type,payment_method,payment_status,amount,external_operation_key) VALUES(?,'invoice_payment','online','pending',?,?)",[order.id,balance.openCents/100,key]);
                await enqueueMolliePaymentCreation(c,{operationKey:key,payment:{id:order.id,orderNo:order.order_no,totalAmount:balance.openCents/100,type:'invoice_payment',description:'Mietrechnung '+order.order_no,redirectUrl:process.env.BASE_URL.replace(/\/$/,'')+'/profile.html?view=invoices',...(method==='banktransfer'?{method:'banktransfer'}:{})},application:{kind:'payment_records',paymentRecordIds:[r.insertId]}});return {operationKey:key};
            });if(result.operationKey)try{Object.assign(result,await processEffect(result.operationKey));}catch{result.pending=true;}res.json(result);
        }catch(e){errorResponse(res,e);}});
        app.get(base+'/pdf',admin?checkAdmin:loggedIn,async(req,res)=>{
            let c;try{c=await createConnection();const order=await owned(c,req,req.params.id,admin);
                const [[invoice]]=await c.execute('SELECT pdf_data FROM rental_invoices WHERE order_id=?',[order.id]);
                if(!invoice?.pdf_data)throw fail('Die Rechnung wird noch bereitgestellt.',409);
                res.set('Cache-Control','no-store').type('pdf').set('Content-Disposition',`attachment; filename="Rechnung-${order.order_no.replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf"`).send(invoice.pdf_data);
            }catch(e){errorResponse(res,e);}finally{if(c)await c.end();}
        });
        if(admin)app.post(base+'/sync',checkAdmin,limiter,async(req,res)=>{
            let c;try{c=await createConnection();const order=await owned(c,req,req.params.id,admin);
                const [[invoice]]=await c.execute('SELECT id FROM rental_invoices WHERE order_id=?',[order.id]);
                const [payments]=await c.execute("SELECT DISTINCT mollie_payment_id FROM rental_order_payments WHERE order_id=? AND payment_type IN ('deposit','invoice_payment') AND mollie_payment_id IS NOT NULL AND payment_status IN ('pending','open','authorized','cancelled','expired','failed')",[order.id]);
                await c.end();c=null;
                for(const p of payments)await reconcile(p.mollie_payment_id);
                if(invoice)await syncInvoice(createConnection,invoice.id);
                res.json({message:'Status aktualisiert.'});
            }catch(e){errorResponse(res,e);}finally{if(c)await c.end();}
        });
        if(admin)app.post(base+'/deposit',checkAdmin,limiter,async(req,res)=>{
            try{
                const method=req.body.method;
                if(!(admin?['cash','online','banktransfer','pos']:['online','banktransfer']).includes(method))throw fail('Ungültige Zahlungsart.',400);
                const result=await transact(createConnection,async c=>{
                    let order=await owned(c,req,req.params.id,admin);
                    [[order]]=await c.execute('SELECT * FROM rental_orders WHERE id=? FOR UPDATE',[order.id]);
                    if(order.payment_method!=='invoice'||order.invoice_combined_payment||['cancelled','expired'].includes(order.status))throw fail('Miete und Kaution werden gemeinsam bezahlt.');
                    const [[deposit]]=await c.execute("SELECT * FROM rental_order_payments WHERE order_id=? AND payment_type='deposit' ORDER BY id DESC LIMIT 1 FOR UPDATE",[order.id]);
                    if(!deposit||Number(deposit.amount)<=0||deposit.payment_status==='paid')throw fail('Die Kaution ist bereits beglichen.');
                    if(deposit.payment_method==='online'&&['pending','open','authorized'].includes(deposit.payment_status))return {operationKey:deposit.external_operation_key,checkoutUrl:deposit.checkout_url,pending:true};
                    if(deposit.payment_method==='online'&&!deposit.mollie_payment_id)throw fail('Der letzte Zahlungsauftrag ist noch nicht eindeutig geklärt. Eine zusätzliche Zahlung ist gesperrt.');
                    if(deposit.mollie_payment_id){const provider=await getMolliePayment(deposit.mollie_payment_id);if(!['failed','canceled','expired'].includes(provider.status))throw fail('Die bestehende Zahlung muss zuerst abschließend geprüft werden.');}
                    await c.execute("UPDATE rental_order_payments SET payment_status='cancelled' WHERE id=?",[deposit.id]);
                    const key=`deposit-${order.id}-${deposit.id}`;
                    let terminal=null;
                    if(method==='pos'){
                        terminal=await getTerminal(req.body.terminalId);const limits=await getPosLimits();
                        if(terminal.status!=='active'||Number(deposit.amount)>limits.maximum||Number(deposit.amount)<limits.minimum)throw fail('Terminal oder Betrag ist für diese Zahlung nicht freigegeben.');
                        await c.execute('INSERT IGNORE INTO pos_terminals (terminal_id,mode) VALUES (?,?)',[terminal.id,terminal.mode]);
                        const [[device]]=await c.execute('SELECT enabled FROM pos_terminals WHERE terminal_id=? AND mode=? FOR UPDATE',[terminal.id,terminal.mode]);
                        const [[busy]]=await c.execute("SELECT id FROM rental_order_payments WHERE pos_terminal_id=? AND payment_status IN ('pending','open','authorized') LIMIT 1",[terminal.id]);
                        if(!device.enabled||busy)throw fail('Terminal ist gesperrt oder noch belegt.');
                    }
                    const [insert]=await c.execute(`INSERT INTO rental_order_payments (order_id,payment_type,payment_method,payment_status,amount,external_operation_key,pos_terminal_id,paid_at,note)
                        VALUES (?,'deposit',?,?,?, ?,?,${method==='cash'?'NOW()':'NULL'},'Separate Kautionszahlung')`,[order.id,method==='cash'?'cash':'online',method==='cash'?'paid':'pending',deposit.amount,key,terminal?.id||null]);
                    if(method==='cash'){
                        await c.execute('UPDATE rental_order_payments SET recorded_by_user_id=(SELECT id FROM users WHERE username=?) WHERE id=?',[req.session.user,insert.insertId]);
                        await require('../services/mailService').sendGraphMail({to:order.customer_email,subject:`Kaution erhalten – ${order.order_no}`,text:`Wir haben Ihre Kaution von ${Number(deposit.amount).toFixed(2)} EUR in bar erhalten. Die Mietrechnung bleibt davon unabhängig.`,receipt:await require('../services/receiptService').captureReceipt(c,order.id,'order')},{connection:c,operationKey:`mail-deposit-cash-${insert.insertId}`});
                    }
                    if(method!=='cash')await enqueueMolliePaymentCreation(c,{operationKey:key,payment:{id:order.id,orderNo:order.order_no,totalAmount:Number(deposit.amount),type:'deposit',description:`Kaution ${order.order_no}`,redirectUrl:`${process.env.BASE_URL.replace(/\/$/,'')}/profile.html?view=invoices`,...(method==='banktransfer'?{method:'banktransfer'}:{}),...(terminal?{terminalId:terminal.id}:{})},application:{kind:'payment_records',paymentRecordIds:[insert.insertId]}});
                    return {operationKey:method==='cash'?null:key,message:method==='cash'?'Kaution bezahlt.':'Kautionszahlung wird vorbereitet.'};
                });
                if(result.operationKey&&!result.pending){try{Object.assign(result,await processEffect(result.operationKey));}catch{result.pending=true;}}
                res.json(result);
            }catch(e){errorResponse(res,e);}
        });
    }
}
module.exports={registerSalesInvoiceRoutes};
