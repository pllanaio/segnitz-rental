'use strict';
(() => {
    let customerView = false, orderId, data, entries = [], signatureDrawn = false, busy = false, dirty = false;
    const shownModals = new WeakSet();
    document.addEventListener('shown.bs.modal', event => shownModals.add(event.target));
    document.addEventListener('show.bs.modal', event => shownModals.delete(event.target));
    document.addEventListener('hidden.bs.modal', event => shownModals.delete(event.target));
    const element = document.createElement('div');
    element.className = 'modal fade lifecycle-modal'; element.id = 'handoverModal'; element.tabIndex = -1;
    element.setAttribute('aria-labelledby', 'handoverTitle');
    element.innerHTML = `<div class="modal-dialog modal-dialog-scrollable"><div class="modal-content">
        <div class="modal-header"><h2 class="modal-title h5" id="handoverTitle">Übergabeprotokoll</h2><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Schließen"></button></div>
        <div class="modal-body"><p id="handoverStatus" role="status"></p><div id="handoverReadOnly"></div>
        <fieldset id="handoverFields"><h3 class="h5">1. Artikel gemeinsam prüfen</h3><p>Den Zustand gemeinsam mit dem Kunden vor der ersten Abholung prüfen. Alle Einträge und Fotos werden Bestandteil des unterschriebenen PDF-Protokolls.</p>
        <div class="alert alert-info" id="handoverItems"></div>
        <label class="form-check mb-3"><input type="checkbox" class="form-check-input" id="handoverNoDamage"> <span class="form-check-label">Keine Auffälligkeiten bei der gemeinsamen Prüfung festgestellt</span></label>
        <h3 class="h5">2. Zustand dokumentieren</h3><div id="handoverEntries"></div><button type="button" class="btn btn-outline-primary mb-4" id="handoverAdd">Eintrag hinzufügen</button>
        <div class="protocol-form-section"><h3 class="h5">3. Bestätigen & unterschreiben</h3><label for="handoverSigner" class="form-label">Name der unterschreibenden Person</label><input id="handoverSigner" class="form-control mb-3" maxlength="200" autocomplete="name">
        <label class="form-check mb-3"><input type="checkbox" class="form-check-input" id="handoverConfirmed"><span class="form-check-label" id="handoverConfirmation"></span></label>
        <p class="small text-muted">Bitte direkt auf dem Gerät unterschreiben. Änderungen am Protokoll löschen die Unterschrift und erfordern eine erneute Bestätigung.</p>
        <canvas id="handoverSignature" width="800" height="240" aria-label="Unterschriftenfeld für den Kunden" class="handover-signature"></canvas>
        <button type="button" id="handoverClear" class="btn btn-outline-secondary btn-sm mt-2">Unterschrift löschen</button></div></fieldset></div>
        <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Schließen</button><a id="handoverPdf" class="btn btn-primary d-none">PDF herunterladen</a><button type="button" class="btn btn-outline-primary" id="handoverSave">Entwurf speichern</button><button type="button" class="btn btn-primary" id="handoverFinalize">Unterschrieben festschreiben & versenden</button></div>
        </div></div>`;
    document.body.append(element);
    const $ = id => document.getElementById(id);
    const modal = new bootstrap.Modal(element, { backdrop: 'static' });
    const canvas = $('handoverSignature'), context = canvas.getContext('2d');
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const kinds = { damage: 'Beschädigung', scratch: 'Kratzer', note: 'Sonstige Bemerkung' };
    function clearSignature() {
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        signatureDrawn = false; $('handoverConfirmed').checked = false;
    }
    function changed() { dirty = true; clearSignature(); }
    function setBusy(value) {
        busy = value; $('handoverFields').disabled = value;
        for (const id of ['handoverSave', 'handoverFinalize']) $(id).disabled = value;
    }
    function captureEntries() {
        $('handoverEntries').querySelectorAll('[data-entry]').forEach(row => {
            const entry = entries[Number(row.dataset.entry)];
            entry.itemId = Number(row.querySelector('[data-field="item"]').value);
            entry.kind = row.querySelector('[data-field="kind"]').value;
            entry.text = row.querySelector('textarea').value;
        });
    }
    function renderEntries() {
        $('handoverEntries').innerHTML = entries.map((entry, index) => `<section class="protocol-form-section" data-entry="${index}">
            <div class="d-flex justify-content-between gap-2"><h3 class="h5">Eintrag ${index + 1}</h3><button type="button" class="btn btn-outline-danger btn-sm" data-remove="${index}">Eintrag entfernen</button></div>
            <div class="row g-3"><div class="col-md-6"><label class="form-label" for="handoverItem${index}">Artikel</label><select class="form-select" id="handoverItem${index}" data-field="item">${data.items.map(item => `<option value="${item.id}" ${item.id === entry.itemId ? 'selected' : ''}>${escape(item.title)} · Position ${item.id}</option>`).join('')}</select></div>
            <div class="col-md-6"><label class="form-label" for="handoverKind${index}">Art</label><select class="form-select" id="handoverKind${index}" data-field="kind">${Object.entries(kinds).map(([key, title]) => `<option value="${key}" ${entry.kind === key ? 'selected' : ''}>${title}</option>`).join('')}</select></div>
            <div class="col-12"><label for="handoverText${index}" class="form-label">Beschreibung / Lage am Artikel</label><textarea class="form-control" rows="3" id="handoverText${index}" maxlength="2000">${escape(entry.text)}</textarea></div>
            <div class="col-12"><label class="form-label" for="handoverPhotos${index}">Fotos hinzufügen (mehrere auswählbar)</label><input id="handoverPhotos${index}" type="file" class="form-control" accept="image/jpeg,image/png,image/webp" multiple data-photos="${index}"><p class="small text-muted">Bis zu 6 Fotos je Eintrag, insgesamt 20. PNG, JPEG oder WebP.</p><div class="d-flex flex-wrap gap-2">${entry.photos.map((photo, pi) => `<div><img class="handover-photo" src="${escape(photo)}" alt="Eintrag ${index + 1}, Foto ${pi + 1}"><button type="button" class="btn btn-outline-danger btn-sm d-block mt-1" data-remove-photo="${index}:${pi}">Foto entfernen</button></div>`).join('')}</div></div></div></section>`).join('');
    }
    async function load() {
        const response = await fetch(`${customerView?"/my-orders":"/admin/orders"}/${orderId}/handover`);
        data = await response.json(); if (!response.ok) throw new Error(data.error);
        entries = data.document?.entries || []; dirty = false; clearSignature();
        $('handoverTitle').textContent = `Übergabeprotokoll · ${data.orderNo}`;
        $('handoverConfirmation').textContent = data.confirmation;
        $('handoverSigner').value = ''; $('handoverNoDamage').checked = data.document?.noDamage || false;
        $('handoverItems').textContent = data.items.map(item => `${item.title} · Position ${item.id}`).join(' / ');
        const signed = data.status === 'signed', editable = data.editable && !signed;
        $('handoverFields').classList.toggle('d-none', !editable);
        $('handoverSave').classList.toggle('d-none', !editable); $('handoverFinalize').classList.toggle('d-none', !editable);
        $('handoverPdf').classList.toggle('d-none', !signed); $('handoverPdf').href = `${customerView?"/my-orders":"/admin/orders"}/${orderId}/handover/pdf?download=1`;
        $('handoverStatus').textContent = signed ? `Festgeschrieben · Unterschrieben von ${data.document.signer}. Das PDF bleibt diesem Auftrag zugeordnet.` : editable ? (data.status === 'draft' ? 'Gespeicherter Entwurf – noch nicht unterschrieben oder versendet.' : 'Neues Übergabeprotokoll') : 'Ein neues Protokoll kann nur vor der ersten Abholung erstellt werden.';
        element.classList.toggle('protocol-readonly', signed);
        const report = data.document;
        const safeImage = value => /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=\r\n]+$/.test(value||'') ? value : '';
        const photo = (value,alt) => safeImage(value)?'<img src="'+escape(value)+'" alt="'+escape(alt)+'">':'';
        $('handoverReadOnly').innerHTML = signed ? `<section class="protocol-form-section"><h3>Geprüfte Artikel</h3><ul>${(report.items||data.items).map(item=>'<li>'+escape(item.title)+'</li>').join('')}</ul></section>
        ${report.noDamage?'<div class="protocol-ok"><i class="bi bi-check-circle"></i> Keine Auffälligkeiten bei der Übergabe festgestellt.</div>':''}
        ${entries.map((entry,index)=>'<section class="protocol-form-section"><header><h3>'+escape(kinds[entry.kind]||'Bemerkung')+'</h3><span>'+escape((report.items||data.items).find(item=>Number(item.id)===Number(entry.itemId))?.title||'Artikel')+'</span></header><p class="protocol-description">'+escape(entry.text)+'</p><div class="protocol-photo-grid">'+entry.photos.map((value,i)=>photo(value,'Eintrag '+(index+1)+', Foto '+(i+1))).join('')+'</div></section>').join('')}
        <section class="protocol-form-section"><h3>Bestätigung & Unterschrift</h3><p>${escape(report.confirmation||data.confirmation)}</p><div class="protocol-signature-preview">${photo(report.signature,'Kundenunterschrift')}</div><strong>${escape(report.signer)}</strong><p class="small text-muted">${report.signedAt?escape(new Date(report.signedAt).toLocaleString('de-DE')):''} · Festgeschrieben</p></section>` : '';

        renderEntries();
    }
    document.addEventListener('click', async event => {
        const button = event.target.closest('[data-handover-order]'); if (!button || busy) return;
        customerView = button.dataset.handoverCustomer === "true"; orderId = Number(button.dataset.handoverOrder); setBusy(true);
        try {
            await load();
            const current = document.querySelector('.modal.show');
            if (current && !shownModals.has(current)) {
                await new Promise(resolve => current.addEventListener('shown.bs.modal', resolve, { once: true }));
            }
            if (current) { await new Promise(resolve => { current.addEventListener('hidden.bs.modal', resolve, { once: true }); bootstrap.Modal.getInstance(current).hide(); }); }
            modal.show();
        } catch (error) { showAlert(error.message, 'danger'); } finally { setBusy(false); }
    });
    $('handoverAdd').addEventListener('click', () => {
        if (entries.length >= 20) return showAlert('Maximal 20 Einträge möglich.', 'warning');
        captureEntries(); entries.push({ itemId: data.items[0]?.id, kind: 'damage', text: '', photos: [] });
        $('handoverNoDamage').checked = false; changed(); renderEntries();
    });
    $('handoverEntries').addEventListener('input', () => { captureEntries(); changed(); });
    $('handoverNoDamage').addEventListener('change', changed); $('handoverSigner').addEventListener('input', changed);
    $('handoverClear').addEventListener('click', clearSignature);
    $('handoverEntries').addEventListener('click', event => {
        const remove = event.target.closest('[data-remove]'), photo = event.target.closest('[data-remove-photo]');
        if (!remove && !photo) return;
        captureEntries();
        if (remove) entries.splice(Number(remove.dataset.remove), 1);
        if (photo) { const [ei, pi] = photo.dataset.removePhoto.split(':').map(Number); entries[ei].photos.splice(pi, 1); }
        changed(); renderEntries();
    });
    async function readImage(file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error('Bitte PNG, JPEG oder WebP bis 12 MB auswählen.');
        const bitmap = await createImageBitmap(file);
        try {
            const factor = Math.min(1, 1100 / Math.max(bitmap.width, bitmap.height));
            const output = document.createElement('canvas'); output.width = Math.max(1, Math.round(bitmap.width * factor)); output.height = Math.max(1, Math.round(bitmap.height * factor));
            const ctx = output.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, output.width, output.height); ctx.drawImage(bitmap, 0, 0, output.width, output.height);
            return output.toDataURL('image/jpeg', 0.75);
        } finally { bitmap.close(); }
    }
    $('handoverEntries').addEventListener('change', async event => {
        if (!event.target.matches('[data-photos]')) return;
        captureEntries(); const entry = entries[Number(event.target.dataset.photos)], files = [...event.target.files];
        setBusy(true);
        try {
            if (entry.photos.length + files.length > 6 || entries.reduce((n, e) => n + e.photos.length, 0) + files.length > 20) throw new Error('Höchstens 6 Fotos je Eintrag und 20 Fotos insgesamt möglich.');
            const added = []; for (const file of files) added.push(await readImage(file));
            entry.photos.push(...added); changed();
        } catch (error) { showAlert(error.message, 'danger'); } finally { renderEntries(); setBusy(false); }
    });
    let drawing = false, last;
    const point = event => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
    canvas.addEventListener('pointerdown', event => { if (busy) return; event.preventDefault(); drawing = true; last = point(event); canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', event => { if (!drawing || busy) return; const next = point(event); context.strokeStyle = '#092447'; context.lineWidth = 3; context.lineCap = 'round'; context.beginPath(); context.moveTo(last.x, last.y); context.lineTo(next.x, next.y); context.stroke(); last = next; signatureDrawn = true; dirty = true; });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { drawing = false; });
    async function save(finalize) {
        if (busy) return;
        captureEntries();
        if (finalize && (!signatureDrawn || !$('handoverConfirmed').checked || !$('handoverSigner').value.trim())) return showAlert('Bitte Namen eingeben, das Protokoll bestätigen und unterschreiben.', 'warning');
        setBusy(true);
        try {
            const payload = { revision: data.revision, entries, noDamage: $('handoverNoDamage').checked, finalize,
                signer: $('handoverSigner').value.trim(), confirmed: $('handoverConfirmed').checked, signature: finalize ? canvas.toDataURL('image/png') : null };
            const body = new FormData(); body.append('payload', JSON.stringify(payload));
            const response = await fetch(`/admin/orders/${orderId}/handover`, { method: 'POST', body });
            const result = await response.json(); if (!response.ok) throw new Error(result.error);
            await load(); showAlert(result.message, 'success');
        } catch (error) { showAlert(error.message, 'danger'); } finally { setBusy(false); }
    }
    $('handoverSave').addEventListener('click', () => save(false)); $('handoverFinalize').addEventListener('click', () => save(true));
    let allowClose = false;
    element.addEventListener('hide.bs.modal', event => {
        if (busy) { event.preventDefault(); return; }
        if (dirty && !allowClose) {
            event.preventDefault();
            showConfirm('Nicht gespeicherte Änderungen und die Unterschrift verwerfen?', 'Übergabeprotokoll schließen').then(confirmed => {
                if (confirmed) { allowClose = true; modal.hide(); }
            });
        }
    });
    element.addEventListener('hidden.bs.modal', () => { allowClose = false; dirty = false; clearSignature(); (customerView ? openMyOrderDetails(orderId) : openOrderDetails(orderId)); });
})();
