'use strict';
const {sendGraphMail}=require('./mailService');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
async function deliverDocument(c, doc, order) {
    await sendGraphMail({to:order.customer_email,
        subject:(doc.kind==='credit'?'Ihre Stornierung / Rechnungskorrektur':'Ihre Rechnung')+' – '+doc.document_number,
        text:'Zur Bestellung '+order.order_no+' erhalten Sie den Beleg im Anhang.'+(order.user_id?' Er steht auch in Ihrem Rechnungsarchiv bereit.':''),
        invoicePdf:{name:doc.document_number+'.pdf',contentBytes:doc.pdf_data.toString('base64')},
        ...(doc.xml_data?{invoiceXml:{name:doc.document_number+'.xml',contentBytes:doc.xml_data.toString('base64')}}:{})
    },{connection:c,operationKey:'mail-billing-document-'+doc.id});
    await c.execute('UPDATE billing_documents SET customer_released_at=COALESCE(customer_released_at,NOW()) WHERE id=?',[doc.id]);
}
async function releasePaidDocuments(c, order) {
    const [docs]=await c.execute(`SELECT d.* FROM billing_documents d JOIN rental_invoices i ON i.id=d.invoice_id
        WHERE d.order_id=? AND d.customer_released_at IS NULL AND (d.kind='credit' OR
        (JSON_EXTRACT(d.snapshot_json,'$.scope') IS NULL AND i.status='paid' AND i.invoice_number=d.document_number) OR
        EXISTS(SELECT 1 FROM rental_order_payments p WHERE p.billing_document_id=d.id AND p.payment_status IN ('paid','offset')))
        ORDER BY d.id FOR UPDATE`,[order.id]);
    for(const doc of docs)await deliverDocument(c,doc,order);
}
async function requestPayment(c,doc,order,key='mail-payment-request-'+doc.id) {
    const snapshot=parse(doc.snapshot_json);
    if(!snapshot.bankTransfer?.checkoutUrl)return;
    await sendGraphMail({to:order.customer_email,subject:'Zahlungsaufforderung – '+order.order_no,
        paymentUrl:snapshot.bankTransfer.checkoutUrl,
        text:'Bitte begleichen Sie '+((Number(doc.gross_cents)+Number(snapshot.depositCents||0))/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'})+
        ' bis zum '+new Date(snapshot.dueAt).toLocaleDateString('de-DE')+'. Die Rechnung erhalten Sie nach bestätigtem Zahlungseingang.'
    },{connection:c,operationKey:key});
}
module.exports={deliverDocument,releasePaidDocuments,requestPayment};
