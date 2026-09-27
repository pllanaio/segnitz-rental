'use strict';
(() => {
    const el = id => document.getElementById(id);
    let submission = null;
    let receiptText = '';
    history.replaceState(null, '', location.pathname);
    const showError = message => { el('declarationError').textContent = message; el('declarationError').classList.remove('d-none'); };
    const post = async (url, data) => {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Die Erklärung konnte nicht gespeichert werden. Bitte erneut versuchen.');
        return result;
    };
    el('declarationForm').addEventListener('submit', event => {
        event.preventDefault();
        submission = { id: crypto.randomUUID(), kind: 'withdrawal',
            name: el('declarationName').value.trim(), email: el('declarationEmail').value.trim(),
            contractReference: el('declarationReference').value.trim(),
            scope: el('declarationScope').value.trim() };
        el('reviewDeclaration').textContent = `Hiermit widerrufe ich den Vertrag ${submission.contractReference}${submission.scope ? ` hinsichtlich: ${submission.scope}` : ' vollständig'}.`;
        el('reviewDetails').replaceChildren();
        for (const [label, value] of [['Name', submission.name], ['E-Mail', submission.email], ['Vertrag', submission.contractReference]]) {
            const dt = document.createElement('dt'); dt.textContent = label;
            const dd = document.createElement('dd'); dd.textContent = value;
            el('reviewDetails').append(dt, dd);
        }
        el('declarationForm').classList.add('d-none'); el('declarationReview').classList.remove('d-none');
        el('declarationConfirm').focus();
    });
    el('declarationEdit').addEventListener('click', () => {
        el('declarationReview').classList.add('d-none'); el('declarationForm').classList.remove('d-none');
    });
    el('declarationConfirm').addEventListener('click', async () => {
        el('declarationConfirm').disabled = true; el('declarationEdit').disabled = true;
        el('declarationError').classList.add('d-none');
        try {
            const result = await post('/contract-declarations', submission);
            const r = result.receipt;
            receiptText = `Eingangsbestätigung des Widerrufs\n\n${r.declaration}\nName: ${r.name}\nE-Mail: ${r.email}\nEingang (UTC): ${r.receivedAt}\nVorgang: ${r.id}`;
            el('declarationReceipt').textContent = receiptText;
            el('declarationSuccessText').textContent = 'Ihr Widerruf ist eingegangen. Eine Eingangsbestätigung wird an die angegebene E-Mail-Adresse gesendet. Eine weitere Bestätigung Ihrerseits ist nicht erforderlich.';
            el('declarationReview').classList.add('d-none'); el('declarationSuccess').classList.remove('d-none');
        } catch (error) { showError(error.message); }
        finally { el('declarationConfirm').disabled = false; el('declarationEdit').disabled = false; }
    });
    el('declarationDownload').addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([receiptText], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = `Segnitz-Rental-Eingangsbestätigung-${submission.id}.txt`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
})();
