'use strict';
async function searchArchive(c,{username=null,q='',page=1}){
 const terms=String(q).trim().slice(0,200).split(/\s+/u).filter(Boolean).slice(0,10);
 page=Math.max(1,Math.min(100000,Number.parseInt(page,10)||1));const limit=25;
 const where=[],params=[];
 if(username){where.push('o.user_id=(SELECT id FROM users WHERE username=?)');params.push(username);}
 const documentStatus="CASE WHEN d.kind='invoice' AND d.gross_cents>0 AND COALESCE((SELECT SUM(cr.gross_cents) FROM billing_documents cr WHERE cr.original_document_id=d.id AND cr.kind='credit'),0)<=-d.gross_cents THEN 'cancelled' ELSE i.status END";
 const haystack="LOWER(CONCAT_WS(' ',d.document_number,o.order_no,o.customer_first_name,o.customer_last_name,o.customer_company,o.customer_email,"+documentStatus+",CASE "+documentStatus+" WHEN 'paid' THEN 'bezahlt' WHEN 'issued' THEN 'offen' WHEN 'cancelled' THEN 'storniert' WHEN 'overdue' THEN 'überfällig' ELSE '' END,d.kind,DATE_FORMAT(d.created_at,'%d.%m.%Y'),DATE_FORMAT(d.created_at,'%e.%c.%Y'),DATE_FORMAT(d.created_at,'%Y-%m-%d'),CAST(d.gross_cents/100 AS DECIMAL(12,2)),REPLACE(CAST(d.gross_cents/100 AS DECIMAL(12,2)),'.',','),FORMAT(d.gross_cents/100,2,'de_DE'),FORMAT((d.gross_cents+COALESCE(JSON_EXTRACT(d.snapshot_json,'$.depositCents'),0))/100,2,'de_DE'),CAST((d.gross_cents+COALESCE(JSON_EXTRACT(d.snapshot_json,'$.depositCents'),0))/100 AS DECIMAL(12,2)),CAST(d.snapshot_json AS CHAR)))";
 for(const term of terms){where.push('LOCATE(LOWER(?),'+haystack+')>0');params.push(term);}
 const documents="(SELECT id,order_id,invoice_id,kind,document_number,gross_cents,snapshot_json,created_at,xml_data IS NOT NULL AS has_xml,0 AS legacy FROM billing_documents UNION ALL SELECT -ri.id,ri.order_id,ri.id,'invoice',COALESCE(ri.invoice_number,'Historischer Beleg'),ROUND(ri.amount*100),COALESCE(ri.request_json,JSON_OBJECT()),ri.created_at,0,1 FROM rental_invoices ri WHERE ri.pdf_data IS NOT NULL AND NOT EXISTS(SELECT 1 FROM billing_documents bd WHERE bd.invoice_id=ri.id AND bd.kind='invoice')) d";
 const from=' FROM '+documents+' JOIN rental_orders o ON o.id=d.order_id JOIN rental_invoices i ON i.id=d.invoice_id'+(where.length?' WHERE '+where.join(' AND '):'');
 const [[count]]=await c.execute('SELECT COUNT(*) total'+from,params);
 const [items]=await c.execute("SELECT d.id,d.order_id AS orderId,o.order_no AS orderNo,d.document_number AS invoiceNumber,d.kind,d.gross_cents/100 AS amount,IF(d.kind='invoice',COALESCE(JSON_EXTRACT(d.snapshot_json,'$.depositCents'),0)/100,0) AS depositAmount,d.created_at AS createdAt,"+documentStatus+" AS status,CONCAT_WS(' ',o.customer_first_name,o.customer_last_name) AS customerName,o.customer_company AS company,o.customer_email AS email,d.has_xml AS hasXml,d.legacy,1 AS hasPdf"+from+' ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?',[...params,String(limit),String((page-1)*limit)]);
 return {items:items.map(item=>({...item,id:Number(item.id)})),total:Number(count.total),page,totalPages:Math.max(1,Math.ceil(count.total/limit))};
}
module.exports={searchArchive};
