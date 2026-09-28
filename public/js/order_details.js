'use strict';
function visibleOrderPayments(order){
    const rows=order.payments||[];
    const full=rows.filter(p=>['initial_payment','invoice_payment'].includes(p.paymentType));
    return rows.filter(p=>{
        if(p.paymentStatus==='replaced'&&p.paymentMethod==='invoice'&&!p.providerPaymentKey)return false;
        if(!['rental','deposit'].includes(p.paymentType))return true;
        if(order.payment_method==='invoice'&&!order.invoice_combined_payment)return true;
        return !full.some(f=>
            (p.providerPaymentKey&&p.providerPaymentKey===f.providerPaymentKey)||
            (/anteil/i.test(p.note||'')&&Number(order.invoice_combined_payment)===1)||
            (p.paymentStatus==='paid'&&f.paymentStatus==='paid'&&p.paymentMethod===f.paymentMethod));
    }).filter((p,index,all)=>!p.providerPaymentKey||!['initial_payment','invoice_payment'].includes(p.paymentType)||!all.some(other=>other.providerPaymentKey===p.providerPaymentKey&&['initial_payment','invoice_payment'].includes(other.paymentType)&&Number(other.id)>Number(p.id)));
}
function orderStateTone(status){
    if(['paid','completed','returned','picked_up'].includes(status))return 'is-paid';
    if(['failed','charged_back','payment_reversed','overdue'].includes(status))return 'is-failed';
    if(['cancelled','expired','replaced','refunded'].includes(status))return 'is-cancelled';
    return '';
}
function paymentStatusLabel(status){return ({paid:'Bezahlt',unpaid:'Ausstehend',pending:'Ausstehend',open:'Ausstehend',authorized:'Autorisiert',failed:'Fehlgeschlagen',cancelled:'Abgebrochen',expired:'Abgelaufen',refunded:'Erstattet',refund_pending:'Erstattung ausstehend',refund_failed:'Erstattung fehlgeschlagen',charged_back:'Rückbelastet',offset:'Verrechnet',replaced:'Ersetzt'})[status]||'Wird geprüft';}
// One presentation for both roles; existing action renderers retain authorization and lifecycle rules.
function renderOrderDetailSheet(body, order, options) {
    const esc = invoiceEscape, money = invoiceMoney;
    const date = value => value ? new Date(String(value).replace(' ', 'T')).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}) : '–';
    const stamp = value => value ? new Date(String(value).replace(' ', 'T')).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})+' Uhr' : '–';
    const items = order.items || [], admin = options.admin;
    const picked = items.map(i => i.pickedUpAt).filter(Boolean).sort()[0];
    const ends = items.filter(i => i.itemStatus !== 'cancelled').map(i => i.adjustedRentalEnd || i.rentalEnd).filter(Boolean).sort();
    const modal = body.closest('.modal');
    modal.classList.add('order-sheet-modal');
    modal.querySelector('.modal-title').textContent = 'Bestellung ' + order.order_no;
    body.className = 'modal-body order-sheet';
    const signed = admin ? order.handoverStatus === 'signed' : order.handoverAvailable;
    const handoverUrl = (admin ? '/admin/orders/' : '/my-orders/') + Number(order.id) + '/handover/pdf';
    const handover = admin
        ? '<button class="btn btn-outline-primary order-handover" data-handover-order="'+Number(order.id)+'"><i class="bi bi-file-earmark-text"></i> Übergabeprotokoll '+(signed?'ansehen':'erstellen')+'</button>'
        : '<button type="button" class="btn btn-outline-primary order-handover" '+(signed?'data-handover-order="'+Number(order.id)+'" data-handover-customer="true"':'disabled')+'><i class="bi bi-file-earmark-text"></i> Übergabeprotokoll ansehen</button>';

    body.innerHTML = `<div class="order-sheet-status"><span class="${orderStateTone(order.status)}"><i class="bi bi-truck" aria-hidden="true"></i> ${options.status}</span> <span class="${orderStateTone(order.payment_status)}"><i class="bi bi-clock" aria-hidden="true"></i> ${getPaymentBadge(order.payment_status)}</span></div>
        <div class="order-sheet-parties"><div><span class="order-sheet-label">Kunde</span><div class="order-sheet-customer"><i class="bi bi-person-fill" aria-hidden="true"></i><div><strong>${esc(order.customer_first_name)} ${esc(order.customer_last_name)}</strong>${order.customer_company?'<div>'+esc(order.customer_company)+'</div>':''}<div>${esc(order.customer_address)}</div><div>${esc(order.customer_zip)} ${esc(order.customer_city)}</div><div>${esc(order.customer_email)}</div><div>${esc(order.customer_phone)}</div></div></div></div>
        <dl><dt>Auftragsnummer</dt><dd>${esc(order.order_no)}</dd><dt>Bestelldatum</dt><dd>${date(order.created_at)}</dd><dt>Abholung am</dt><dd>${picked?stamp(picked):'Noch nicht abgeholt'}</dd><dt>Rückgabe geplant</dt><dd>${date(ends.at(-1))}</dd></dl></div>
        <div class="order-sheet-actions">${options.cancel || ''}${handover}</div>
        ${order.status==='cancelled'?'<p class="alert alert-danger">Storniert'+(order.cancelled_at?' am '+date(order.cancelled_at):'')+(order.cancel_reason?' · '+esc(order.cancel_reason):'')+'</p>':''}
        <section class="order-sheet-section"><h3>Zahlungen</h3><div data-sheet-payments></div></section>
        <section class="order-sheet-section"><h3>Artikel</h3><div class="order-sheet-table-wrap"><table class="order-sheet-table"><thead><tr><th>Artikel</th><th>Zeitraum</th><th>Tagespreis / Kaution</th><th>Gesamt inkl. Kaution</th></tr></thead><tbody>${items.map((item,index)=>{
            const f=calculateOrderItemFinancials(item);
            const image = String(item.imagePath||'').replace(/^\//,'');
            return '<tr class="'+(item.itemStatus==='cancelled'?'order-sheet-item-cancelled':'')+'"><td><div class="order-sheet-product">'+(image&&!image.includes(':')?'<img src="/'+esc(image)+'" alt="">':'<i class="bi bi-box-seam" aria-hidden="true"></i>')+'<div><strong class="order-sheet-product-title">'+esc(item.title)+'</strong>'+(item.itemStatus==='cancelled'?'<small class="text-danger">Storniert</small>':item.itemStatus==='picked_up'?'<small>Abgeholt</small>':'')+'<small>'+esc([item.manufacturer,item.model].filter(v=>v&&v!=='n.V.').join(' '))+'</small><small>Art.-Nr. '+esc(item.productKey||item.productId)+'</small></div></div></td><td>'+date(item.adjustedRentalStart||item.rentalStart)+' – '+date(item.adjustedRentalEnd||item.rentalEnd)+'</td><td>'+money(f.pricePerDay)+'<small>Kaution: '+money(f.deposit)+'</small></td><td><strong>'+money(f.grossTotalWithDeposit)+'</strong></td></tr>';
        }).join('')}</tbody></table></div></section>
        <section class="order-sheet-section order-sheet-documents"><h3>Dokumente</h3><div class="order-sheet-document-head"><span>Name</span><span>Erstellt am</span><span>Aktion</span></div>${signed?'<div class="order-sheet-document"><span><i class="bi bi-file-earmark-text"></i> Übergabeprotokoll</span><span>'+stamp(order.handoverSignedAt)+'</span><a class="btn btn-outline-primary btn-sm" href="'+handoverUrl+'" target="_blank" rel="noopener"><i class="bi bi-download"></i> PDF</a></div>':''}<div data-sheet-invoices></div></section>
        ${renderClearOrderCalculation(order)}${renderOrderReturnProtocol(order,admin)}${options.reviews||''}`;
    const actions=body.querySelector('.order-sheet-actions');
    (options.itemCards||[]).forEach((html,index)=>{
        const source=document.createElement('div');source.innerHTML=html;
        const state=items[index].itemStatus||items[index].item_status||'active';
        source.querySelectorAll('[data-backend-action]').forEach(button=>{
            const action=button.dataset.backendAction;
            if(!['mark-item-picked-up','open-rental-period','open-return-item','open-cancel-item'].includes(action))return;
            const show=admin&&((action==='mark-item-picked-up'&&state==='active')||(['open-rental-period','open-return-item'].includes(action)&&state==='picked_up')||(action==='open-cancel-item'&&state==='active'&&items.length>1));
            if(show){
                if(action==='mark-item-picked-up'){button.classList.add('order-sheet-pickup');if(button.disabled)button.title='Erst nach festgeschriebenem Übergabeprotokoll und erfüllter Zahlungsbedingung möglich.';}
                if(items.length>1)button.textContent=button.textContent.trim()+' · '+items[index].title;
                actions.append(button);
            }else button.remove();
        });

    });
    compactSheetCalculations(body);
    renderSheetPayments(body.querySelector('[data-sheet-payments]'), order, options.paymentActions, admin);
    const docs=body.querySelector('[data-sheet-invoices]');
    invoiceCard(docs,order.id,admin).catch(()=>{docs.textContent='Rechnungen konnten gerade nicht geladen werden.';});
}

