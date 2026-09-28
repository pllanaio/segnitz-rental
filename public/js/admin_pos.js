'use strict';
let posTerminals = [];
let posPaymentContext = null;
let posPollTimer = null;
let posRequestBusy = false;
const posStatusLabels = { active: 'Bei Mollie aktiviert', pending: 'Aktivierung ausstehend', inactive: 'Bei Mollie deaktiviert', unavailable: 'Nicht mehr im Zahlungsprofil verfügbar' };
async function posRequest(url, method = 'GET', body) {
    const response = await fetch(url, { method, cache: 'no-store', headers: method === 'GET' ? {} : await getAdminCsrfHeaders({ 'Content-Type': 'application/json' }), ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'POS-Anfrage fehlgeschlagen.');
    return result;
}
async function loadPosTerminals() {
    const list = document.getElementById('posTerminalList');
    list.textContent = 'Geräte werden bei Mollie geladen …';
    try {
        const result = await posRequest('/admin/pos/terminals');
        posTerminals = result.items;
        document.getElementById('posMode').textContent = result.mode === 'test' ? 'Testmodus · keine echten Zahlungen' : 'Live-Modus';
        list.innerHTML = posTerminals.length ? posTerminals.map(terminal => `<form class="card mb-3" data-pos-settings="${escapeHtml(terminal.id)}"><div class="card-body">
            <h3 class="h5">${escapeHtml(terminal.label || terminal.description)}</h3><p class="text-break mb-2">${escapeHtml(terminal.id)}</p>
            <span class="badge ${terminal.status === 'active' ? 'bg-success' : 'bg-secondary'}">${escapeHtml(posStatusLabels[terminal.status] || terminal.status)}</span>
            <div class="row g-3 mt-1"><div class="col-md-6"><label class="form-label">Name in Segnitz Rental<input name="label" class="form-control" maxlength="120" value="${escapeHtml(terminal.label)}" placeholder="z. B. Leons iPhone"></label></div>
            <div class="col-md-6"><label class="form-label">Standort / Zuordnung<input name="location" class="form-control" maxlength="160" value="${escapeHtml(terminal.location)}" placeholder="z. B. Abholung oder Fahrzeug 1"></label></div></div>
            <label class="form-check my-3"><input name="enabled" type="checkbox" class="form-check-input" ${terminal.enabled ? 'checked' : ''}><span class="form-check-label">Bei uns zum Kassieren freigegeben</span></label>
            <button class="btn btn-primary" type="submit" ${terminal.status === 'unavailable' ? 'disabled' : ''}>Einstellungen speichern</button>
        </div></form>`).join('') : '<div class="alert alert-info">Keine Terminals in diesem Mollie-Zahlungsprofil gefunden. Bitte ein Tap-Gerät oder Testterminal bei Mollie einrichten.</div>';
    } catch (error) { list.textContent = error.message; }
}
document.getElementById('posRefresh').addEventListener('click', loadPosTerminals);
document.getElementById('posTerminalList').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const terminal = posTerminals.find(item => item.id === form.dataset.posSettings);
    if (!terminal) return;
    const button = form.querySelector('button'); button.disabled = true;
    try {
        await posRequest(`/admin/pos/terminals/${encodeURIComponent(terminal.id)}`, 'PUT', { label: form.elements.label.value, location: form.elements.location.value, enabled: form.elements.enabled.checked, revision: terminal.revision });
        await loadPosTerminals(); showAlert('Terminal-Einstellungen gespeichert.', 'success');
    } catch (error) { showAlert(error.message, 'danger'); } finally { button.disabled = false; }
});
document.addEventListener('click', async event => {
    const button = event.target.closest('[data-pos-order]');
    if (!button || posRequestBusy) return;
    clearTimeout(posPollTimer);
    posPaymentContext = { orderId: Number(button.dataset.posOrder), orderItemId: button.dataset.posItem ? Number(button.dataset.posItem) : null, paymentType: button.dataset.posType, recordId: button.dataset.posRecord || null };
    const context = posPaymentContext;
    const select = document.getElementById('posPaymentTerminal'); select.replaceChildren(); select.disabled = false;
    document.getElementById('posSimulation').classList.add('d-none');
    document.getElementById('posPaymentStart').classList.toggle('d-none', Boolean(context.recordId));
    document.getElementById('posPaymentStart').disabled = true;
    document.getElementById('posPaymentCheck').classList.toggle('d-none', !context.recordId);
    document.getElementById('posPaymentStatus').textContent = 'Zahlungsgeräte werden geladen …';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('posPaymentModal')).show();
    try {
        const result = await posRequest('/admin/pos/terminals');
        if (posPaymentContext !== context) return;
        const available = result.items.filter(item => item.enabled && item.status === 'active' && item.currency === 'EUR');
        for (const terminal of available) select.add(new Option(`${terminal.label || terminal.description}${terminal.location ? ` · ${terminal.location}` : ''} (${terminal.id})`, terminal.id));
        document.getElementById('posPaymentStatus').textContent = available.length ? 'Gerät auswählen und Zahlung starten.' : 'Kein freigegebenes Gerät verfügbar.';
        document.getElementById('posPaymentStart').disabled = !available.length;
        if (context.recordId) await checkPosPayment();
    } catch (error) { document.getElementById('posPaymentStatus').textContent = error.message; }
});
document.getElementById('posPaymentModal').addEventListener('hidden.bs.modal', () => { clearTimeout(posPollTimer); posPaymentContext = null; });
document.getElementById('posPaymentStart').addEventListener('click', async () => {
    if (posRequestBusy || !posPaymentContext) return;
    const context = posPaymentContext;
    posRequestBusy = true; document.getElementById('posPaymentStart').disabled = true;
    try {
        const result = await posRequest('/admin/pos/payments', 'POST', { ...context, terminalId: document.getElementById('posPaymentTerminal').value });
        if (posPaymentContext !== context) return;
        context.recordId = result.recordId;
        document.getElementById('posPaymentTerminal').value = result.terminalId;
        document.getElementById('posPaymentStart').classList.add('d-none');
        document.getElementById('posPaymentCheck').classList.remove('d-none');
        document.getElementById('posPaymentTerminal').disabled = true;
        document.getElementById('posPaymentStatus').textContent = 'Zahlung wurde angefordert. Bitte Mollie Tap auf dem gewählten Gerät öffnen.';
    } catch (error) { document.getElementById('posPaymentStatus').textContent = error.message; }
    finally { posRequestBusy = false; document.getElementById('posPaymentStart').disabled = false; }
    if (posPaymentContext === context && context.recordId) await checkPosPayment();
});
async function checkPosPayment() {
    if (!posPaymentContext?.recordId || posRequestBusy) return;
    clearTimeout(posPollTimer);
    const context = posPaymentContext;
    posRequestBusy = true;
    try {
        const result = await posRequest(`/admin/pos/payments/${context.recordId}/sync`, 'POST');
        if (posPaymentContext !== context) return;
        document.getElementById('posPaymentTerminal').value = result.terminalId || document.getElementById('posPaymentTerminal').value;
        const labels = { paid: 'Zahlung von Mollie bestätigt.', failed: 'Zahlung fehlgeschlagen.', cancelled: 'Zahlung abgebrochen.', expired: 'Zahlung verfallen.', pending: 'Zahlung wird vorbereitet oder geprüft …', open: 'Zahlung wartet auf die Karte am Gerät …', authorized: 'Zahlung autorisiert; Abschluss wird geprüft …' };
        document.getElementById('posPaymentStatus').textContent = result.message || labels[result.status] || 'Zahlungsstatus wird geprüft …';
        const simulation = document.getElementById('posSimulation');
        if (result.simulationUrl) { simulation.href = result.simulationUrl; simulation.classList.remove('d-none'); }
        if (['paid', 'failed', 'cancelled', 'expired', 'refunded', 'charged_back'].includes(result.status)) {
            simulation.classList.add('d-none');
            const details = await posRequest(`/admin/orders/${context.orderId}`);
            renderOrderDetails(details); await loadOrders();
        } else posPollTimer = setTimeout(checkPosPayment, 5000);
    } catch (error) { if (posPaymentContext === context) document.getElementById('posPaymentStatus').textContent = 'Status momentan nicht abrufbar. Bitte erneut prüfen; keine weitere Zahlung starten.'; }
    finally { posRequestBusy = false; }
}
document.getElementById('posPaymentCheck').addEventListener('click', checkPosPayment);
