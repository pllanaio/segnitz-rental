document.addEventListener('DOMContentLoaded', async () => {
    const status = document.getElementById('legalDocumentStatus');
    try {
        const response = await fetch('/legal-documents');
        const documents = await response.json();
        if (!response.ok || !documents.ready) throw new Error('Vertragsdokumente fehlen.');
        for (const [name, document] of [['terms', documents.terms], ['privacy', documents.privacy]]) {
            window.document.getElementById(`${name}Link`).href = document.url;
            window.document.getElementById(`${name}Version`).value = document.version;
        }
        document.getElementById('operatorLink').href = documents.operatorUrl;
        document.getElementById('signatureAlternative').classList.toggle('d-none', !documents.signatureImageUploadEnabled);
        if (status) status.textContent = `Mietbedingungen: ${documents.terms.version}; Datenschutz: ${documents.privacy.version}`;
    } catch {
        if (status) status.textContent = 'Die freigegebenen Vertragsdokumente sind noch nicht verfügbar. Ein Abschluss ist derzeit nicht möglich.';
        for (const id of ['agbs', 'dsgvo']) document.getElementById(id).disabled = true;
    }
});