function renderSheetPayments(container, order, actionHtml, admin) {
    const labels={initial_payment:'Miete & Kaution',rental:'Miete',deposit:'Kaution',invoice_payment:'Miete & Kaution',rental_adjustment:'Mietverlängerung',return_additional_charge:'Rückgabe-Nachzahlung',deposit_refund:'Kautionsrückerstattung',rental_refund:'Mieterstattung',order_cancellation_refund:'Stornoerstattung',duplicate_payment_refund:'Erstattung Doppelzahlung',refund_record:'Mollie-Erstattung',chargeback:'Rückbelastung'};

    const source=document.createElement('div');source.innerHTML=actionHtml||'';
    const actions=[...source.querySelectorAll('.cash-action-row')];
    const combined=order.invoice_combined_payment===1||order.invoice_combined_payment===true;
    const payments=visibleOrderPayments(order).sort((a,b)=>{
        const priority=p=>['initial_payment','invoice_payment','rental','deposit'].includes(p.paymentType)?0:1;
        return priority(a)-priority(b)||Number(a.id)-Number(b.id);
    });
    const rental=payments.find(p=>p.paymentType==='rental'&&!p.orderItemId),deposit=payments.find(p=>p.paymentType==='deposit'&&!p.orderItemId);
    if(rental&&deposit&&rental.paymentMethod===deposit.paymentMethod&&rental.paymentStatus===deposit.paymentStatus&&!payments.some(p=>p.paymentType==='initial_payment')){
        payments.splice(payments.indexOf(deposit),1);
        payments.splice(payments.indexOf(rental),1,{...rental,paymentType:'initial_payment',amount:Number(rental.amount)+Number(deposit.amount)});
    }
    container.innerHTML='<div class="order-sheet-table-wrap"><table class="order-sheet-table"><thead><tr><th>Position</th><th>Betrag</th><th>Status</th><th>Aktion</th></tr></thead><tbody></tbody></table></div>';
    const tbody=container.querySelector('tbody');
    payments.forEach(p=>{
        const tr=document.createElement('tr');
        const isOpen=['pending','open'].includes(p.paymentStatus);
        const dueDays=p.invoiceDueAt?Math.ceil((new Date(String(p.invoiceDueAt).slice(0,10)+'T00:00:00')-new Date())/86400000):null;
        const statusText=paymentStatusLabel(p.paymentStatus);
        const latest=!payments.some(other=>other.paymentType===p.paymentType&&String(other.orderItemId||'')===String(p.orderItemId||'')&&Number(other.id)>Number(p.id));
        const matching=latest?actions.filter(a=>[...a.querySelectorAll('[data-payment-type],[data-pos-type],[data-payment-id]')].some(b=>(b.dataset.paymentId===String(p.id))||((b.dataset.paymentType||b.dataset.posType)===p.paymentType&&String(b.dataset.itemId||b.dataset.posItem||'')===String(p.orderItemId||'')))):[];
        const tone=orderStateTone(p.paymentStatus);tr.className='order-payment-row '+tone;
        tr.innerHTML='<td>'+invoiceEscape(labels[p.paymentType]||'Zahlung')+'<small>'+invoiceEscape(p.createdAt?new Date(p.createdAt).toLocaleString('de-DE'):'')+'</small>'+(['failed','cancelled','expired','replaced'].includes(p.paymentStatus)?'<small>Vorheriger Zahlungsversuch</small>':'')+'</td><td>'+invoiceMoney(p.amount)+'</td><td><span class="order-sheet-payment-status '+(tone|| (dueDays<0&&isOpen?'is-failed':''))+'">'+invoiceEscape(statusText)+'</span>'+(isOpen&&dueDays!==null?'<small>'+invoiceEscape(dueDays<0?'Überfällig':dueDays===0?'Heute fällig':'Fällig in '+dueDays+' Tagen')+'</small>':'')+'</td><td></td>';
        if(matching.length){const detail=document.createElement('details');detail.className='order-sheet-payment-actions';detail.innerHTML='<summary>Zahlungsdetails</summary><div class="order-sheet-action-options"></div>';matching.forEach(a=>{detail.lastElementChild.append(a);actions.splice(actions.indexOf(a),1);});if(isOpen){detail.classList.add('is-payable');detail.querySelector('summary').textContent='Jetzt bezahlen';}tr.lastElementChild.append(detail);}
        else tr.lastElementChild.innerHTML='<details class="order-sheet-payment-actions"><summary>Zahlungsdetails</summary><div class="order-sheet-action-options">'+invoiceEscape(({cash:'Barzahlung',online:'Mollie',invoice:'Überweisung'})[p.paymentMethod]||'Zahlung')+' · '+invoiceEscape(paymentStatusLabel(p.paymentStatus))+(p.paidAt?'<br>Bezahlt am '+invoiceEscape(new Date(p.paidAt).toLocaleDateString('de-DE')):'')+'</div></details>';
        tbody.append(tr);
    });
    actions.forEach(a=>{const tr=document.createElement('tr');tr.innerHTML='<td>'+invoiceEscape(a.querySelector('.cash-action-title')?.textContent||'Zahlung')+'</td><td>–</td><td>Aktion erforderlich</td><td><details class="order-sheet-payment-actions"><summary>Zahlungsdetails</summary><div class="order-sheet-action-options"></div></details></td>';tr.querySelector('.order-sheet-action-options').append(a);tbody.append(tr);});
    if(!payments.length&&!actions.length)tbody.innerHTML='<tr><td colspan="4">Noch keine Zahlungsvorgänge vorhanden.</td></tr>';
    if(admin){const refresh=document.createElement('button');refresh.className='btn btn-link btn-sm order-sheet-sync';refresh.dataset.backendAction='open-order-details';refresh.dataset.orderId=order.id;refresh.textContent='Mit Mollie abgleichen';container.append(refresh);}
}

