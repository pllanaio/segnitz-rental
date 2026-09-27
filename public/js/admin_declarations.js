'use strict';
async function loadContractDeclarations() {
    const list = document.getElementById('declarationsList');
    list.textContent = 'Vorgänge werden geladen …';
    try {
        const response = await fetch('/admin/contract-declarations');
        if (!response.ok) throw new Error('Vorgänge konnten nicht geladen werden.');
        const { items } = await response.json();
        list.innerHTML = items.length ? items.map(item => `
            <article class="border rounded p-3 mb-3">
                <h3 class="h5">${item.kind === 'withdrawal' ? 'Widerruf' : 'Stornierung'} · ${escapeHtml(item.contract_reference)}</h3>
                <p><span class="badge ${item.processing_status === 'received' ? 'bg-warning text-dark' : 'bg-success'}">${item.processing_status === 'received' ? 'Offen' : 'Bearbeitung dokumentiert'}</span></p>
                <p>${escapeHtml(item.customer_name)} · ${escapeHtml(item.customer_email)}<br>Eingang: ${escapeHtml(new Date(item.receivedAt).toLocaleString('de-DE'))}</p>
                <p class="text-break">${escapeHtml(item.declaration_text)}</p>
                ${item.order_id ? `<button type="button" class="btn btn-outline-primary mb-2" data-backend-action="open-order-details" data-order-id="${Number(item.order_id)}">Bestellung öffnen</button>` : '<p class="text-danger">Keine automatische Zuordnung. Bitte anhand der Erklärung prüfen.</p>'}
                ${item.processing_note ? `<p>Bearbeitung: ${escapeHtml(item.processing_note)}</p>` : ''}
                ${item.processing_status === 'received' ? `<label class="form-label d-block" for="note-${escapeHtml(item.id)}">Erledigte Schritte</label><textarea class="form-control mb-2" id="note-${escapeHtml(item.id)}" maxlength="2000" rows="2"></textarea><button type="button" class="btn btn-primary" data-declaration-processed="${escapeHtml(item.id)}">Als bearbeitet dokumentieren</button>` : ''}
            </article>`).join('') : '<p>Keine Vorgänge vorhanden.</p>';
    } catch (error) { list.textContent = error.message; }
}
document.getElementById('reloadDeclarations')?.addEventListener('click', loadContractDeclarations);
document.getElementById('declarationsList')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-declaration-processed]');
    if (!button || button.disabled) return;
    const id = button.dataset.declarationProcessed;
    const note = document.getElementById(`note-${id}`).value.trim();
    if (!note) { showAlert('Bitte die erledigten Schritte dokumentieren.', 'warning'); return; }
    button.disabled = true;
    try {
        const response = await fetch(`/admin/contract-declarations/${encodeURIComponent(id)}/processed`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Bearbeitung konnte nicht gespeichert werden.');
        await loadContractDeclarations();
    } catch (error) { showAlert(error.message, 'danger'); button.disabled = false; }
});
