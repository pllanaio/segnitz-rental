import { useEffect, useRef, useState } from 'react';
import { getModal, hideModal } from '../../lib/bootstrap';
import { showAlert, showConfirm } from '../../lib/alerts';

const KINDS = { damage: 'Beschädigung', scratch: 'Kratzer', note: 'Sonstige Bemerkung' };
const SAFE_IMAGE = /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=\r\n]+$/;

async function readImage(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
        throw new Error('Bitte PNG, JPEG oder WebP bis 12 MB auswählen.');
    }
    const bitmap = await createImageBitmap(file);
    try {
        const factor = Math.min(1, 1100 / Math.max(bitmap.width, bitmap.height));
        const output = document.createElement('canvas');
        output.width = Math.max(1, Math.round(bitmap.width * factor));
        output.height = Math.max(1, Math.round(bitmap.height * factor));
        const context = output.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, output.width, output.height);
        context.drawImage(bitmap, 0, 0, output.width, output.height);
        return output.toDataURL('image/jpeg', 0.75);
    } finally {
        bitmap.close();
    }
}

function SafeImage({ value, alt }) {
    return SAFE_IMAGE.test(value || '') ? <img src={value} alt={alt} /> : null;
}

function ReadOnlyReport({ data, entries }) {
    const report = data.document;
    const reportItems = report.items || data.items;
    return (
        <>
            <section className="protocol-form-section">
                <h3>Geprüfte Artikel</h3>
                <ul>{reportItems.map((item, index) => <li key={item.id ?? index}>{item.title}</li>)}</ul>
            </section>
            {report.noDamage
                ? <div className="protocol-ok"><i className="bi bi-check-circle" /> Keine Auffälligkeiten bei der Übergabe festgestellt.</div>
                : null}
            {entries.map((entry, index) => (
                <section className="protocol-form-section" key={index}>
                    <header>
                        <h3>{KINDS[entry.kind] || 'Bemerkung'}</h3>
                        <span>{reportItems.find(item => Number(item.id) === Number(entry.itemId))?.title || 'Artikel'}</span>
                    </header>
                    <p className="protocol-description">{entry.text}</p>
                    <div className="protocol-photo-grid">
                        {entry.photos.map((value, photoIndex) => (
                            <SafeImage key={photoIndex} value={value} alt={`Eintrag ${index + 1}, Foto ${photoIndex + 1}`} />
                        ))}
                    </div>
                </section>
            ))}
            <section className="protocol-form-section">
                <h3>Bestätigung &amp; Unterschrift</h3>
                <p>{report.confirmation || data.confirmation}</p>
                <div className="protocol-signature-preview"><SafeImage value={report.signature} alt="Kundenunterschrift" /></div>
                <strong>{report.signer}</strong>
                <p className="small text-muted">{report.signedAt ? new Date(report.signedAt).toLocaleString('de-DE') : ''} · Festgeschrieben</p>
            </section>
        </>
    );
}

