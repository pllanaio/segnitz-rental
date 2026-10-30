import { forwardRef, useImperativeHandle, useState } from 'react';
import { showAlert } from '../../lib/alerts';

const POS_STATUS_LABELS = {
    active: 'Bei Mollie aktiviert',
    pending: 'Aktivierung ausstehend',
    inactive: 'Bei Mollie deaktiviert',
    unavailable: 'Nicht mehr im Zahlungsprofil verfügbar'
};

export async function posRequest(url, method = 'GET', body) {
    const response = await fetch(url, {
        method,
        cache: 'no-store',
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'POS-Anfrage fehlgeschlagen.');
    return result;
}

function TerminalSettings({ terminal, onSaved }) {
    const [label, setLabel] = useState(terminal.label || '');
    const [location, setLocation] = useState(terminal.location || '');
    const [enabled, setEnabled] = useState(Boolean(terminal.enabled));
    const [busy, setBusy] = useState(false);

    const save = async event => {
        event.preventDefault();
        setBusy(true);
        try {
            await posRequest(`/admin/pos/terminals/${encodeURIComponent(terminal.id)}`, 'PUT', {
                label, location, enabled, revision: terminal.revision
            });
            await onSaved();
            showAlert('Terminal-Einstellungen gespeichert.', 'success');
        } catch (error) {
            showAlert(error.message, 'danger');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card mb-3" data-pos-settings={terminal.id} onSubmit={save}>
            <div className="card-body">
                <h3 className="h5">{terminal.label || terminal.description}</h3>
                <p className="text-break mb-2">{terminal.id}</p>
                <span className={`badge ${terminal.status === 'active' ? 'bg-success' : 'bg-secondary'}`}>
                    {POS_STATUS_LABELS[terminal.status] || terminal.status}
                </span>
                <div className="row g-3 mt-1">
                    <div className="col-md-6">
                        <label className="form-label">Name in Segnitz Rental
                            <input name="label" className="form-control" maxLength={120} placeholder="z. B. Leons iPhone"
                                value={label} onChange={event => setLabel(event.target.value)} />
                        </label>
                    </div>
                    <div className="col-md-6">
                        <label className="form-label">Standort / Zuordnung
                            <input name="location" className="form-control" maxLength={160} placeholder="z. B. Abholung oder Fahrzeug 1"
                                value={location} onChange={event => setLocation(event.target.value)} />
                        </label>
                    </div>
                </div>
                <label className="form-check my-3">
                    <input name="enabled" type="checkbox" className="form-check-input" checked={enabled}
                        onChange={event => setEnabled(event.target.checked)} />
                    <span className="form-check-label">Bei uns zum Kassieren freigegeben</span>
                </label>
                <button className="btn btn-primary" type="submit" disabled={terminal.status === 'unavailable' || busy}>Einstellungen speichern</button>
            </div>
        </form>
    );
}

const PosView = forwardRef(function PosView({ visible }, ref) {
    const [state, setState] = useState({ status: 'idle', items: [], mode: '', error: '', revision: 0 });

    const load = async () => {
        setState(current => ({ ...current, status: 'loading' }));
        try {
            const result = await posRequest('/admin/pos/terminals');
            setState(current => ({
                status: 'loaded',
                items: result.items,
                mode: result.mode === 'test' ? 'Testmodus · keine echten Zahlungen' : 'Live-Modus',
                error: '',
                revision: current.revision + 1
            }));
        } catch (error) {
            setState(current => ({ ...current, status: 'error', error: error.message }));
        }
    };

    useImperativeHandle(ref, () => ({ load }));

    let list = null;
    if (state.status === 'loading') list = 'Geräte werden bei Mollie geladen …';
    else if (state.status === 'error') list = state.error;
    else if (state.status === 'loaded') {
        list = state.items.length
            ? state.items.map(terminal => <TerminalSettings key={`${terminal.id}-${state.revision}`} terminal={terminal} onSaved={load} />)
            : <div className="alert alert-info">Keine Terminals in diesem Mollie-Zahlungsprofil gefunden. Bitte ein Tap-Gerät oder Testterminal bei Mollie einrichten.</div>;
    }

    return (
        <section id="posView" className={visible ? undefined : 'd-none'}>
            <h2>POS &amp; Terminals</h2>
            <p>Mollie-Tap-Geräte und Terminals des verbundenen Zahlungsprofils. Namen, Standorte und Freigaben gelten in Segnitz Rental.</p>
            <div className="d-flex gap-3 align-items-center mb-3">
                <span id="posMode" className="badge bg-secondary">{state.mode}</span>
                <button type="button" className="btn btn-outline-primary" id="posRefresh" onClick={load}>Geräte aktualisieren</button>
            </div>
            <p className="text-muted">Neue Geräte im Mollie-Dashboard koppeln. „Bei uns freigegeben“ sperrt oder erlaubt Zahlungen aus Segnitz Rental; das Gerät wird dadurch bei Mollie nicht deaktiviert.</p>
            <div id="posTerminalList" aria-live="polite">{list}</div>
        </section>
    );
});

export default PosView;
