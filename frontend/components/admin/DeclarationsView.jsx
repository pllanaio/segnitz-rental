import { forwardRef, useImperativeHandle, useState } from 'react';
import { showAlert } from '../../lib/alerts';

function DeclarationCard({ item, onProcessed }) {
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const received = item.processing_status === 'received';

    const markProcessed = async () => {
        const text = note.trim();
        if (!text) {
            showAlert('Bitte die erledigten Schritte dokumentieren.', 'warning');
            return;
        }
        setBusy(true);
        try {
            const response = await fetch(`/admin/contract-declarations/${encodeURIComponent(item.id)}/processed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: text })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Bearbeitung konnte nicht gespeichert werden.');
            await onProcessed();
        } catch (error) {
            showAlert(error.message, 'danger');
            setBusy(false);
        }
    };

    return (
        <article className="border rounded p-3 mb-3">
            <h3 className="h5">{item.kind === 'withdrawal' ? 'Widerruf' : 'Stornierung'} · {item.contract_reference}</h3>
            <p>
                <span className={`badge ${received ? 'bg-warning text-dark' : 'bg-success'}`}>{received ? 'Offen' : 'Bearbeitung dokumentiert'}</span>
            </p>
            <p>{item.customer_name} · {item.customer_email}<br />Eingang: {new Date(item.receivedAt).toLocaleString('de-DE')}</p>
            <p className="text-break">{item.declaration_text}</p>
            {item.order_id
                ? (
                    <button type="button" className="btn btn-outline-primary mb-2" data-backend-action="open-order-details"
                        data-order-id={Number(item.order_id)}>Bestellung öffnen</button>
                )
                : <p className="text-danger">Keine automatische Zuordnung. Bitte anhand der Erklärung prüfen.</p>}
            {item.processing_note ? <p>Bearbeitung: {item.processing_note}</p> : null}
            {received ? (
                <>
                    <label className="form-label d-block" htmlFor={`note-${item.id}`}>Erledigte Schritte</label>
                    <textarea className="form-control mb-2" id={`note-${item.id}`} maxLength={2000} rows={2}
                        value={note} onChange={event => setNote(event.target.value)} />
                    <button type="button" className="btn btn-primary" data-declaration-processed={item.id} disabled={busy}
                        onClick={markProcessed}>Als bearbeitet dokumentieren</button>
                </>
            ) : null}
        </article>
    );
}

const DeclarationsView = forwardRef(function DeclarationsView({ visible }, ref) {
    const [state, setState] = useState({ status: 'idle', items: [], error: '' });

    const load = async () => {
        setState(current => ({ ...current, status: 'loading' }));
        try {
            const response = await fetch('/admin/contract-declarations');
            if (!response.ok) throw new Error('Vorgänge konnten nicht geladen werden.');
            const { items } = await response.json();
            setState({ status: 'loaded', items, error: '' });
        } catch (error) {
            setState({ status: 'error', items: [], error: error.message });
        }
    };

    useImperativeHandle(ref, () => ({ load }));

    let list = null;
    if (state.status === 'loading') list = 'Vorgänge werden geladen …';
    else if (state.status === 'error') list = state.error;
    else if (state.status === 'loaded') {
        list = state.items.length
            ? state.items.map(item => <DeclarationCard key={item.id} item={item} onProcessed={load} />)
            : <p>Keine Vorgänge vorhanden.</p>;
    }

    return (
        <section id="declarationsView" className={visible ? undefined : 'd-none'}>
            <h2>Widerrufe &amp; Stornierungen</h2>
            <p>Der Eingang wurde bereits bestätigt. Klären Sie die Zuordnung und wickeln Sie Rückgabe bzw. Erstattung ab. Dokumentieren Sie anschließend die erledigten Schritte.</p>
            <button type="button" id="reloadDeclarations" className="btn btn-outline-primary mb-3" onClick={load}>Aktualisieren</button>
            <div id="declarationsList" aria-live="polite">{list}</div>
        </section>
    );
});

export default DeclarationsView;
