'use strict';
async function refundEarlyReturns(c,orderId,persistOnlineRefund){
 const [items]=await c.execute('SELECT id,early_return_refund FROM rental_order_items WHERE order_id=? AND early_return_refund>0 ORDER BY id FOR UPDATE',[orderId]);
 const [sources]=await c.execute(`SELECT p.* FROM rental_order_payments p WHERE p.order_id=? AND p.payment_status='paid'
 AND (p.payment_type IN ('initial_payment','invoice_payment','rental_adjustment') OR (p.payment_type='rental' AND NOT EXISTS(SELECT 1 FROM rental_order_payments i WHERE i.order_id=p.order_id AND i.payment_type IN ('initial_payment','invoice_payment') AND i.payment_status='paid'))) ORDER BY p.id`,[orderId]);
 // Cash receipts have no provider ID; treat them as one funding source.
 const cash=sources.filter(s=>s.payment_method==='cash');
 const funding=sources.filter(s=>s.payment_method!=='cash');
 if(cash.length)funding.push({...cash[0],order_item_id:null,amount:cash.reduce((sum,s)=>sum+Number(s.amount),0)});
 for(const item of items){
  const [[prior]]=await c.execute("SELECT COALESCE(SUM(ABS(amount)),0) amount FROM rental_order_payments WHERE order_item_id=? AND payment_type='rental_refund'",[item.id]);
  let remaining=Math.max(0,Math.round((Number(item.early_return_refund)-Number(prior.amount))*100));
  for(const source of funding){if(!remaining)break;
   if(source.order_item_id&&Number(source.order_item_id)!==Number(item.id))continue;
   const [[used]]=await c.execute("SELECT COALESCE(SUM(ABS(amount)),0) amount FROM rental_order_payments WHERE order_id=? AND amount<0 AND payment_method=? AND mollie_payment_id <=> ? AND payment_status NOT IN ('cancelled')",[orderId,source.payment_method,source.mollie_payment_id]);
   const amount=Math.min(remaining,Math.max(0,Math.round((Number(source.amount)-Number(used.amount))*100)));if(!amount)continue;
   const key='early-rental-refund-'+item.id+'-'+source.id;
   if(source.payment_method==='online'&&source.mollie_payment_id){
    await persistOnlineRefund(c,{operationKey:key,orderId,orderItemId:item.id,paymentType:'rental_refund',paymentId:source.mollie_payment_id,amount:amount/100,description:'Mieterstattung wegen vorzeitiger Rückgabe',metadata:{itemId:String(item.id)},note:'Vorzeitige Rückgabe: Erstattung ungenutzter Miettage auf das ursprüngliche Zahlungsmittel'});
   }else if(source.payment_method==='cash'){
    await c.execute("INSERT INTO rental_order_payments(order_id,order_item_id,payment_type,payment_method,payment_status,amount,external_operation_key,note) VALUES(?,?,'rental_refund','cash','pending',?,?,'Vorzeitige Rückgabe: Mieterstattung in bar auszahlen') ON DUPLICATE KEY UPDATE id=id",[orderId,item.id,-amount/100,key]);
   }else continue;
   remaining-=amount;
  }
 }
}
module.exports={refundEarlyReturns};
