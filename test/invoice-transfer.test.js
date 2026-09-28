'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {transferDueDate}=require('../services/invoiceTransfer');
test('Überweisungsziel sind 14 Kalendertage ab lokalem Tag auch über Sommerzeit und Jahreswechsel',()=>{
 assert.equal(transferDueDate(new Date('2026-09-28T23:30:00Z')),'2026-10-13');
 assert.equal(transferDueDate(new Date('2026-10-20T10:00:00Z')),'2026-11-03');
 assert.equal(transferDueDate(new Date('2026-12-25T10:00:00Z')),'2027-01-08');
});
test('Schneller Zahlungseingang vor PDF-Erstellung berücksichtigt bereits Miete plus Kaution',async()=>{
 const {invoiceBalance}=require('../services/salesInvoices');
 const c={execute:async sql=>{
  if(sql.includes(' received'))return [[{due:0,received:460}]];
  if(sql.includes('invoice_combined_payment'))return [[{invoice_combined_payment:1}]];
  if(sql.includes('SUM(deposit)'))return [[{amount:300}]];
  if(sql.includes('pdf_data IS NOT NULL'))return [[{ready:0}]];
  if(sql.includes('COUNT(*)'))return [[{n:0}]];
  if(sql.includes('JOIN rental_products'))return [[{id:1,title:'Bagger',rental_start:'2026-10-01',rental_end:'2026-10-02',price_per_day:80,discount_amount:0}]];
  throw Error(sql);
 }};
 const balance=await invoiceBalance(c,1);assert.equal(balance.dueCents,46000);assert.equal(balance.openCents,0);assert.equal(balance.paidCents,46000);
});