function styleOrderSheetDocuments(docs,admin){
        docs.querySelector('h3')?.remove();
        const rows=docs.querySelector('.invoice-documents');
        if(rows){
            rows.classList.add('order-sheet-invoice-rows');
            rows.querySelectorAll('.invoice-document').forEach(row=>{
                const amount=row.querySelector('.invoice-document-amount'),status=row.querySelector('.invoice-status');
                const detail=document.createElement('small');detail.textContent=amount.textContent+' · '+status.textContent;
                row.title=detail.textContent;amount.remove();row.querySelector('.invoice-document-name>div').append(status);
            });
        }

}

function compactSheetCalculations(body){
    body.querySelectorAll('.admin-price-panel').forEach(panel=>{
        panel.classList.add('order-sheet-calculation-table');
        const table=document.createElement('table');table.className='order-sheet-table';
        const rows=[...panel.querySelectorAll(':scope > .checkout-summary-row,:scope > .checkout-summary-total-row')];
        if(!rows.length)return;
        const tbody=document.createElement('tbody');table.append(tbody);
        rows.forEach(row=>{const tr=document.createElement('tr');[...row.children].forEach(child=>{const td=document.createElement('td');td.append(child);tr.append(td);});tbody.append(tr);row.remove();});
        panel.append(table);
    });
}

