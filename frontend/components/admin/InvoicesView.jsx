import { forwardRef, useImperativeHandle, useState } from 'react';
import InvoiceArchive from '../orders/InvoiceArchive';

const INVOICE_FIELDS = {
    name: 'Vollständiger rechtlicher Name',
    address: 'Straße und Hausnummer',
    postalCode: 'Postleitzahl',
    city: 'Ort',
    taxId: 'Steuernummer oder USt-ID',
    email: 'Kontakt-E-Mail',
    iban: 'Eigene IBAN (optional; Überweisungen erfolgen über Mollie)',
    bic: 'BIC (optional)',
    accountHolder: 'Kontoinhaber (optional)',
    registerInfo: 'Registergericht und Registernummer (falls vorhanden)',
    managingDirectors: 'Vertretungsberechtigte / Geschäftsführung'
};
const EMPTY_SETTINGS = Object.fromEntries(Object.keys(INVOICE_FIELDS).map(name => [name, '']));

const InvoicesView = forwardRef(function InvoicesView({ visible }, ref) {
    const [archiveSession, setArchiveSession] = useState(0);
    const [settings, setSettings] = useState(EMPTY_SETTINGS);
    const [revision, setRevision] = useState(null);
    const [status, setStatus] = useState('');
    const [saveEnabled, setSaveEnabled] = useState(false);

    const loadSettings = async () => {
        setSaveEnabled(false);
        try {
            const response = await fetch('/admin/invoice-settings', { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw Error(data.error);
            setRevision(data.revision);
            setSettings(Object.fromEntries(Object.keys(INVOICE_FIELDS).map(name => [name, data.settings[name] || ''])));
            setStatus('');
            setSaveEnabled(true);
        } catch (error) {
            setStatus(error.message);
        }
    };

    useImperativeHandle(ref, () => ({
        load() {
            loadSettings();
            setArchiveSession(current => current + 1);
        }
    }));

    const save = async event => {
        event.preventDefault();
        setSaveEnabled(false);
        try {
            const response = await fetch('/admin/invoice-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings, revision })
            });
            const result = await response.json();
            if (!response.ok) throw Error(result.error);
            setRevision(result.revision);
            setStatus(result.message);
        } catch (error) {
            setStatus(error.message);
        } finally {
            setSaveEnabled(true);
        }
    };

    return (
        <section id="invoicesView" className={visible ? undefined : 'd-none'}>
            <h2>Rechnungen</h2>
            <div id="adminInvoiceList" aria-live="polite">
                {archiveSession > 0 ? <InvoiceArchive key={archiveSession} admin /> : null}
            </div>
            <details className="invoice-issuer-settings mt-4">
                <summary>Rechnungssteller &amp; Einstellungen</summary>
                <form id="invoiceSettingsForm" className="card p-4 mb-4" onSubmit={save}>
                    <h3 className="h5">Rechnungssteller</h3>
                    <p>Rechnungen und Rechnungskorrekturen werden von Segnitz Rental erstellt. Nummern werden automatisch fortlaufend vergeben. Bereits ausgestellte Dokumente bleiben unverändert.</p>
                    <div id="invoiceIssuerFields" className="row g-3 mb-3">
                        {Object.entries(INVOICE_FIELDS).map(([name, label]) => (
                            <div className="col-12 col-md-6" key={name}>
                                <label className="form-label" htmlFor={`issuer-${name}`}>{label}</label>
                                <input id={`issuer-${name}`} name={name} className="form-control" maxLength={500}
                                    type={name === 'email' ? 'email' : 'text'} value={settings[name]}
                                    onChange={event => setSettings(current => ({ ...current, [name]: event.target.value }))} />
                            </div>
                        ))}
                    </div>
                    <p className="text-muted">Für die Ausstellung sind Name, Anschrift, Steuerangabe und E-Mail erforderlich. Es gilt der reguläre Umsatzsteuersatz von 19 %. Zahlungsziel: 14 Tage. Unvollständige Angaben sperren die Ausstellung.</p>
                    <div className="d-flex flex-wrap gap-2">
                        <button id="invoiceSettingsSave" type="submit" className="btn btn-primary" disabled={!saveEnabled}>Einstellungen speichern</button>
                        <button id="invoiceSettingsReload" type="button" className="btn btn-outline-primary" onClick={loadSettings}>Neu laden</button>
                    </div>
                    <p id="invoiceSettingsStatus" className="mt-3 mb-0" role="status" aria-live="polite">{status}</p>
                </form>
            </details>
        </section>
    );
});

export default InvoicesView;
