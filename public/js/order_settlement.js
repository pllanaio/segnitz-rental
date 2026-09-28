'use strict';

// Calculate the balance from actual receipts, never from failed or replaced attempts.
// Deposits still held are a liability; returned deposits are not a rental expense.
function orderSettlement(order) {
    const cents = value => Math.round(Number(value || 0) * 100);
    const day = value => Date.parse(String(value || '').slice(0, 10));
    const days = (start, end) => Math.max(1, Math.round((day(end) - day(start)) / 86400000) + 1) || 1;
    const lines = [];
    let costs = 0, held = 0, deposit = 0, retained = 0, returnedCount = 0;
    const items = (order.items || []).filter(item => (item.itemStatus || item.item_status) !== 'cancelled');
    const add = (item, label, reason, amount) => { lines.push({item: item.title, label, reason, amount}); costs += amount; };
    for (const item of items) {
        const originalDays = days(item.rentalStart, item.rentalEnd);
        const start = item.adjustedRentalStart || item.rentalStart, end = item.adjustedRentalEnd || item.rentalEnd;
        const rate = cents(item.adjustedPricePerDay ?? item.pricePerDay);
        const original = Math.max(0, originalDays * cents(item.pricePerDay) - cents(item.discountAmount));
        const rental = item.adjustedRentalTotal != null ? cents(item.adjustedRentalTotal) : Math.max(0, days(start, end) * rate - cents(item.discountAmount));
        add(item, 'Ursprüngliche Miete', originalDays + ' Miettage · inkl. MwSt.' + (Number(item.discountAmount) ? ' · Gutschein berücksichtigt' : ''), original);
        if (rental !== original) add(item, rental > original ? 'Mietverlängerung / Mietanpassung' : 'Mietkorrektur', 'Abgerechneter Mietzeitraum: ' + start + ' – ' + end, rental - original);
        const returned = String(item.itemStatus || '').startsWith('returned_') || Boolean(item.returnedAt);
        deposit += cents(item.deposit);
        if (!returned) { held += cents(item.deposit); continue; }
        returnedCount++;
        retained += cents(item.depositDeductionAmount ?? Math.max(Number(item.deposit || 0) - Number(item.depositRefundAmount || 0), 0));
        const lateDays = Math.max(0, Math.round((day(item.actualReturnDate) - day(end)) / 86400000)) || 0;
        if (lateDays) add(item, 'Verspätete Rückgabe', lateDays + ' Tage × ' + (rate / 100).toLocaleString('de-DE', {style:'currency',currency:'EUR'}) + (item.lateDescription ? ' · ' + item.lateDescription : ''), lateDays * rate);
        if (Number(item.additionalChargeAmount)) add(item, 'Reparatur / weitere Kosten', item.additionalChargeReason || item.damageDescription || 'Keine Begründung hinterlegt', cents(item.additionalChargeAmount));
    }
    let paid = 0, refunded = 0;
    const incomeTypes = ['initial_payment','invoice_payment','rental','deposit','rental_adjustment','return_additional_charge'];
    const refundTypes = ['deposit_refund','rental_refund','order_cancellation_refund','duplicate_payment_refund','refund_record','chargeback'];
    for (const payment of visibleOrderPayments(order)) {
        if (!['paid','refunded'].includes(payment.paymentStatus)) continue;
        if (incomeTypes.includes(payment.paymentType)) paid += Math.abs(cents(payment.amount));
        if (refundTypes.includes(payment.paymentType)) refunded += Math.abs(cents(payment.amount));
    }
    return {lines,costs,held,deposit,retained,paid,refunded,balance:costs+held-paid+refunded,complete:items.length===returnedCount};
}

