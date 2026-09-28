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
  for(const [index,line] of s.lines.entries()){
   ensure(90);doc.rect(44,doc.y,507,1).fill('#dce3ed');doc.y+=10;
   text((index+1)+'. '+line.description,11,true);
   if(line.period)text('Leistungszeitraum: '+line.period,9);
   if(line.discountCents)text('Rabatt bereits berücksichtigt: '+euro(line.discountCents),9);
   text('Menge: '+(line.quantity||1)+' · Umsatzsteuer: '+line.vatRate+' % · Brutto: '+euro(line.grossCents),10);
  }
  const sum=totals(s.lines);ensure(130);doc.moveDown();text('Nettobetrag: '+euro(sum.net));text('Umsatzsteuer 19 %: '+euro(sum.tax));if(sum.rounding)text('Rundungsausgleich: '+euro(sum.rounding));
  const y=doc.y;doc.roundedRect(44,y,507,38,5).fill(yellow);doc.y=y+9;text('Rechnungsbetrag Miete: '+euro(sum.gross),15,true);doc.y=y+53;
  if(s.kind!=='credit'&&s.depositCents){text('Rückzahlbare Kaution (Sicherheitsleistung): '+euro(s.depositCents),11,true);text('Gemeinsamer Zahlbetrag: '+euro(sum.gross+s.depositCents),13,true);}
  if(s.kind==='credit')text('Die Rechnung wird um den oben ausgewiesenen Betrag berichtigt. Eine Auszahlung erfolgt nur für bereits geleistete Zahlungen über deren ursprünglichen Zahlungsweg.');
  else if(s.paidAt)text('Zahlungseingang am '+day(s.paidAt)+'. Vielen Dank.');
  else {text('Zahlbar bis '+day(s.dueAt)+' (vereinbartes Zahlungsziel: 14 Tage).');if(s.bankTransfer)text('Überweisung über Mollie\nIBAN: '+s.bankTransfer.bankAccount+'\nBIC: '+s.bankTransfer.bankBic+'\nVerwendungszweck: '+s.bankTransfer.transferReference);else if(s.issuer.iban)text('Überweisung an '+(s.issuer.accountHolder||s.issuer.name)+'\nIBAN: '+s.issuer.iban+(s.issuer.bic?' · BIC: '+s.issuer.bic:'')+'\nVerwendungszweck: '+s.number);text(s.bankTransfer?'Bitte verwenden Sie ausschließlich die Zahlungsdaten und den unveränderten Verwendungszweck von Mollie. Nach einer Rechnungskorrektur gelten die neuen Zahlungsanweisungen von Mollie.':'Bitte geben Sie bei der Überweisung die Rechnungsnummer als Verwendungszweck an.');}
  text('Die rückzahlbare Kaution ist keine Mietleistung und wird ohne Umsatzsteuer separat ausgewiesen. Miete und Kaution werden gemeinsam bezahlt.',9);
  if(s.signature){const sig=signatureBuffer(s.signature);if(sig){ensure(115);text('Unterschrift bei Bestellung',10,true);const y=doc.y;doc.image(sig.buffer,44,y,{fit:[190,65]});doc.y=y+75;}}
  const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){
   doc.switchToPage(i);doc.page.margins.bottom=0;doc.font('Helvetica').fontSize(7).fillColor(navy).text([s.issuer.name+' · '+s.issuer.address+' · '+s.issuer.postalCode+' '+s.issuer.city,'Steuernummer / USt-ID: '+s.issuer.taxId+' · '+s.issuer.email,[s.issuer.registerInfo,s.issuer.managingDirectors].filter(Boolean).join(' · '),s.number+' · Seite '+(i+1)+' / '+range.count].filter(Boolean).join('\n'),44,779,{width:507,lineGap:2});
  }doc.end();
 }catch(e){doc.destroy(e);}return result;
}
module.exports={renderInvoicePdf,totals};
