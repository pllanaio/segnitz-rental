'use strict';
const invoiceLabels = {credit_required:'Gutschrift in Bearbeitung',queued:'Wird erstellt',draft:'Entwurf',issued:'Offen','pending-payment':'Zahlung wird geprüft',paid:'Bezahlt',overdue:'Überfällig',cancelled:'Storniert',failed:'Erstellung fehlgeschlagen',payment_reversed:'Zahlung zurückgebucht','payment-reversed':'Zahlung zurückgebucht'};
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
    container.innerHTML=`<h3 class="h5">Rechnung ${invoiceEscape(i.invoiceNumber||'in Vorbereitung')}</h3>
        <p>${invoiceEscape(invoiceLabels[i.status]||'Wird geprüft')} ${i.amount!==null?'· '+invoiceMoney(i.amount):''}${i.dueAt?' · Fällig: '+invoiceEscape(new Date(i.dueAt).toLocaleDateString('de-DE')):''}</p>
        <div class="d-flex flex-wrap gap-2 mb-3">${i.hasPdf?`<a class="btn btn-outline-primary" href="${base}/pdf">Rechnung herunterladen</a>`:''}${admin?'<button class="btn btn-outline-primary" data-invoice-action="sync">Status prüfen</button>':''}</div>
        ${documents.filter(doc=>doc.kind==='credit').map(doc=>`<p><a href="${base}/documents/${Number(doc.id)}/pdf">Rechnungskorrektur ${invoiceEscape(doc.number)}</a> · ${invoiceMoney(doc.grossCents/100)}</p>`).join('')}
        ${admin&&(data.separateDeposit||data.combinedPayment)&&data.balance?.openCents>0&&!data.cancelled?`<p><strong>Offener Gesamtbetrag:</strong> ${invoiceMoney(data.balance.openCents/100)}</p>`:''}
        ${admin&&(data.separateDeposit||data.combinedPayment)?'<p>Überweisungen werden über Mollie abgewickelt. Der Kunde erhält die Zahlungsdaten per E-Mail; der Zahlungseingang wird automatisch bestätigt.</p>':''}
        ${admin&&data.paymentMethod==='invoice'&&data.combinedPayment&&data.balance?.openCents>0&&!data.cancelled?'<button class="btn btn-outline-primary mb-3" data-invoice-action="rent-banktransfer">Mollie-Überweisung vorbereiten / erneut prüfen</button>':''}
        ${data.combinedPayment?`<p><strong>Zahlungsstatus:</strong> ${invoiceEscape(({paid:'Bezahlt',pending:'Ausstehend',cancelled:'Abgebrochen',failed:'Fehlgeschlagen',expired:'Verfallen',charged_back:'Zurückgebucht',refund_pending:'Erstattung ausstehend',refunded:'Erstattet'})[data.paymentStatus]||'Wird geprüft')}</p>`:''}
        ${d?`<p><strong>Kaution:</strong> ${invoiceMoney(d.amount)} · ${d.status==='paid'?'Bezahlt':'Noch nicht bezahlt'}</p>`:''}
        ${admin&&openDeposit?`<p class="small">Die Kaution muss vor Abholung bezahlt sein. Der Mietbetrag kann innerhalb des Zahlungsziels bezahlt werden.</p><div class="d-flex flex-wrap gap-2"><button class="btn btn-primary" data-invoice-action="online">Kaution online bezahlen</button><button class="btn btn-outline-primary" data-invoice-action="banktransfer">Kaution überweisen</button>${admin?'<button class="btn btn-outline-primary" data-invoice-action="cash">Kaution bar erfassen</button><select class="form-select" aria-label="Terminal für Kaution" data-invoice-terminal></select><button class="btn btn-outline-primary" data-invoice-action="pos">Kaution per Karte vor Ort</button>':''}</div>`:''}
        ${admin&&safeInvoiceLink(data.simulationUrl)?`<a class="mt-2" href="${invoiceEscape(safeInvoiceLink(data.simulationUrl))}" target="_blank" rel="noopener">Mollie-Testzahlung simulieren</a>`:''}
        ${admin&&i.lastError?`<p class="text-danger">${invoiceEscape(i.lastError)}</p>`:''}<p role="status" class="mt-2 mb-0" data-invoice-message></p>`;
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
async function renderInvoiceArchive(admin=false){
 const container=document.getElementById(admin?'adminInvoiceList':'customerInvoices');
 container.innerHTML='<label class="form-label w-100">Rechnungen durchsuchen<input class="form-control" type="search" maxlength="200" placeholder="Nummer, Datum, Betrag, Kunde, Artikel …" data-archive-search></label><div data-archive-results aria-live="polite"></div>';
 const input=container.querySelector('input'),results=container.querySelector('[data-archive-results]');let timer,revision=0;
 async function load(page=1){const current=++revision;try{const data=await invoiceFetch((admin?'/admin/invoices':'/my-invoices')+'?q='+encodeURIComponent(input.value)+'&page='+page);if(current!==revision)return;
 results.innerHTML=data.items.map(i=>{const base=(admin?'/admin/orders/':'/my-orders/')+Number(i.orderId)+'/invoice'+(i.legacy?'':'/documents/'+Number(i.id));return '<article class="card p-3 mb-3"><h3 class="h5">'+invoiceEscape(i.invoiceNumber)+'</h3><p>'+invoiceEscape(new Date(i.createdAt).toLocaleDateString('de-DE'))+' · '+invoiceMoney(i.amount)+' · '+invoiceEscape(i.kind==='credit'?'Rechnungskorrektur':invoiceLabels[i.status]||i.status)+'</p>'+(Number(i.depositAmount)>0?'<p class="small">Kaution: '+invoiceMoney(i.depositAmount)+' · Gesamtzahlung: '+invoiceMoney(Number(i.amount)+Number(i.depositAmount))+'</p>':'')+'<p>'+invoiceEscape(i.orderNo)+(admin?' · '+invoiceEscape(i.customerName)+' · '+invoiceEscape(i.company||i.email):'')+'</p><div class="d-flex flex-wrap gap-2"><a class="btn btn-outline-primary" href="'+base+'/pdf">PDF herunterladen</a>'+(i.hasXml?'<a class="btn btn-outline-primary" href="'+base+'/xml">E-Rechnung (XML)</a>':'')+'</div></article>';}).join('')||'<p>Keine Rechnungen gefunden.</p>';
 const footer=document.createElement('div');footer.className='d-flex gap-2 align-items-center flex-wrap';footer.innerHTML='<button class="btn btn-outline-primary" data-archive-page="'+(page-1)+'" '+(page<=1?'disabled':'')+'>Zurück</button><span>'+data.total+' Belege · Seite '+page+' / '+data.totalPages+'</span><button class="btn btn-outline-primary" data-archive-page="'+(page+1)+'" '+(page>=data.totalPages?'disabled':'')+'>Weiter</button>';results.append(footer);
 }catch(e){if(current===revision)results.textContent=e.message;}}
 input.addEventListener('input',()=>{clearTimeout(timer);revision++;timer=setTimeout(()=>load(),250);});
 results.addEventListener('click',event=>{const b=event.target.closest('[data-archive-page]');if(b)load(Number(b.dataset.archivePage));});await load();
}
async function loadCustomerInvoices(){return renderInvoiceArchive(false);}
async function renderAdminInvoice(order){
    const body=document.getElementById('orderDetailsBody');if(!body)return;
    body.querySelector('[data-admin-invoice]')?.remove();
    const card=document.createElement('section');card.className='card p-3 mb-3';card.dataset.adminInvoice='1';body.prepend(card);
    try{await invoiceCard(card,order.id,true);}catch(e){card.textContent=e.message;}
}
async function loadAdminInvoiceList(){return renderInvoiceArchive(true);}

document.addEventListener('click',async event=>{const button=event.target.closest('[data-transfer-order]');if(!button||button.disabled)return;if(!await showConfirm('Miete und Kaution gemeinsam mit 14 Tagen Zahlungsziel berechnen? Die Abholung ist vor Zahlung erlaubt.','Kauf auf Rechnung'))return;button.disabled=true;try{await invoiceFetch('/admin/orders/'+Number(button.dataset.transferOrder)+'/invoice/offer-transfer','POST',{});await openOrderDetails(Number(button.dataset.transferOrder));}catch(e){showAlert(e.message,'danger');}finally{button.disabled=false;}});
