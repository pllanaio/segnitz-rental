'use strict';
const PDFDocument=require('pdfkit');
const path=require('node:path');
const {signatureBuffer}=require('./receiptService');
const euro=c=>(Number(c)/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'}).replace(/\u00a0/g,' ');
const day=d=>new Date(d).toLocaleDateString('de-DE',{timeZone:'Europe/Berlin'});
function totals(lines){let gross=0,net=0;for(const l of lines){if(!Number.isSafeInteger(l.grossCents))throw Error('Ungültiger Positionsbetrag');gross+=l.grossCents;net+=Math.round(l.grossCents*100/(100+l.vatRate));}const tax=Math.sign(net)*Math.round(Math.abs(net)*19/100);return {gross,net,tax,rounding:gross-net-tax};}
async function renderInvoicePdf(s){
 const doc=new PDFDocument({size:'A4',margins:{top:45,left:44,right:44,bottom:65},bufferPages:true,info:{Title:s.number,Author:s.issuer.name,CreationDate:new Date(s.issuedAt)}});
 const parts=[];const result=new Promise((resolve,reject)=>{doc.on('data',p=>parts.push(p));doc.on('end',()=>resolve(Buffer.concat(parts)));doc.on('error',reject);});
 const navy='#092447',yellow='#fcdc31';
 const ensure=h=>{if(doc.y+h>750)doc.addPage();};
 const text=(t,size=10,bold=false)=>{doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(navy);ensure(doc.heightOfString(String(t),{width:507})+8);doc.text(String(t),44,doc.y,{width:507,lineGap:3}).moveDown(.35);};
 try{
  doc.rect(0,0,596,108).fill(navy);doc.image(path.join(__dirname,'../public/img/logo.png'),44,14,{fit:[170,80]});doc.rect(0,108,596,5).fill(yellow);doc.y=139;
  text(s.kind==='credit'?'Rechnungskorrektur':'Rechnung',26,true);
  text(s.number+'  |  '+day(s.issuedAt),11,true);text('Bestellung '+s.orderNo);
  if(s.originalNumber)text('Bezug: Rechnung '+s.originalNumber+' vom '+day(s.originalDate),10,true);
  text(s.issuer.name+' · '+s.issuer.address+' · '+s.issuer.postalCode+' '+s.issuer.city,8);
  text(s.customer.join('\n'),11);doc.moveDown(.6);
  if(s.reason)text(s.reason);
  const header=()=>{ensure(34);const y=doc.y;doc.rect(44,y,507,25).fill('#eaf0f7');doc.font('Helvetica-Bold').fontSize(9).fillColor(navy);[['Position / Leistungszeitraum',50,233],['Menge',285,40],['USt.',328,38],['Einzelpreis',369,82],['Gesamt',454,91]].forEach(([t,x,w])=>doc.text(t,x,y+8,{width:w,align:x>=369?'right':'left',lineBreak:false}));doc.y=y+25;};
  const tableRow=(description,quantity,vat,unit,amount)=>{doc.font('Helvetica').fontSize(9);const height=Math.max(36,doc.heightOfString(description,{width:227})+18);if(doc.y+height>740){doc.addPage();header();}const y=doc.y;doc.fillColor(navy).font('Helvetica').fontSize(9).text(description,50,y+9,{width:227,lineGap:2});[[String(quantity),285,40],[vat,328,38],[unit,369,82],[amount,454,91]].forEach(([t,x,w])=>doc.text(t,x,y+9,{width:w,align:x>=369?'right':'left',lineBreak:false}));doc.moveTo(44,y+height).lineTo(551,y+height).strokeColor('#dce3ed').stroke();doc.y=y+height;};
  header();
  for(const [index,line] of s.lines.entries()){
   const period=String(line.period||'').replace(/(\d{4})-(\d{2})-(\d{2})/g,'$3.$2.$1');
   tableRow((index+1)+'. '+line.description+(period?'\n'+period:'')+(line.discountCents?'\nRabatt berücksichtigt: '+euro(line.discountCents):''),line.quantity||1,line.vatRate+' %',euro(Math.round(line.grossCents/(line.quantity||1))),euro(line.grossCents));
  }
  const deposit=s.kind==='credit'?0:Number(s.depositCents||0);
  if(deposit)tableRow('Rückzahlbare Kaution (Sicherheitsleistung)',1,'–',euro(deposit),euro(deposit));
  const sum=totals(s.lines);ensure(185);doc.y+=15;
  const totalRow=(label,amount,bold=false)=>{const y=doc.y;doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(10).fillColor(navy).text(label,230,y,{width:205});doc.text(euro(amount),435,y,{width:110,align:'right'});doc.y=y+20;};
  totalRow('Miete / Leistungen netto',sum.net);totalRow('Umsatzsteuer 19 %',sum.tax);if(sum.rounding)totalRow('Rundungsausgleich',sum.rounding);
  totalRow('Miete / Leistungen inkl. MwSt.',sum.gross,true);if(deposit)totalRow('Rückzahlbare Kaution (ohne USt.)',deposit);
  const y=doc.y;doc.roundedRect(44,y,507,38,5).fill(yellow);doc.font('Helvetica-Bold').fontSize(14).fillColor(navy).text(s.kind==='credit'?'Korrekturbetrag':deposit?'Gesamtbetrag inkl. Kaution':'Rechnungsbetrag',55,y+11,{width:315});doc.text(euro(sum.gross+deposit),365,y+11,{width:175,align:'right'});doc.y=y+53;
  if(s.kind==='credit')text('Die Rechnung wird um den oben ausgewiesenen Betrag berichtigt. Eine Auszahlung erfolgt nur für bereits geleistete Zahlungen über deren ursprünglichen Zahlungsweg.');
  else if(s.paidAt)text('Zahlungseingang am '+day(s.paidAt)+'. Vielen Dank.');
  else {text('Zahlbar bis '+day(s.dueAt)+' (vereinbartes Zahlungsziel: 14 Tage).');if(s.bankTransfer)text('Überweisung über Mollie\nIBAN: '+s.bankTransfer.bankAccount+'\nBIC: '+s.bankTransfer.bankBic+'\nVerwendungszweck: '+s.bankTransfer.transferReference);else if(s.issuer.iban)text('Überweisung an '+(s.issuer.accountHolder||s.issuer.name)+'\nIBAN: '+s.issuer.iban+(s.issuer.bic?' · BIC: '+s.issuer.bic:'')+'\nVerwendungszweck: '+s.number);text(s.bankTransfer?'Bitte verwenden Sie ausschließlich die Zahlungsdaten und den unveränderten Verwendungszweck von Mollie. Nach einer Rechnungskorrektur gelten die neuen Zahlungsanweisungen von Mollie.':'Bitte geben Sie bei der Überweisung die Rechnungsnummer als Verwendungszweck an.');}
  if(s.scope!=='additional')text('Die rückzahlbare Kaution ist keine Mietleistung und wird ohne Umsatzsteuer separat ausgewiesen. Miete und Kaution werden gemeinsam bezahlt.',9);
  if(s.signature){const sig=signatureBuffer(s.signature);if(sig){ensure(115);text('Unterschrift bei Bestellung',10,true);const y=doc.y;doc.image(sig.buffer,44,y,{fit:[190,65]});doc.y=y+75;}}
  const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){
   doc.switchToPage(i);doc.page.margins.bottom=0;doc.font('Helvetica').fontSize(7).fillColor(navy).text([s.issuer.name+' · '+s.issuer.address+' · '+s.issuer.postalCode+' '+s.issuer.city,'Steuernummer / USt-ID: '+s.issuer.taxId+' · '+s.issuer.email,[s.issuer.registerInfo,s.issuer.managingDirectors].filter(Boolean).join(' · '),s.number+' · Seite '+(i+1)+' / '+range.count].filter(Boolean).join('\n'),44,779,{width:507,lineGap:2});
  }doc.end();
 }catch(e){doc.destroy(e);}return result;
}
module.exports={renderInvoicePdf,totals};
