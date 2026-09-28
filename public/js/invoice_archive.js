'use strict';
const invoiceLabels = {payment_required:'Zahlung erneut erforderlich',offset:'Verrechnet',credit_required:'Gutschrift in Bearbeitung',queued:'Wird erstellt',draft:'Entwurf',issued:'Ausstehend','pending-payment':'Zahlung wird geprüft',paid:'Bezahlt',overdue:'Überfällig',cancelled:'Rechnung storniert',failed:'Erstellung fehlgeschlagen',payment_reversed:'Zahlung zurückgebucht','payment-reversed':'Zahlung zurückgebucht'};
const invoiceEscape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const invoiceMoney = value => Number(value||0).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
async function invoiceFetch(url,method='GET',body) {
    const response=await fetch(url,{method,cache:'no-store',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Rechnung nicht erreichbar.');return result;
}
function safeInvoiceLink(url) {try {const u=new URL(url);return u.protocol==='https:'&&['mollie.com','mollie.nl'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host))?u.href:null;}catch{return null;}}
async function invoiceCard(container,orderId,admin=false) {
    const base=`${admin?'/admin/orders':'/my-orders'}/${Number(orderId)}/invoice`;
    const data=await invoiceFetch(base);const i=data.invoice||(admin?{status:'queued',amount:null}:null);
    if(!i){container.remove();return;}
    const d=data.deposit, openDeposit=data.separateDeposit&&d&&d.status!=='paid'&&!data.cancelled;
    const documents=data.documents||[];
    const archive=await invoiceFetch((admin?'/admin/invoices':'/my-invoices')+'?orderId='+Number(orderId));
    if(container.closest('.order-sheet')) {
        container.innerHTML='<div class="invoice-documents">'+invoiceDocumentRows(archive.items,admin)+'</div>'+(archive.items.length?'':'<p class="text-muted">Rechnungen erscheinen hier, sobald sie ausgestellt wurden.</p>');
        styleOrderSheetDocuments(container,admin);
        return;
    }
    container.innerHTML=`<h3 class="h5">Rechnungen &amp; Dokumente</h3><div class="invoice-documents">${invoiceDocumentRows(archive.items,admin)}</div>
        ${!archive.items.length?'<p class="text-muted">Rechnungen erscheinen hier, sobald sie ausgestellt wurden.</p>':''}

        ${admin&&(data.separateDeposit||data.combinedPayment)&&data.balance?.openCents>0&&!data.cancelled?`<p><strong>Offene ursprüngliche Mietrechnung:</strong> ${invoiceMoney(data.balance.openCents/100)}</p>`:''}
        ${admin&&(data.separateDeposit||data.combinedPayment)?'<p>Überweisungen werden über Mollie abgewickelt. Der Kunde erhält die Zahlungsdaten per E-Mail; der Zahlungseingang wird automatisch bestätigt.</p>':''}
        ${admin&&data.paymentMethod==='invoice'&&data.combinedPayment&&data.balance?.openCents>0&&!data.cancelled?'<button class="btn btn-outline-primary mb-3" data-invoice-action="rent-banktransfer">Mollie-Überweisung vorbereiten / erneut prüfen</button>':''}
        ${data.combinedPayment?`<p><strong>Zahlungsstatus:</strong> ${invoiceEscape(({paid:'Bezahlt',pending:'Ausstehend',cancelled:'Abgebrochen',failed:'Fehlgeschlagen',expired:'Verfallen',charged_back:'Zurückgebucht',refund_pending:'Erstattung ausstehend',refunded:'Erstattet'})[data.paymentStatus]||'Wird geprüft')}</p>`:''}
        ${i.amount!==null?`<p><strong>Miete inkl. MwSt.:</strong> ${invoiceMoney(i.amount)}</p>`:''}
        ${d?`<p><strong>Kaution:</strong> ${invoiceMoney(d.amount)} · ${d.status==='paid'?'Bezahlt':'Noch nicht bezahlt'}</p>`:''}
        ${i.amount!==null?`<p><strong>Gesamt Miete und Kaution:</strong> ${invoiceMoney(Number(i.amount||0)+Number(d?.amount||0))}</p>`:''}
        ${admin&&openDeposit?`<p class="small">Die Kaution muss vor Abholung bezahlt sein. Der Mietbetrag kann innerhalb des Zahlungsziels bezahlt werden.</p><div class="d-flex flex-wrap gap-2"><button class="btn btn-primary" data-invoice-action="online">Kaution online bezahlen</button><button class="btn btn-outline-primary" data-invoice-action="banktransfer">Kaution überweisen</button>${admin?'<button class="btn btn-outline-primary" data-invoice-action="cash">Kaution bar erfassen</button><select class="form-select" aria-label="Terminal für Kaution" data-invoice-terminal></select><button class="btn btn-outline-primary" data-invoice-action="pos">Kaution per Karte vor Ort</button>':''}</div>`:''}
        ${admin&&safeInvoiceLink(data.simulationUrl)?`<a class="mt-2" href="${invoiceEscape(safeInvoiceLink(data.simulationUrl))}" target="_blank" rel="noopener">Mollie-Testzahlung simulieren</a>`:''}
        ${admin&&i.lastError?`<p class="text-danger">${invoiceEscape(i.lastError)}</p>`:''}<p role="status" class="mt-2 mb-0" data-invoice-message></p>`;
    if(container.closest('.order-sheet'))styleOrderSheetDocuments(container,admin);
    if(admin&&openDeposit){try{const terminals=await invoiceFetch('/admin/pos/terminals');container.querySelector('[data-invoice-terminal]').innerHTML=terminals.items.filter(t=>t.enabled&&t.status==='active').map(t=>`<option value="${invoiceEscape(t.id)}">${invoiceEscape(t.label||t.description)}</option>`).join('');}catch(e){container.querySelector('[data-invoice-message]').textContent=e.message;}}
    container.invoiceEvents?.abort();
    container.invoiceEvents=new AbortController();
    container.addEventListener('click',async event=>{
        const button=event.target.closest('[data-invoice-action]');if(!button||container.dataset.busy)return;
        const action=button.dataset.invoiceAction;
        if(action==='offer-transfer'&&!(await showConfirm('Miete auf Überweisung mit 14 Tagen Zahlungsziel umstellen? Miete und Kaution werden gemeinsam innerhalb von 14 Tagen bezahlt.','Überweisung vereinbaren')))return;
        if(action==='cash'&&!(await showConfirm('Wurde die Kaution vollständig in bar entgegengenommen?','Kaution bar erfassen')))return;
        container.dataset.busy='1';button.disabled=true;
        try{
            const result=action==='offer-transfer'?await invoiceFetch(base+'/offer-transfer','POST',{}):await invoiceFetch(action==='sync'?base+'/sync':action.startsWith('rent-')?base+'/pay':base+'/deposit','POST',action==='sync'?{}:{method:action.replace('rent-',''),terminalId:container.querySelector('[data-invoice-terminal]')?.value});
            const link=safeInvoiceLink(result.checkoutUrl);
            if(link&&!action.startsWith('rent-')){location.assign(link);return;}
            if(action==='offer-transfer'||(admin&&action==='sync')){await loadOrders();await openOrderDetails(Number(orderId));return;}
            await invoiceCard(container,orderId,admin);
            container.querySelector('[data-invoice-message]').textContent=result.message||(result.pending?'Zahlung wird geprüft. Bitte Status erneut abrufen.':'Status aktualisiert.');
        }catch(e){container.querySelector('[data-invoice-message]').textContent=e.message;}finally{delete container.dataset.busy;button.disabled=false;}
    },{signal:container.invoiceEvents.signal});
}
function invoiceDocumentRows(items,admin=false){
 return items.map(i=>{
  const base=(admin?'/admin/orders/':'/my-orders/')+Number(i.orderId)+'/invoice'+(i.legacy?'':'/documents/'+Number(i.id));
  const status=i.kind==='credit'?'Rechnungskorrektur':invoiceLabels[i.status]||i.status;
  return '<article class="invoice-document '+(i.kind==='credit'?'is-credit':orderStateTone(i.status))+'"><div class="invoice-document-name"><i class="bi bi-file-earmark-text" aria-hidden="true"></i><div><strong>'+invoiceEscape(i.invoiceNumber)+'</strong><p>'+invoiceEscape(i.description||'Miete und Kaution')+'</p></div></div><div class="invoice-document-date">'+invoiceEscape(new Date(i.createdAt).toLocaleDateString('de-DE'))+(i.dueAt&&i.kind!=='credit'?'<small>Fällig '+invoiceEscape(new Date(i.dueAt).toLocaleDateString('de-DE'))+'</small>':'')+'</div><div class="invoice-document-amount"><strong>'+invoiceMoney(Number(i.amount)+Number(i.depositAmount||0))+'</strong>'+(Number(i.depositAmount)>0?'<small>inkl. '+invoiceMoney(i.depositAmount)+' Kaution</small>':'')+'</div><span class="invoice-status '+(i.kind==='credit'?'is-credit':orderStateTone(i.status))+'">'+invoiceEscape(status)+'</span><div class="invoice-downloads"><a class="btn btn-outline-primary btn-sm" href="'+base+'/pdf" aria-label="PDF '+invoiceEscape(i.invoiceNumber)+'">PDF</a>'+(i.hasXml?'<a class="btn btn-outline-primary btn-sm" href="'+base+'/xml" aria-label="XML '+invoiceEscape(i.invoiceNumber)+'">XML</a>':'')+'</div></article>';
 }).join('');
}
async function renderInvoiceArchive(admin=false){
 const container=document.getElementById(admin?'adminInvoiceList':'customerInvoices');
 container.innerHTML='<p class="text-muted">Alle Rechnungen und Korrekturen, übersichtlich nach Auftrag geordnet.</p><label class="invoice-search"><i class="bi bi-search" aria-hidden="true"></i><input class="form-control" type="search" maxlength="200" aria-label="Rechnungen durchsuchen" placeholder="Auftrag, Rechnung, Kunde oder Betrag suchen …" data-archive-search></label><div data-archive-results aria-live="polite"></div>';
 const input=container.querySelector('input'),results=container.querySelector('[data-archive-results]');let timer,revision=0;
 async function load(page=1){const current=++revision;try{
  const data=await invoiceFetch((admin?'/admin/invoices':'/my-invoices')+'?q='+encodeURIComponent(input.value)+'&page='+page);if(current!==revision)return;
  const groups=new Map();for(const item of data.items){if(!groups.has(item.orderId))groups.set(item.orderId,[]);groups.get(item.orderId).push(item);}
  results.innerHTML=[...groups.values()].map((items,n)=>{const o=items[0];return '<details class="invoice-order" '+(n===0||input.value?'open':'')+'><summary><span><strong>Auftrag '+invoiceEscape(o.orderNo)+'</strong><small>'+items.length+' Belege'+(admin?' · '+invoiceEscape(o.customerName)+' · '+invoiceEscape(o.company||o.email):'')+'</small></span><i class="bi bi-chevron-down" aria-hidden="true"></i></summary><div class="invoice-documents">'+invoiceDocumentRows(items,admin)+'</div></details>';}).join('')||'<div class="invoice-empty"><i class="bi bi-folder2-open" aria-hidden="true"></i><h3>Keine Rechnungen gefunden</h3><p>Versuchen Sie einen anderen Suchbegriff.</p></div>';
  const footer=document.createElement('div');footer.className='d-flex gap-2 align-items-center flex-wrap mt-3';footer.innerHTML='<button class="btn btn-outline-primary" data-archive-page="'+(page-1)+'" '+(page<=1?'disabled':'')+'>Zurück</button><span>'+data.total+' Aufträge · Seite '+page+' / '+data.totalPages+'</span><button class="btn btn-outline-primary" data-archive-page="'+(page+1)+'" '+(page>=data.totalPages?'disabled':'')+'>Weiter</button>';results.append(footer);
 }catch(e){if(current===revision)results.textContent=e.message;}}
 input.addEventListener('input',()=>{clearTimeout(timer);revision++;timer=setTimeout(()=>load(),250);});results.addEventListener('click',event=>{const b=event.target.closest('[data-archive-page]');if(b)load(Number(b.dataset.archivePage));});await load();
}
async function loadCustomerInvoices(){return renderInvoiceArchive(false);}
async function renderAdminInvoice(order){
    const body=document.getElementById('orderDetailsBody');if(!body)return;
    body.querySelector('[data-admin-invoice]')?.remove();
    const card=document.createElement('section');card.className='order-documents';card.dataset.adminInvoice='1';body.append(card);
    try{await invoiceCard(card,order.id,true);}catch(e){card.textContent=e.message;}
}
async function loadAdminInvoiceList(){return renderInvoiceArchive(true);}

document.addEventListener('click',async event=>{const button=event.target.closest('[data-transfer-order]');if(!button||button.disabled)return;if(!await showConfirm('Miete und Kaution gemeinsam mit 14 Tagen Zahlungsziel berechnen? Die Abholung ist vor Zahlung erlaubt.','Kauf auf Rechnung'))return;button.disabled=true;try{await invoiceFetch('/admin/orders/'+Number(button.dataset.transferOrder)+'/invoice/offer-transfer','POST',{});await openOrderDetails(Number(button.dataset.transferOrder));}catch(e){showAlert(e.message,'danger');}finally{button.disabled=false;}});

document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-additional-transfer]');if(!button||button.disabled)return;
 if(!await showConfirm('Für diese Nachzahlung einen eigenen Mollie-Zahlungslink anfordern? Die ursprüngliche Mietrechnung und deren Zahlungslink bleiben unverändert. Ein vorhandener Zahlungsversuch dieser Nachzahlung wird gegebenenfalls ersetzt.','Überweisung anfordern'))return;
 button.disabled=true;
 try{const result=await invoiceFetch('/admin/orders/'+button.dataset.additionalTransfer+'/additional-transfer','POST',{orderItemId:Number(button.dataset.item),paymentType:button.dataset.type});showAlert(result.message,'success');await openOrderDetails(Number(button.dataset.additionalTransfer));}catch(error){showAlert(error.message,'danger');}finally{button.disabled=false;}
});
