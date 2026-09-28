'use strict';
const crypto=require('node:crypto');
const {requireIssuer}=require('./invoiceSettings');
const {renderInvoicePdf}=require('./invoicePdf');
const {sendGraphMail}=require('./mailService');
const {captureReceipt,iso}=require('./receiptService');
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const {prepareInvoiceTransfer,transferInstructions,transferDueDate}=require('./invoiceTransfer');
const cents=v=>Math.round(Number(v)*100);
async function queueInvoice(c,orderId,amount){if(!Number.isSafeInteger(cents(amount))||cents(amount)<0)throw Error('Ungültiger Rechnungsbetrag');await c.execute('INSERT IGNORE INTO rental_invoices(order_id,mode,amount,operation_key) VALUES(?,?,?,?)',[orderId,'local',amount,crypto.randomUUID()]);}
async function depositPaid(c,id){const [[r]]=await c.execute(`SELECT COALESCE((SELECT SUM(deposit) FROM rental_order_items WHERE order_id=? AND item_status<>'cancelled'),0) required_amount,COALESCE((SELECT SUM(amount) FROM rental_order_payments WHERE order_id=? AND payment_type='deposit' AND payment_status='paid'),0) paid_amount`,[id,id]);return cents(r.paid_amount)>=cents(r.required_amount);}
async function pickupAllowed(c,o){if(o.payment_status==='charged_back')return false;if(o.payment_method!=='invoice')return o.payment_status==='paid';const [[r]]=await c.execute('SELECT pdf_data IS NOT NULL AS ready FROM rental_invoices WHERE order_id=?',[o.id||o.order_id]);const [[order]]=await c.execute('SELECT invoice_combined_payment FROM rental_orders WHERE id=?',[o.id||o.order_id]);return !!r?.ready&&(!!order.invoice_combined_payment||await depositPaid(c,o.id||o.order_id));}
async function nextNumber(c,kind,date){const year=new Intl.DateTimeFormat('en',{year:'numeric',timeZone:process.env.BUSINESS_TIME_ZONE||'Europe/Berlin'}).format(new Date(date)),series=(kind==='credit'?'RK':'RE')+'-'+year;await c.execute('INSERT IGNORE INTO billing_sequences(series,next_number) VALUES(?,1)',[series]);const [[r]]=await c.execute('SELECT next_number FROM billing_sequences WHERE series=? FOR UPDATE',[series]);await c.execute('UPDATE billing_sequences SET next_number=next_number+1 WHERE series=?',[series]);return series+'-'+String(r.next_number).padStart(6,'0');}
async function storeDocument(c,invoice,order,snapshot,key,original=null,itemId=null){
 const [[existing]]=await c.execute('SELECT * FROM billing_documents WHERE operation_key=?',[key]);if(existing)return existing;
 snapshot.number=await nextNumber(c,snapshot.kind,snapshot.issuedAt);
 const xml=snapshot.buyer?Buffer.from(require('./eInvoice').renderInvoiceXml(snapshot),'utf8'):null;
 const pdf=await renderInvoicePdf(snapshot);const gross=snapshot.lines.reduce((n,l)=>n+l.grossCents,0);
 const [r]=await c.execute(`INSERT INTO billing_documents(order_id,invoice_id,kind,operation_key,document_number,original_document_id,order_item_id,gross_cents,snapshot_json,pdf_data,pdf_sha256,xml_data,xml_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[order.id,invoice.id,snapshot.kind,key,snapshot.number,original,itemId,gross,JSON.stringify(snapshot),pdf,crypto.createHash('sha256').update(pdf).digest('hex'),xml,xml?crypto.createHash('sha256').update(xml).digest('hex'):null]);
 await sendGraphMail({...(snapshot.kind==='invoice'&&!snapshot.paidAt&&snapshot.bankTransfer?.checkoutUrl?{paymentUrl:snapshot.bankTransfer.checkoutUrl}:{}),to:order.customer_email,subject:(snapshot.kind==='credit'?'Ihre Rechnungskorrektur':'Ihre Rechnung')+' – '+snapshot.number,text:'Zur Bestellung '+order.order_no+' erhalten Sie das Dokument im Anhang. Es steht auch unter Meine Rechnungen bereit.',...(xml?{invoiceXml:{name:snapshot.number+'.xml',contentBytes:xml.toString('base64')}}:{}),invoicePdf:{name:snapshot.number+'.pdf',contentBytes:pdf.toString('base64')}},{connection:c,operationKey:'mail-billing-document-'+r.insertId});
 return {id:r.insertId,document_number:snapshot.number,pdf_data:pdf,snapshot_json:snapshot,gross_cents:gross};
}
async function orderLines(c,orderId){const [items]=await c.execute(`SELECT i.*,p.title FROM rental_order_items i JOIN rental_products p ON p.id=i.product_id WHERE i.order_id=? AND i.item_status<>'cancelled' ORDER BY i.id`,[orderId]);return items.map(i=>{const start=iso(i.rental_start).slice(0,10),end=iso(i.rental_end).slice(0,10),days=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;return {itemId:i.id,description:i.title,period:start+' bis '+end,quantity:days,vatRate:19,grossCents:Math.max(0,days*cents(i.price_per_day)-cents(i.discount_amount||0)),discountCents:cents(i.discount_amount||0)};});}
async function invoiceBalance(c,orderId){
 const [[r]]=await c.execute(`SELECT
 COALESCE((SELECT SUM(gross_cents) FROM billing_documents WHERE order_id=? AND kind IN ('invoice','credit') AND JSON_EXTRACT(snapshot_json,'$.scope') IS NULL),0) due,
 COALESCE((SELECT SUM(amount) FROM rental_order_payments WHERE order_id=? AND payment_type IN ('invoice_payment','initial_payment') AND payment_status='paid'),0) received`,[orderId,orderId]);
 const [[order]]=await c.execute('SELECT invoice_combined_payment FROM rental_orders WHERE id=?',[orderId]);
 const [[deposit]]=await c.execute("SELECT COALESCE(SUM(deposit),0) amount FROM rental_order_items WHERE order_id=? AND item_status<>'cancelled'",[orderId]);
 const [[documents]]=await c.execute("SELECT COUNT(*) n FROM billing_documents WHERE order_id=? AND JSON_EXTRACT(snapshot_json,'$.scope') IS NULL",[orderId]);
 const [[currentInvoice]]=await c.execute('SELECT pdf_data IS NOT NULL ready FROM rental_invoices WHERE order_id=?',[orderId]);
 const rent=Number(documents.n)&&currentInvoice?.ready?Number(r.due):(await orderLines(c,orderId)).reduce((sum,line)=>sum+line.grossCents,0);
 const due=rent+(order?.invoice_combined_payment?cents(deposit.amount):0);
 return {rentCents:rent,depositCents:order?.invoice_combined_payment?cents(deposit.amount):0,dueCents:due,paidCents:cents(r.received),openCents:Math.max(0,due-cents(r.received))};
}
async function projectInvoicePaymentStatus(c,orderId){
 const [[order]]=await c.execute('SELECT * FROM rental_orders WHERE id=? FOR UPDATE',[orderId]);
 if(!order||order.payment_method!=='invoice'||!order.invoice_combined_payment||['cancelled','expired'].includes(order.status)||order.payment_status==='charged_back')return;
 const balance=await invoiceBalance(c,orderId);
 const [[latest]]=await c.execute("SELECT payment_status,mollie_payment_id,amount FROM rental_order_payments WHERE order_id=? AND payment_type='invoice_payment' ORDER BY id DESC LIMIT 1",[orderId]);
 if(latest?.payment_status==='cancelled'&&latest.mollie_payment_id&&balance.paidCents===0&&balance.openCents>0&&cents(latest.amount)===balance.openCents){
  const [[returned]]=await c.execute("SELECT id FROM rental_order_items WHERE order_id=? AND (item_status LIKE 'returned_%' OR actual_return_date IS NOT NULL) LIMIT 1",[orderId]);
  const [[other]]=await c.execute("SELECT id FROM rental_order_payments WHERE order_id=? AND payment_method='online' AND payment_status IN ('pending','open','authorized','paid') AND payment_type IN ('initial_payment','rental','deposit','invoice_payment') LIMIT 1",[orderId]);
  if(!returned&&!other&&(await require('./mollieService').getMolliePayment(latest.mollie_payment_id)).status==='canceled'){
   await cancelInvoice(c,orderId,null,'Stornierung der unbezahlten Rechnung nach Abbruch der Mollie-Überweisung.');
   await c.execute("UPDATE rental_invoices SET pdf_data=NULL,invoice_number=NULL,request_json=NULL,status='queued',next_attempt_at=NULL,due_at=NULL WHERE order_id=?",[orderId]);
   await c.execute("UPDATE rental_order_payments SET payment_status='replaced' WHERE order_id=? AND payment_type IN ('initial_payment','rental','deposit') AND payment_status IN ('pending','open')",[orderId]);
   for(const [type,amount] of [['rental',balance.rentCents],['deposit',balance.depositCents]])if(amount>0)await c.execute("INSERT INTO rental_order_payments(order_id,payment_type,payment_method,payment_status,amount,note) VALUES(?,?,'cash','pending',?,'Zahlungswahl nach stornierter Mollie-Überweisung wieder freigegeben')",[orderId,type,amount/100]);
   await c.execute("UPDATE rental_orders SET payment_method='cash',payment_status='pending',mollie_payment_id=NULL,mollie_payment_status=NULL,mollie_payment_method=NULL WHERE id=?",[orderId]);return;
  }
 }
 const status=balance.openCents===0&&await depositPaid(c,orderId)?'paid':['failed','cancelled','expired'].includes(latest?.payment_status)?latest.payment_status:'pending';
 await c.execute('UPDATE rental_orders SET payment_status=? WHERE id=?',[status,orderId]);
}
async function syncInvoice(createConnection,id){
 const c=await createConnection();try{
  const [[lookup]]=await c.execute('SELECT order_id FROM rental_invoices WHERE id=?',[id]);if(!lookup)return;
  await c.beginTransaction();const [[order]]=await c.execute('SELECT * FROM rental_orders WHERE id=? FOR UPDATE',[lookup.order_id]);const [[row]]=await c.execute('SELECT * FROM rental_invoices WHERE id=? FOR UPDATE',[id]);
  // Historical provider documents remain archived; never issue the same invoice twice.
  if(row.provider_id){await c.commit();return;}
  if(!row.pdf_data){
   if(['cancelled','expired'].includes(order.status)){await c.execute("UPDATE rental_invoices SET status='cancelled' WHERE id=?",[id]);await c.commit();return;}
   if(order.payment_method!=='invoice'&&order.payment_status!=='paid'){await c.commit();return;}
   const issuer=await requireIssuer(c),lines=await orderLines(c,order.id),issuedAt=new Date().toISOString(),dueAt=(row.due_at?new Date(row.due_at):new Date(transferDueDate()+'T12:00:00Z')).toISOString();
   const [[deposit]]=await c.execute("SELECT COALESCE(SUM(deposit),0) amount FROM rental_order_items WHERE order_id=? AND item_status<>'cancelled'",[order.id]);
   const bankTransfer=order.payment_method==='invoice'&&order.invoice_combined_payment?await transferInstructions(c,order.id):null;
   if(order.payment_method==='invoice'&&order.invoice_combined_payment&&!bankTransfer){await c.commit();return;}
   const snapshot={bankTransfer,buyer:{name:order.customer_company||order.customer_first_name+' '+order.customer_last_name,address:order.customer_address,postalCode:order.customer_zip,city:order.customer_city},depositCents:cents(deposit.amount),combinedPayment:!!order.invoice_combined_payment,kind:'invoice',issuer,orderNo:order.order_no,issuedAt,dueAt,paidAt:order.payment_method!=='invoice'?issuedAt:null,customer:[order.customer_company,order.customer_first_name+' '+order.customer_last_name,order.customer_address,order.customer_zip+' '+order.customer_city].filter(Boolean),signature:order.signature_data_url,lines};
   const [[generation]]=await c.execute("SELECT COUNT(*) n FROM billing_documents WHERE order_id=? AND kind='invoice' AND JSON_EXTRACT(snapshot_json,'$.scope') IS NULL",[order.id]);
   const document=await storeDocument(c,row,order,snapshot,'invoice-order-'+order.id+(Number(generation.n)?'-'+generation.n:''));
   await c.execute('UPDATE rental_invoices SET mode=\'local\',invoice_number=?,pdf_data=?,request_json=?,amount=?,due_at=?,last_error=NULL WHERE id=?',[document.document_number,document.pdf_data,JSON.stringify(snapshot),document.gross_cents/100,new Date(dueAt),id]);row.pdf_data=document.pdf_data;
  }
  if(order.payment_method==='invoice')await c.execute("UPDATE rental_order_payments SET payment_status='replaced' WHERE order_id=? AND payment_type='initial_payment' AND payment_method='invoice' AND payment_status='pending'",[order.id]);
  const balance=await invoiceBalance(c,order.id);
  const [[transferExists]]=await c.execute("SELECT id FROM rental_order_payments WHERE order_id=? AND payment_type='invoice_payment' AND external_operation_key LIKE 'invoice-transfer-%' LIMIT 1",[order.id]);
  if(transferExists&&order.payment_method==='invoice'&&order.invoice_combined_payment&&!['cancelled','expired'].includes(order.status)&&balance.openCents>0)await prepareInvoiceTransfer(c,order,balance.openCents/100,(row.due_at?new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.due_at)):transferDueDate()));
  const paid=order.payment_method==='invoice'?balance.openCents===0:order.payment_status==='paid';
  const status=['cancelled','expired'].includes(order.status)?'cancelled':paid?'paid':row.due_at&&new Date(row.due_at)<new Date()?'overdue':'issued';
  await c.execute('UPDATE rental_invoices SET status=?,last_error=NULL,next_attempt_at=DATE_ADD(NOW(),INTERVAL 60 SECOND) WHERE id=?',[status,id]);
  if(order.payment_method==='invoice'&&!['cancelled','expired'].includes(order.status)&&order.payment_status!=='charged_back')await c.execute('UPDATE rental_orders SET payment_status=? WHERE id=?',[paid&&await depositPaid(c,order.id)?'paid':'pending',order.id]);
  await projectInvoicePaymentStatus(c,order.id);
  const [[structured]]=await c.execute("SELECT xml_data FROM billing_documents WHERE invoice_id=? AND kind='invoice' AND JSON_EXTRACT(snapshot_json,'$.scope') IS NULL LIMIT 1",[id]);
  if(paid&&(order.payment_method==='invoice'||order.invoice_combined_payment)&&row.pdf_data&&balance.dueCents>0){await sendGraphMail({to:order.customer_email,subject:'Rechnung bezahlt – '+order.order_no,text:'Vielen Dank. Der Zahlungseingang wurde bestätigt.',...(structured?.xml_data?{invoiceXml:{name:(row.invoice_number||order.order_no)+'.xml',contentBytes:structured.xml_data.toString('base64')}}:{}),invoicePdf:{name:(row.invoice_number||order.order_no)+'.pdf',contentBytes:row.pdf_data.toString('base64')},receipt:await captureReceipt(c,order.id,'order')},{connection:c,operationKey:'mail-local-invoice-paid-'+id});}
  await c.commit();
 }catch(e){await c.rollback();await c.execute('UPDATE rental_invoices SET last_error=?,next_attempt_at=DATE_ADD(NOW(),INTERVAL 5 MINUTE) WHERE id=?',[String(e.message).slice(0,500),id]);throw e;}finally{await c.end();}
}
async function cancelInvoice(c,orderId,item,reason=null){
 const [[row]]=await c.execute('SELECT * FROM rental_invoices WHERE order_id=? FOR UPDATE',[orderId]);if(!row)return;
 const [[billingOrder]]=await c.execute('SELECT payment_method,invoice_combined_payment FROM rental_orders WHERE id=?',[orderId]);
 if(item&&billingOrder.payment_method==='invoice'){
  const [[pending]]=await c.execute("SELECT id FROM rental_order_payments WHERE order_id=? AND payment_type IN ('invoice_payment','deposit') AND payment_method='online' AND payment_status IN ('pending','open','authorized') LIMIT 1",[orderId]);
  if(pending&&!billingOrder.invoice_combined_payment)throw Object.assign(new Error('Bitte die laufende Miet- oder Kautionszahlung zuerst abschließend prüfen. Danach ist die Teilstornierung möglich.'),{statusCode:409});
  await c.execute("UPDATE rental_order_payments SET amount=GREATEST(amount-?,0) WHERE order_id=? AND payment_type='deposit' AND payment_method='cash' AND payment_status='pending' AND mollie_payment_id IS NULL",[item.deposit,orderId]);
 }
 if(row.provider_id)throw Object.assign(new Error('Dieser historische externe Beleg muss vor einer Korrektur in die lokale Buchhaltung übernommen werden.'),{statusCode:409});
 const [[creditOrder]]=await c.execute('SELECT * FROM rental_orders WHERE id=?',[orderId]);
 const [extras]=await c.execute("SELECT * FROM billing_documents WHERE order_id=? AND kind='invoice' AND JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.scope'))='additional'",[orderId]);
 if(!reason)for(const extra of extras){
  if(item&&Number(extra.order_item_id)!==Number(item.id))continue;
  const [[exists]]=await c.execute("SELECT id FROM billing_documents WHERE original_document_id=? AND kind='credit' LIMIT 1",[extra.id]);if(exists)continue;
  const source=parse(extra.snapshot_json);
  const correction={...source,kind:'credit',number:null,originalNumber:source.number,originalDate:source.issuedAt,issuedAt:new Date().toISOString(),description:'Stornierung – '+(source.description||'Nachrechnung'),reason:'Stornierung der Nachrechnung zur stornierten Mietposition.',lines:source.lines.map(line=>({...line,grossCents:-Math.abs(line.grossCents)}))};
  await storeDocument(c,row,creditOrder,correction,'credit-additional-'+extra.id,extra.id,extra.order_item_id);
 }
 const [[original]]=await c.execute("SELECT * FROM billing_documents WHERE invoice_id=? AND kind='invoice' AND JSON_EXTRACT(snapshot_json,'$.scope') IS NULL ORDER BY id DESC LIMIT 1",[row.id]);
 if(!original){const lines=await orderLines(c,orderId);await c.execute('UPDATE rental_invoices SET amount=? WHERE id=?',[lines.reduce((n,l)=>n+l.grossCents,0)/100,row.id]);return;}
 const [[order]]=await c.execute('SELECT * FROM rental_orders WHERE id=?',[orderId]);
 const source=parse(original.snapshot_json),[credits]=await c.execute("SELECT snapshot_json FROM billing_documents WHERE original_document_id=? AND kind='credit'",[original.id]);
 const credited=new Map();for(const credit of credits)for(const l of parse(credit.snapshot_json).lines)credited.set(l.itemId,(credited.get(l.itemId)||0)-l.grossCents);
 const lines=source.lines.filter(l=>!item||Number(l.itemId)===Number(item.id)).map(l=>({...l,grossCents:-Math.max(0,l.grossCents-(credited.get(l.itemId)||0)),discountCents:0})).filter(l=>l.grossCents<0);
 if(!lines.length)return;
 const snapshot={...source,kind:'credit',number:null,originalNumber:source.number,originalDate:source.issuedAt,issuedAt:new Date().toISOString(),reason:reason||(item?'Teilstornierung der angegebenen Mietposition.':'Stornierung der noch nicht berichtigten Mietpositionen.'),lines};
 await storeDocument(c,row,order,snapshot,'credit-cancellation-'+orderId+'-'+original.id+'-'+(item?.id||'all'),original.id,item?.id||null);
 await c.execute('UPDATE rental_invoices SET next_attempt_at=NULL WHERE id=?',[row.id]);
}
async function createAdditionalInvoice(c,paymentId,result,period=null){
 const [[payment]]=await c.execute('SELECT * FROM rental_order_payments WHERE id=? FOR UPDATE',[paymentId]);
 const [[order]]=await c.execute('SELECT * FROM rental_orders WHERE id=? FOR UPDATE',[payment.order_id]);
 if(payment.billing_document_id){
  const [[doc]]=await c.execute('SELECT * FROM billing_documents WHERE id=?',[payment.billing_document_id]);
  await sendGraphMail({to:order.customer_email,subject:'Aktualisierter Zahlungslink – '+doc.document_number,paymentUrl:result.checkoutUrl,text:'Für diese Rechnung steht ein neuer Mollie-Zahlungslink bereit. Das ursprüngliche Zahlungsziel bleibt bestehen.',invoicePdf:{name:doc.document_number+'.pdf',contentBytes:doc.pdf_data.toString('base64')}},{connection:c,operationKey:'mail-invoice-link-'+payment.id});return;
 }
 const issuer=await requireIssuer(c);
 await queueInvoice(c,order.id,0);
 const [[invoice]]=await c.execute('SELECT * FROM rental_invoices WHERE order_id=? FOR UPDATE',[order.id]);
 const [[item]]=await c.execute('SELECT i.*,p.title FROM rental_order_items i JOIN rental_products p ON p.id=i.product_id WHERE i.id=? AND i.order_id=?',[payment.order_item_id,order.id]);
 const issuedAt=new Date().toISOString(),dueAt=transferDueDate()+'T12:00:00Z';
 const label=payment.payment_type==='rental_adjustment'?'Mietzeitraum-Verlängerung':'Nachzahlung zur Rückgabe';
 const snapshot={scope:'additional',description:label+' – '+item.title,paymentRecordId:payment.id,kind:'invoice',issuer,orderNo:order.order_no,issuedAt,dueAt,paidAt:null,depositCents:0,signature:order.signature_data_url,
  bankTransfer:{...result.details,checkoutUrl:require('./invoiceTransfer').safeMolliePaymentLink(result.links?.payOnline?.href)||require('./invoiceTransfer').safeMolliePaymentLink(result.checkoutUrl)},
  buyer:{name:order.customer_company||order.customer_first_name+' '+order.customer_last_name,address:order.customer_address,postalCode:order.customer_zip,city:order.customer_city},
  customer:[order.customer_company,order.customer_first_name+' '+order.customer_last_name,order.customer_address,order.customer_zip+' '+order.customer_city].filter(Boolean),
  lines:[{itemId:item.id,description:label+' – '+item.title,period:period?period.start+' bis '+period.end:iso(item.adjusted_rental_start||item.rental_start).slice(0,10)+' bis '+iso(item.adjusted_rental_end||item.rental_end).slice(0,10),quantity:1,vatRate:19,grossCents:cents(payment.amount)}]};
 const doc=await storeDocument(c,invoice,order,snapshot,'invoice-additional-'+payment.id,null,item.id);
 await c.execute('UPDATE rental_order_payments SET billing_document_id=? WHERE id=?',[doc.id,payment.id]);
}
function startInvoiceWorker(createConnection){if(process.env.DISABLE_PERIODIC_CLEANUP==='1')return {stop(){}};let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;let c;try{c=await createConnection();const [rows]=await c.execute("SELECT i.id FROM rental_invoices i JOIN rental_orders o ON o.id=i.order_id WHERE i.provider_id IS NULL AND i.status<>'cancelled' AND o.status NOT IN ('cancelled','expired') AND ((i.pdf_data IS NULL AND (o.payment_method='invoice' OR o.payment_status='paid')) OR (i.pdf_data IS NOT NULL AND (o.payment_method='invoice' OR o.invoice_combined_payment=1) AND (i.status IN ('issued','overdue','pending-payment') OR o.payment_status='pending'))) AND (i.next_attempt_at IS NULL OR i.next_attempt_at<=NOW()) ORDER BY COALESCE(i.next_attempt_at,i.created_at) LIMIT 10");await c.end();c=null;for(const row of rows)try{await syncInvoice(createConnection,row.id);}catch(e){console.error('Rechnungserstellung:',e.message);}}catch(e){console.error('Rechnungsworker:',e.message);}finally{if(c)await c.end();busy=false;}},15000);timer.unref();return {stop(){clearInterval(timer);}};}
module.exports={createAdditionalInvoice,projectInvoicePaymentStatus,queueInvoice,depositPaid,pickupAllowed,syncInvoice,startInvoiceWorker,cancelInvoice,invoiceBalance,orderLines};