function renderClearOrderCalculation(order) {
    const s = orderSettlement(order), esc = invoiceEscape, money = cents => invoiceMoney(cents / 100);
    const result = s.balance < 0 ? 'Noch an den Kunden zu erstatten' : s.balance > 0 ? 'Noch vom Kunden zu zahlen' : 'Aktuell vollständig ausgeglichen';
    const row = (label, amount) => '<div class="settlement-total-row"><span>'+label+'</span><strong>'+money(amount)+'</strong></div>';
    return `<section class="order-sheet-section order-settlement"><h3>Preisberechnung im Detail</h3>
        <div class="settlement-result ${s.balance<0?'is-credit':s.balance>0?'is-due':''}"><span>${result}</span><strong>${money(Math.abs(s.balance))}</strong><small>${s.complete?'Abrechnung nach Rückgabe':'Zwischenstand · Endabrechnung nach Rückgabe aller Artikel'}</small></div>
        <div class="order-sheet-table-wrap"><table class="order-sheet-table settlement-costs"><thead><tr><th>Kosten & Begründung</th><th>Betrag</th></tr></thead><tbody>${s.lines.map(line=>'<tr><td><strong>'+esc(line.label)+'</strong><small>'+esc(line.item)+'</small><small>'+esc(line.reason)+'</small></td><td>'+money(line.amount)+'</td></tr>').join('') || '<tr><td colspan="2">Keine verbleibenden Mietpositionen.</td></tr>'}</tbody></table></div>
        <div class="settlement-totals">${row('Miete und Mehrkosten insgesamt',s.costs)}${row('Bereits eingegangene Zahlungen inkl. Kaution',s.paid)}${s.refunded?row('Bereits zurückerstattet',s.refunded):''}${row('Noch gebundene Kaution',s.held)}</div>
        ${s.deposit?'<div class="settlement-deposit"><strong>Kaution: '+money(s.deposit)+'</strong><p>'+money(s.retained)+' mit Kosten verrechnet · '+money(s.held)+' noch bis zur Rückgabe gebunden.</p><small>Die Verrechnung mit der Kaution ist keine zusätzliche Gebühr. Sie ist in der Abrechnung oben bereits berücksichtigt.</small></div>':''}
        <p class="settlement-note">Berücksichtigt werden bestätigte Zahlungen und Erstattungen. Fehlgeschlagene Zahlungsversuche zählen nicht als Zahlung. Der Saldo zeigt die noch offene Differenz.</p>
        </section>`;
}

function renderOrderReturnProtocol(order, admin) {
    const esc = invoiceEscape;
    const date = value => value ? new Date(String(value).replace(' ','T')).toLocaleDateString('de-DE') : 'Nicht hinterlegt';
    const returned = (order.items || []).filter(item=>item.returnedAt || String(item.itemStatus||'').startsWith('returned_'));
    return '<section class="order-sheet-section order-return-protocol"><h3>Rückgabeprotokoll</h3>'+(!returned.length?'<p class="settlement-note">Noch kein Rückgabeprotokoll vorhanden. Es erscheint hier, sobald eine Rückgabe erfasst wurde.</p>':returned.map(item=>{
        const status = ({returned_ok:'Ordnungsgemäß zurückgegeben',returned_late:'Verspätet zurückgegeben',returned_damaged:'Beschädigt zurückgegeben',returned_late_damaged:'Verspätet und beschädigt'})[item.itemStatus] || 'Rückgabe erfasst';
        const note = (label, value) => value ? '<div><dt>'+label+'</dt><dd>'+esc(value)+'</dd></div>' : '';
        return '<article class="return-protocol-card"><header><strong>'+esc(item.title)+'</strong><span>'+esc(status)+'</span></header><dl>'+note('Geplante Rückgabe',date(item.adjustedRentalEnd||item.rentalEnd))+note('Tatsächliche Rückgabe',date(item.actualReturnDate))+note('Erfasst am',date(item.returnedAt))+note('Schäden',item.damageDescription)+note('Verspätung',item.lateDescription)+note('Begründung der Mehrkosten',item.additionalChargeReason)+note('Kautionsverrechnung',item.depositDeductionReason)+note('Bemerkungen',item.returnNotes)+'</dl><div class="return-protocol-photos">'+(item.returnImages||[]).map(photo=>{
            const path=String(photo.imagePath||'').replace(/^\//,'');
            if(!path || path.includes(':') || path.startsWith('/'))return '';
            return '<div><a href="/'+esc(path)+'" target="_blank" rel="noopener"><img src="/'+esc(path)+'" alt="Rückgabefoto '+esc(item.title)+'"></a>'+(admin&&typeof isReturnFinalized==='function'&&!isReturnFinalized(item)?'<button class="btn btn-outline-danger btn-sm" data-backend-action="delete-return-image" data-image-id="'+Number(photo.id)+'" data-order-id="'+Number(order.id)+'">Foto löschen</button>':'')+'</div>';
        }).join('')+'</div></article>';
    }).join(''))+'</section>';
}