function renderOrderOverview(order, admin) { return `
            <div class="card-body">
                <div class="order-overview-layout">
                    <div>
                        <h3 class="h5 mb-2">${escapeHtml(order.order_no)}</h3><div class="small text-muted mb-2">Bestellt am ${escapeHtml(order.created_at ? new Date(order.created_at.replace(' ','T')).toLocaleDateString('de-DE') : '–')} · ${(order.items || []).length} Artikel</div>
                        <div>${escapeHtml(order.customer_first_name || '')} ${escapeHtml(order.customer_last_name || '')}</div>
                        ${order.customer_company ? `<div class="small text-muted">${escapeHtml(order.customer_company)}</div>` : ''}
                        <small>${escapeHtml(order.customer_email || '')}</small><br>
                        ${admin ? getOrderDisplayBadge(order) : getStatusBadge(order.status)}
                        ${getPaymentBadge(order.payment_status)}
                        ${getReturnBadge(admin ? order.return_status : deriveMyOrderReturnStatus(order), order.status)}
                        ${getReturnCaseBadge(order.return_case_status, order.status)}
                    </div>

                    <div class="d-flex flex-wrap gap-2">${order.hasInvoice?`<a class="btn btn-outline-primary btn-sm" href="/${admin ? "admin/orders" : "my-orders"}/${Number(order.id)}/invoice/pdf">Rechnung</a>`:''}<button class="btn btn-primary btn-sm"
                        data-${admin ? "backend" : "profile"}-action="open-order-details" data-order-id="${order.id}">
                        Bestellung öffnen
                    </button></div>
                </div>
            </div>
        `; }