// Handover report dialog (admin: create/sign; customer: read-only view and PDF).
// It opens from any [data-handover-order] button and returns to the order sheet
// it came from once closed.
export default function HandoverModal({ onReturnToOrder }) {
    const modalRef = useRef(null);
    const canvasRef = useRef(null);
    const state = useRef({ customerView: false, orderId: null, busy: false, dirty: false, allowClose: false, signatureDrawn: false });
    const returnRef = useRef(onReturnToOrder);
    returnRef.current = onReturnToOrder;

    const [data, setData] = useState(null);
    const [entries, setEntries] = useState([]);
    const [noDamage, setNoDamage] = useState(false);
    const [signer, setSigner] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusyState] = useState(false);
    const [customerView, setCustomerView] = useState(false);
    const entriesRef = useRef(entries);
    entriesRef.current = entries;

    const setBusy = value => { state.current.busy = value; setBusyState(value); };

    const clearSignature = () => {
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        state.current.signatureDrawn = false;
        setConfirmed(false);
    };

    const changed = () => { state.current.dirty = true; clearSignature(); };

    const load = async () => {
        const { customerView: customer, orderId } = state.current;
        const response = await fetch(`${customer ? '/my-orders' : '/admin/orders'}/${orderId}/handover`);
        const loaded = await response.json();
        if (!response.ok) throw new Error(loaded.error);
        setData(loaded);
        setEntries(loaded.document?.entries || []);
        state.current.dirty = false;
        clearSignature();
        setSigner('');
        setNoDamage(loaded.document?.noDamage || false);
    };

    // Tracks which Bootstrap modals finished their show transition.
    useEffect(() => {
        const shown = new WeakSet();
        const onShown = event => shown.add(event.target);
        const onShow = event => shown.delete(event.target);
        document.addEventListener('shown.bs.modal', onShown);
        document.addEventListener('show.bs.modal', onShow);
        document.addEventListener('hidden.bs.modal', onShow);

        const onClick = async event => {
            const button = event.target.closest('[data-handover-order]');
            if (!button || state.current.busy) return;
            const customer = button.dataset.handoverCustomer === 'true';
            state.current.customerView = customer;
            state.current.orderId = Number(button.dataset.handoverOrder);
            setCustomerView(customer);
            setBusy(true);
            try {
                await load();
                const current = document.querySelector('.modal.show');
                if (current && !shown.has(current)) {
                    await new Promise(resolve => current.addEventListener('shown.bs.modal', resolve, { once: true }));
                }
                if (current) {
                    await new Promise(resolve => {
                        current.addEventListener('hidden.bs.modal', resolve, { once: true });
                        hideModal(current);
                    });
                }
                getModal(modalRef.current, { backdrop: 'static' }).show();
            } catch (error) {
                showAlert(error.message, 'danger');
            } finally {
                setBusy(false);
            }
        };
        document.addEventListener('click', onClick);

        const element = modalRef.current;
        const onHide = event => {
            if (state.current.busy) { event.preventDefault(); return; }
            if (state.current.dirty && !state.current.allowClose) {
                event.preventDefault();
                showConfirm('Nicht gespeicherte Änderungen und die Unterschrift verwerfen?', 'Übergabeprotokoll schließen').then(ok => {
                    if (ok) {
                        state.current.allowClose = true;
                        hideModal(element);
                    }
                });
            }
        };
        const onHidden = () => {
            state.current.allowClose = false;
            state.current.dirty = false;
            clearSignature();
            returnRef.current?.(state.current.orderId, state.current.customerView);
        };
        element.addEventListener('hide.bs.modal', onHide);
        element.addEventListener('hidden.bs.modal', onHidden);

        return () => {
            document.removeEventListener('shown.bs.modal', onShown);
            document.removeEventListener('show.bs.modal', onShow);
            document.removeEventListener('hidden.bs.modal', onShow);
            document.removeEventListener('click', onClick);
            element.removeEventListener('hide.bs.modal', onHide);
            element.removeEventListener('hidden.bs.modal', onHidden);
        };
    }, []);

    // Pointer drawing on the signature canvas (no signature library, as before).
    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        let drawing = false;
        let last;
        const point = event => {
            const rect = canvas.getBoundingClientRect();
            return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
        };
        const down = event => {
            if (state.current.busy) return;
            event.preventDefault();
            drawing = true;
            last = point(event);
            canvas.setPointerCapture(event.pointerId);
        };
        const move = event => {
            if (!drawing || state.current.busy) return;
            const next = point(event);
            context.strokeStyle = '#092447';
            context.lineWidth = 3;
            context.lineCap = 'round';
            context.beginPath();
            context.moveTo(last.x, last.y);
            context.lineTo(next.x, next.y);
            context.stroke();
            last = next;
            state.current.signatureDrawn = true;
            state.current.dirty = true;
        };
        const stop = () => { drawing = false; };
        canvas.addEventListener('pointerdown', down);
        canvas.addEventListener('pointermove', move);
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => canvas.addEventListener(name, stop));
        clearSignature();
        return () => {
            canvas.removeEventListener('pointerdown', down);
            canvas.removeEventListener('pointermove', move);
            ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => canvas.removeEventListener(name, stop));
        };
    }, []);

    const updateEntry = (index, changes) => {
        setEntries(current => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...changes } : entry));
        changed();
    };

    const addEntry = () => {
        if (entriesRef.current.length >= 20) {
            showAlert('Maximal 20 Einträge möglich.', 'warning');
            return;
        }
        setEntries(current => [...current, { itemId: data.items[0]?.id, kind: 'damage', text: '', photos: [] }]);
        setNoDamage(false);
        changed();
    };

    const removeEntry = index => {
        setEntries(current => current.filter((_, entryIndex) => entryIndex !== index));
        changed();
    };

    const removePhoto = (entryIndex, photoIndex) => {
        setEntries(current => current.map((entry, index) => index === entryIndex
            ? { ...entry, photos: entry.photos.filter((_, i) => i !== photoIndex) }
            : entry));
        changed();
    };

    const addPhotos = async (entryIndex, input) => {
        const files = [...input.files];
        const current = entriesRef.current;
        const entry = current[entryIndex];
        setBusy(true);
        try {
            if (entry.photos.length + files.length > 6 || current.reduce((n, e) => n + e.photos.length, 0) + files.length > 20) {
                throw new Error('Höchstens 6 Fotos je Eintrag und 20 Fotos insgesamt möglich.');
            }
            const added = [];
            for (const file of files) added.push(await readImage(file));
            setEntries(latest => latest.map((item, index) => index === entryIndex ? { ...item, photos: [...item.photos, ...added] } : item));
            changed();
        } catch (error) {
            showAlert(error.message, 'danger');
        } finally {
            input.value = '';
            setBusy(false);
        }
    };

    const save = async finalize => {
        if (state.current.busy) return;
        if (finalize && (!state.current.signatureDrawn || !confirmed || !signer.trim())) {
            showAlert('Bitte Namen eingeben, das Protokoll bestätigen und unterschreiben.', 'warning');
            return;
        }
        setBusy(true);
        try {
            const payload = {
                revision: data.revision,
                entries: entriesRef.current,
                noDamage,
                finalize,
                signer: signer.trim(),
                confirmed,
                signature: finalize ? canvasRef.current.toDataURL('image/png') : null
            };
            const body = new FormData();
            body.append('payload', JSON.stringify(payload));
            const response = await fetch(`/admin/orders/${state.current.orderId}/handover`, { method: 'POST', body });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            await load();
            showAlert(result.message, 'success');
        } catch (error) {
            showAlert(error.message, 'danger');
        } finally {
            setBusy(false);
        }
    };

    const signed = data?.status === 'signed';

    // The modal root's className belongs to Bootstrap while the dialog is open.
    useEffect(() => {
        modalRef.current.classList.toggle('protocol-readonly', signed);
    }, [signed]);

    const editable = Boolean(data?.editable) && !signed;
    const base = customerView ? '/my-orders' : '/admin/orders';
    const statusText = !data ? '' : signed
        ? `Festgeschrieben · Unterschrieben von ${data.document.signer}. Das PDF bleibt diesem Auftrag zugeordnet.`
        : editable
            ? (data.status === 'draft' ? 'Gespeicherter Entwurf – noch nicht unterschrieben oder versendet.' : 'Neues Übergabeprotokoll')
            : 'Ein neues Protokoll kann nur vor der ersten Abholung erstellt werden.';

    return (
        <div className="modal fade lifecycle-modal" id="handoverModal" tabIndex={-1} aria-labelledby="handoverTitle" ref={modalRef}>
            <div className="modal-dialog modal-dialog-scrollable">
                <div className="modal-content">
                    <div className="modal-header">
                        <h2 className="modal-title h5" id="handoverTitle">{data ? `Übergabeprotokoll · ${data.orderNo}` : 'Übergabeprotokoll'}</h2>
                        <button type="button" className="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Schließen" />
                    </div>
                    <div className="modal-body">
                        <p id="handoverStatus" role="status">{statusText}</p>
                        <div id="handoverReadOnly">{signed ? <ReadOnlyReport data={data} entries={entries} /> : null}</div>
                        <fieldset id="handoverFields" className={editable ? undefined : 'd-none'} disabled={busy}>
                            <h3 className="h5">1. Artikel gemeinsam prüfen</h3>
                            <p>Den Zustand gemeinsam mit dem Kunden vor der ersten Abholung prüfen. Alle Einträge und Fotos werden Bestandteil des unterschriebenen PDF-Protokolls.</p>
                            <div className="alert alert-info" id="handoverItems">
                                {data ? data.items.map(item => `${item.title} · Position ${item.id}`).join(' / ') : ''}
                            </div>
                            <label className="form-check mb-3">
                                <input type="checkbox" className="form-check-input" id="handoverNoDamage" checked={noDamage}
                                    onChange={event => { setNoDamage(event.target.checked); changed(); }} />
                                {' '}<span className="form-check-label">Keine Auffälligkeiten bei der gemeinsamen Prüfung festgestellt</span>
                            </label>
                            <h3 className="h5">2. Zustand dokumentieren</h3>
                            <div id="handoverEntries">
                                {entries.map((entry, index) => (
                                    <section className="protocol-form-section" data-entry={index} key={index}>
                                        <div className="d-flex justify-content-between gap-2">
                                            <h3 className="h5">Eintrag {index + 1}</h3>
                                            <button type="button" className="btn btn-outline-danger btn-sm" data-remove={index}
                                                onClick={() => removeEntry(index)}>Eintrag entfernen</button>
                                        </div>
                                        <div className="row g-3">
                                            <div className="col-md-6">
                                                <label className="form-label" htmlFor={`handoverItem${index}`}>Artikel</label>
                                                <select className="form-select" id={`handoverItem${index}`} data-field="item"
                                                    value={entry.itemId ?? ''} onChange={event => updateEntry(index, { itemId: Number(event.target.value) })}>
                                                    {data.items.map(item => (
                                                        <option key={item.id} value={item.id}>{item.title} · Position {item.id}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="col-md-6">
                                                <label className="form-label" htmlFor={`handoverKind${index}`}>Art</label>
                                                <select className="form-select" id={`handoverKind${index}`} data-field="kind"
                                                    value={entry.kind} onChange={event => updateEntry(index, { kind: event.target.value })}>
                                                    {Object.entries(KINDS).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
                                                </select>
                                            </div>
                                            <div className="col-12">
                                                <label htmlFor={`handoverText${index}`} className="form-label">Beschreibung / Lage am Artikel</label>
                                                <textarea className="form-control" rows={3} id={`handoverText${index}`} maxLength={2000}
                                                    value={entry.text} onChange={event => updateEntry(index, { text: event.target.value })} />
                                            </div>
                                            <div className="col-12">
                                                <label className="form-label" htmlFor={`handoverPhotos${index}`}>Fotos hinzufügen (mehrere auswählbar)</label>
                                                <input id={`handoverPhotos${index}`} type="file" className="form-control"
                                                    accept="image/jpeg,image/png,image/webp" multiple data-photos={index}
                                                    onChange={event => addPhotos(index, event.target)} />
                                                <p className="small text-muted">Bis zu 6 Fotos je Eintrag, insgesamt 20. PNG, JPEG oder WebP.</p>
                                                <div className="d-flex flex-wrap gap-2">
                                                    {entry.photos.map((photo, photoIndex) => (
                                                        <div key={photoIndex}>
                                                            <img className="handover-photo" src={photo} alt={`Eintrag ${index + 1}, Foto ${photoIndex + 1}`} />
                                                            <button type="button" className="btn btn-outline-danger btn-sm d-block mt-1"
                                                                data-remove-photo={`${index}:${photoIndex}`}
                                                                onClick={() => removePhoto(index, photoIndex)}>Foto entfernen</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </section>
                                ))}
                            </div>
                            <button type="button" className="btn btn-outline-primary mb-4" id="handoverAdd" onClick={addEntry}>Eintrag hinzufügen</button>
                            <div className="protocol-form-section">
                                <h3 className="h5">3. Bestätigen &amp; unterschreiben</h3>
                                <label htmlFor="handoverSigner" className="form-label">Name der unterschreibenden Person</label>
                                <input id="handoverSigner" className="form-control mb-3" maxLength={200} autoComplete="name"
                                    value={signer} onChange={event => { setSigner(event.target.value); changed(); }} />
                                <label className="form-check mb-3">
                                    <input type="checkbox" className="form-check-input" id="handoverConfirmed" checked={confirmed}
                                        onChange={event => setConfirmed(event.target.checked)} />
                                    <span className="form-check-label" id="handoverConfirmation">{data?.confirmation || ''}</span>
                                </label>
                                <p className="small text-muted">
                                    Bitte direkt auf dem Gerät unterschreiben. Änderungen am Protokoll löschen die Unterschrift und erfordern eine erneute Bestätigung.
                                </p>
                                <canvas id="handoverSignature" width={800} height={240} aria-label="Unterschriftenfeld für den Kunden"
                                    className="handover-signature" ref={canvasRef} />
                                <button type="button" id="handoverClear" className="btn btn-outline-secondary btn-sm mt-2"
                                    onClick={clearSignature}>Unterschrift löschen</button>
                            </div>
                        </fieldset>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">Schließen</button>
                        <a id="handoverPdf" className={signed ? 'btn btn-primary' : 'btn btn-primary d-none'}
                            href={data ? `${base}/${state.current.orderId}/handover/pdf?download=1` : undefined}>PDF herunterladen</a>
                        <button type="button" className={editable ? 'btn btn-outline-primary' : 'btn btn-outline-primary d-none'} id="handoverSave"
                            disabled={busy} onClick={() => save(false)}>Entwurf speichern</button>
                        <button type="button" className={editable ? 'btn btn-primary' : 'btn btn-primary d-none'} id="handoverFinalize"
                            disabled={busy} onClick={() => save(true)}>Unterschrieben festschreiben &amp; versenden</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
