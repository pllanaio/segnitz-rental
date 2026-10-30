import { useCallback, useEffect, useRef, useState } from 'react';
import InvoiceDocuments from './InvoiceDocuments';
import { invoiceFetch } from '../../lib/orders';

function groupByOrder(items) {
    const groups = new Map();
    for (const item of items) {
        if (!groups.has(item.orderId)) groups.set(item.orderId, []);
        groups.get(item.orderId).push(item);
    }
    return [...groups.values()];
}

// Searchable, paginated archive of "Meine Rechnungen" and the admin invoice list.
export default function InvoiceArchive({ admin = false, active = true }) {
    const [query, setQuery] = useState('');
    const [result, setResult] = useState(null);
    const revisionRef = useRef(0);
    const timerRef = useRef(null);
    const queryRef = useRef('');

    const load = useCallback(async (page = 1) => {
        const current = ++revisionRef.current;
        try {
            const data = await invoiceFetch(`${admin ? '/admin/invoices' : '/my-invoices'}?q=${encodeURIComponent(queryRef.current)}&page=${page}`);
            if (current !== revisionRef.current) return;
            setResult({ page, data, query: queryRef.current });
        } catch (error) {
            if (current === revisionRef.current) setResult({ error: error.message });
        }
    }, [admin]);

    useEffect(() => {
        if (active) load();
    }, [active, load]);

    useEffect(() => () => window.clearTimeout(timerRef.current), []);

    const search = value => {
        setQuery(value);
        queryRef.current = value;
        window.clearTimeout(timerRef.current);
        revisionRef.current++;
        timerRef.current = window.setTimeout(() => load(), 250);
    };

    let content = null;
    if (result?.error) {
        content = result.error;
    } else if (result) {
        const groups = groupByOrder(result.data.items);
        content = (
            <>
                {groups.length ? groups.map((items, index) => {
                    const order = items[0];
                    return (
                        <details className="invoice-order" open={index === 0 || Boolean(result.query)} key={order.orderId}>
                            <summary>
                                <span>
                                    <strong>Auftrag {order.orderNo}</strong>
                                    <small>{items.length} Belege{admin ? ` · ${order.customerName} · ${order.company || order.email}` : ''}</small>
                                </span>
                                <i className="bi bi-chevron-down" aria-hidden="true" />
                            </summary>
                            <InvoiceDocuments items={items} admin={admin} />
                        </details>
                    );
                }) : (
                    <div className="invoice-empty">
                        <i className="bi bi-folder2-open" aria-hidden="true" />
                        <h3>Keine Rechnungen gefunden</h3>
                        <p>Versuchen Sie einen anderen Suchbegriff.</p>
                    </div>
                )}
                <div className="d-flex gap-2 align-items-center flex-wrap mt-3">
                    <button className="btn btn-outline-primary" data-archive-page={result.page - 1} disabled={result.page <= 1}
                        onClick={() => load(result.page - 1)}>Zurück</button>
                    <span>{result.data.total} Aufträge · Seite {result.page} / {result.data.totalPages}</span>
                    <button className="btn btn-outline-primary" data-archive-page={result.page + 1}
                        disabled={result.page >= result.data.totalPages} onClick={() => load(result.page + 1)}>Weiter</button>
                </div>
            </>
        );
    }

    return (
        <>
            <p className="text-muted">Alle Rechnungen und Korrekturen, übersichtlich nach Auftrag geordnet.</p>
            <label className="invoice-search">
                <i className="bi bi-search" aria-hidden="true" />
                <input className="form-control" type="search" maxLength={200} aria-label="Rechnungen durchsuchen"
                    placeholder="Auftrag, Rechnung, Kunde oder Betrag suchen …" data-archive-search=""
                    value={query} onChange={event => search(event.target.value)} />
            </label>
            <div data-archive-results="" aria-live="polite">{content}</div>
        </>
    );
}
