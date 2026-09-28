'use strict';
const {enqueueMolliePaymentCreation}=require('./externalEffectsOutbox');
const {getMolliePayment}=require('./mollieService');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
function safeMolliePaymentLink(value) {
 try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(['mollie.com','mollie.nl'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host))||(process.env.MOLLIE_TEST_MODE==='1'&&url.hostname==='checkout.test.mollie.local'))?url.href:null;}catch{return null;}
}
function transferDueDate(date=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
 const due=new Date(parts+'T12:00:00Z');due.setUTCDate(due.getUTCDate()+14);return due.toISOString().slice(0,10);
}
async function prepareInvoiceTransfer(c,order,amount,dueDate,{retry=false}={}) {
 const [[previous]]=await c.execute("SELECT * FROM rental_order_payments WHERE order_id=? AND payment_type='invoice_payment' ORDER BY id DESC FOR UPDATE",[order.id]);
 if(previous) {
  if(['pending','open','authorized','paid'].includes(previous.payment_status))return {operationKey:previous.external_operation_key};
  if(!previous.mollie_payment_id)return null;
  const remote=await getMolliePayment(previous.mollie_payment_id);
  if(!['failed','expired','canceled'].includes(remote.status))return null;
  if(!retry&&Math.round(Number(previous.amount)*100)===Math.round(amount*100))return null;
 }
 if(!(amount>0))return null;
 const key='invoice-transfer-'+order.id+'-'+(previous?.id||0);
 const [row]=await c.execute("INSERT INTO rental_order_payments(order_id,payment_type,payment_method,payment_status,amount,external_operation_key,note) VALUES(?,'invoice_payment','online','pending',?,?,'Überweisung über Mollie: Miete und Kaution gemeinsam')",[order.id,amount,key]);
 await enqueueMolliePaymentCreation(c,{operationKey:key,payment:{id:order.id,orderNo:order.order_no,totalAmount:amount,type:'invoice_payment',method:'banktransfer',dueDate,locale:'de_DE',billingAddress:{email:order.customer_email,givenName:order.customer_first_name,familyName:order.customer_last_name,streetAndNumber:order.customer_address,postalCode:order.customer_zip,city:order.customer_city,country:'DE'},description:'Miete und Kaution '+order.order_no,redirectUrl:process.env.BASE_URL.replace(/\/$/,'')+'/profile.html?view=invoices'},application:{kind:'payment_records',paymentRecordIds:[row.insertId]}});
 return {operationKey:key};
}
async function transferInstructions(c,orderId) {
 const [[row]]=await c.execute("SELECT e.result_json FROM rental_order_payments p JOIN external_effects_outbox e ON e.operation_key=p.external_operation_key WHERE p.order_id=? AND p.payment_type='invoice_payment' ORDER BY p.id DESC LIMIT 1",[orderId]);
 const result=parse(row?.result_json);if(result?.method!=='banktransfer'||!result.details?.bankAccount||!result.details?.transferReference)return null;
 return {checkoutUrl:safeMolliePaymentLink(result.links?.payOnline?.href)||safeMolliePaymentLink(result.checkoutUrl),bankAccount:result.details.bankAccount,bankBic:result.details.bankBic||'',bankName:result.details.bankName||'',transferReference:result.details.transferReference};
}
module.exports={safeMolliePaymentLink,prepareInvoiceTransfer,transferInstructions,transferDueDate};
