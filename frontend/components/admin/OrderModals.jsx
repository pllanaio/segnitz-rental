import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getModal, hideModal } from '../../lib/bootstrap';
import { showAlert, showConfirm } from '../../lib/alerts';
import { formatLocalDate } from '../../lib/dateUtils';
import { isReturnFinalized } from '../../lib/orders';
import {
    computeReturn, formatReturnStatusLabel, hourlyExtensionOptions, normalizeDecimalInput, rentalPeriodPreview
} from '../../lib/adminReturns';

// "Zahlung vor Ort erfassen" for cash payments and on-site refunds.
export const ManualPaymentModal = forwardRef(function ManualPaymentModal({ onSaved }, ref) {
    const modalRef = useRef(null);
    const [mode, setMode] = useState(null);
    const [values, setValues] = useState({ orderId: '', orderItemId: '', paymentType: '', amount: '', note: '' });

    useImperativeHandle(ref, () => ({
        open(operation, { orderId, orderItemId, paymentType, amount }) {
            setMode(operation);
            setValues({
                orderId: orderId ?? '',
                orderItemId: orderItemId || '',
                paymentType,
                amount: Number(amount || 0).toFixed(2),
                note: operation === 'refund' ? 'Rückerstattung vor Ort an Kunden ausgezahlt' : ''
            });
            getModal(modalRef.current).show();
        }
    }));

    const submit = async () => {
        const refund = mode === 'refund';
        const amount = Number(values.amount);
        const note = values.note.trim();

        if (!values.orderId || !values.paymentType || !amount || amount <= 0) {
            showAlert(refund ? 'Bitte gültige Rückerstattungsdaten eingeben.' : 'Bitte gültige Zahlungsdaten eingeben.', 'warning');
            return;
        }

        try {
            const response = await fetch(refund ? '/admin/order-payments/manual-refund' : '/admin/order-payments/manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: String(values.orderId),
                    orderItemId: values.orderItemId ? String(values.orderItemId) : null,
                    paymentType: values.paymentType,
                    amount,
                    note
                })
            });
            const result = await response.json();

            if (!response.ok) {
                showAlert(result.error || (refund ? 'Rückerstattung konnte nicht erfasst werden.' : 'Zahlung konnte nicht erfasst werden.'), 'danger');
                return;
            }

            hideModal(modalRef.current);
            showAlert(result.message || (refund ? 'Rückerstattung wurde erfasst.' : 'Zahlung wurde erfasst.'), 'success');
            await onSaved(values.orderId);
        } catch (error) {
            console.error(refund ? 'Fehler beim Erfassen der Rückerstattung:' : 'Fehler beim Erfassen der Zahlung vor Ort:', error);
            showAlert(refund ? 'Rückerstattung konnte nicht erfasst werden.' : 'Zahlung konnte nicht erfasst werden.', 'danger');
        }
    };

    const title = mode === 'refund' ? 'Rückerstattung vor Ort erfassen' : mode === 'payment' ? 'Bargeldzahlung erfassen' : 'Zahlung vor Ort erfassen';

    return (
        <div className="modal fade" id="manualPaymentModal" tabIndex={-1} aria-hidden="true" style={{ zIndex: 3060 }} ref={modalRef}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title">{title}</h5>
                        <button type="button" className="btn-close" data-bs-dismiss="modal" />
                    </div>
                    <div className="modal-body">
                        <input type="hidden" id="manualPaymentOrderId" value={values.orderId} readOnly />
                        <input type="hidden" id="manualPaymentOrderItemId" value={values.orderItemId} readOnly />
                        <input type="hidden" id="manualPaymentType" value={values.paymentType} readOnly />
                        <div className="mb-3">
                            <label className="form-label" htmlFor="manualPaymentAmount">Betrag</label>
                            <input type="number" step="0.01" min="0.01" className="form-control" id="manualPaymentAmount"
                                value={values.amount} onChange={event => setValues(current => ({ ...current, amount: event.target.value }))} />
                        </div>
                        <div className="mb-3">
                            <label className="form-label" htmlFor="manualPaymentNote">Notiz</label>
                            <textarea className="form-control" id="manualPaymentNote" rows={3}
                                placeholder="z.B. Zahlung vor Ort im Ladengeschäft erhalten" value={values.note}
                                onChange={event => setValues(current => ({ ...current, note: event.target.value }))} />
                        </div>
                        <div className="alert alert-info mb-0">
                            Nach dem Speichern erhält der Kunde automatisch eine Zahlungsbestätigung per E-Mail.
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">Abbrechen</button>
                        <button type="button" className="btn btn-success" id="manualPaymentSubmitButton"
                            data-operation={mode || undefined} onClick={submit}>
                            {mode === 'refund' ? 'Rückerstattung erfassen' : 'Zahlung erfassen'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

// "Mietzeitraum verlängern" for a picked-up item.
export const RentalPeriodModal = forwardRef(function RentalPeriodModal({ onSaved }, ref) {
    const modalRef = useRef(null);
    const [target, setTarget] = useState(null);
    const [end, setEnd] = useState('');
    const [hours, setHours] = useState('');

    useImperativeHandle(ref, () => ({
        open(orderId, item) {
            const options = hourlyExtensionOptions(item);
            setTarget({ orderId, item, start: item.adjustedRentalStart || item.rentalStart || '' });
            setEnd(item.adjustedRentalEnd || item.rentalEnd || '');
            setHours(options.length ? String(options[0]) : '');
            getModal(modalRef.current).show();
        }
    }));

    const item = target?.item;
    const preview = item ? rentalPeriodPreview(item, { start: target.start, end, hours: Number(hours) }) : null;
    const effectiveEnd = preview?.hourly && preview.endDate ? preview.endDate : end;
    const pricePerDay = !item ? '' : preview.hourly ? String(item.adjustedPricePerDay || item.pricePerDay || '') : preview.price;

    const submit = async () => {
        if (!target) return;
        const payload = {
            adjustedRentalStart: target.start || null,
            adjustedRentalEnd: effectiveEnd || null,
            adjustedRentalHours: hours || null,
            adjustedPricePerDay: normalizeDecimalInput(pricePerDay),
            paymentMethod: 'online'
        };

        try {
            const response = await fetch(`/admin/order-items/${item.id}/rental-adjustment`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (!response.ok) {
                showAlert(result.error || 'Mietzeitraum konnte nicht gespeichert werden.', 'danger');
                return;
            }

            showAlert(result.message || 'Mietzeitraum gespeichert.', 'success');
            await onSaved(target.orderId);
            hideModal(modalRef.current);
        } catch (error) {
            console.error('Fehler beim Speichern des Mietzeitraums:', error);
            showAlert('Mietzeitraum konnte nicht gespeichert werden.', 'danger');
        }
    };

    return (
        <div className="modal fade" id="orderItemRentalPeriodModal" tabIndex={-1} aria-hidden="true" style={{ zIndex: 3060 }} ref={modalRef}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title">Mietzeitraum verlängern</h5>
                        <button type="button" className="btn-close" data-bs-dismiss="modal" />
                    </div>
                    <div className="modal-body">
                        <input type="hidden" id="rentalPeriodOrderId" value={target?.orderId ?? ''} readOnly />
                        <input type="hidden" id="rentalPeriodItemId" value={item?.id ?? ''} readOnly />
                        <div className="mb-3">
                            <label className="form-label" htmlFor="rentalPeriodStart">Mietbeginn</label>
                            <input type="date" className="form-control" id="rentalPeriodStart" value={target?.start || ''} disabled readOnly />
                        </div>
                        <div className="mb-3">
                            <label className="form-label" htmlFor="rentalPeriodEnd">Mietende</label>
                            <input type="date" className="form-control" id="rentalPeriodEnd" value={effectiveEnd || ''}
                                disabled={Boolean(item?.rentalHours)} onChange={event => setEnd(event.target.value)} />
                            <div id="rentalPeriodHoursField" className="mt-3" hidden={!item?.rentalHours}>
                                <label className="form-label" htmlFor="rentalPeriodHours">Neue gesamte Mietdauer</label>
                                <select id="rentalPeriodHours" className="form-select" value={hours} onChange={event => setHours(event.target.value)}>
                                    {(item ? hourlyExtensionOptions(item) : []).map(option => (
                                        <option key={option} value={option}>{option} Stunden</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <input type="hidden" id="rentalPeriodPricePerDay" value={pricePerDay} readOnly />
                        <input type="hidden" id="rentalPeriodPaymentMethod" value="online" readOnly />
                        <div className="alert alert-secondary mb-0" id="rentalPeriodPreview">
                            {!preview ? 'Preisvorschau erscheint nach Eingabe.' : preview.hourly ? preview.text : (
                                <>
                                    Ursprünglicher Preis: {preview.currentTotal.toFixed(2)} € inkl. MwSt.<br />
                                    Preis nach Verlängerung: {preview.newTotal.toFixed(2)} € inkl. MwSt.<br />
                                    Verlängerungstage: {preview.extensionDays}<br />
                                    Kunde muss zusätzlich zahlen: <strong>{preview.difference.toFixed(2)} € inkl. MwSt.</strong>
                                    {preview.invalidEnd
                                        ? <div className="text-danger mt-2">Das neue Mietende muss nach dem bisherigen Mietende liegen.</div>
                                        : null}
                                </>
                            )}
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">Abbrechen</button>
                        <button type="button" className="btn btn-primary" id="submitOrderItemRentalPeriodButton" onClick={submit}>
                            Verlängerung speichern
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

// "Artikel stornieren" for a single order item.
export const CancelItemModal = forwardRef(function CancelItemModal({ onSaved }, ref) {
    const modalRef = useRef(null);
    const [target, setTarget] = useState({ orderId: '', itemId: '' });

    useImperativeHandle(ref, () => ({
        open(orderId, itemId) {
            setTarget({ orderId, itemId });
            getModal(modalRef.current).show();
        }
    }));

    const submit = async () => {
        try {
            const response = await fetch(`/admin/order-items/${target.itemId}/cancel`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const result = await response.json();

            if (!response.ok) {
                showAlert(result.error || 'Artikel konnte nicht storniert werden.', 'danger');
                return;
            }

            hideModal(modalRef.current);
            showAlert(result.message || 'Artikel wurde storniert.', 'success');
            await onSaved(target.orderId);
        } catch (error) {
            console.error('Fehler beim Stornieren der Bestellposition:', error);
            showAlert('Artikel konnte nicht storniert werden.', 'danger');
        }
    };

    return (
        <div className="modal fade" id="cancelOrderItemModal" tabIndex={-1} aria-hidden="true" style={{ zIndex: 3060 }} ref={modalRef}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title">Artikel stornieren</h5>
                        <button type="button" className="btn-close" data-bs-dismiss="modal" />
                    </div>
                    <div className="modal-body">
                        <input type="hidden" id="cancelOrderItemOrderId" value={target.orderId ?? ''} readOnly />
                        <input type="hidden" id="cancelOrderItemId" value={target.itemId ?? ''} readOnly />
                        <div className="alert alert-warning">Es wird nur dieser einzelne Artikel storniert, nicht die gesamte Bestellung.</div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">Abbrechen</button>
                        <button type="button" className="btn btn-danger" id="submitCancelOrderItemButton" onClick={submit}>Artikel stornieren</button>
                    </div>
                </div>
            </div>
        </div>
    );
});

const EMPTY_RETURN_FORM = {
    actualDate: '', actualTime: '', isDamaged: false, damageDescription: '', additionalChargeReason: '',
    additionalChargeAmount: '', paymentMethod: 'online', notes: ''
};

function SelectedReturnImages({ files, busy }) {
    const [urls, setUrls] = useState([]);

    useEffect(() => {
        const next = files.map(file => URL.createObjectURL(file));
        setUrls(next);
        return () => next.forEach(url => URL.revokeObjectURL(url));
    }, [files]);

    if (!files.length) return null;

    return (
        <>
            <div className="form-text">{files.length} Foto(s) zum Speichern ausgewählt</div>
            <div className="row g-2 mt-2">
                {files.map((file, index) => (
                    <div className="col-6 col-md-3" key={`${file.name}-${file.size}-${file.lastModified}`}>
                        {urls[index] ? (
                            <img src={urls[index]} alt={file.name} className="img-fluid rounded border"
                                style={{ height: 120, objectFit: 'cover', width: '100%' }} />
                        ) : null}
                        <button type="button" className="btn btn-outline-danger btn-sm w-100 mt-1"
                            data-backend-action="remove-selected-return-image" data-image-index={index}
                            aria-label={`${file.name} entfernen`} disabled={busy}>Entfernen</button>
                    </div>
                ))}
            </div>
        </>
    );
}

// "Rückgabe dokumentieren": condition, extra costs, photos and deposit settlement.
export const ReturnModal = forwardRef(function ReturnModal({ getPayments, busyRef, photoBusy, onSaved }, ref) {
    const modalRef = useRef(null);
    const uploadRef = useRef(null);
    const [target, setTarget] = useState(null);
    const [form, setForm] = useState(EMPTY_RETURN_FORM);
    const [selectedImages, setSelectedImages] = useState([]);
    const [saving, setSaving] = useState(false);
    const selectedRef = useRef([]);
    selectedRef.current = selectedImages;

    useImperativeHandle(ref, () => ({
        open(orderId, item) {
            setTarget({ orderId, item });
            setForm({
                actualDate: item.actualReturnDate || formatLocalDate(),
                actualTime: item.actualReturnTime || new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
                isDamaged: Boolean(item.isDamaged),
                damageDescription: item.damageDescription || '',
                additionalChargeReason: item.additionalChargeReason || '',
                additionalChargeAmount: item.additionalChargeAmount || '',
                paymentMethod: 'online',
                notes: item.returnNotes || ''
            });
            setSelectedImages([]);
            if (uploadRef.current) uploadRef.current.value = '';
            getModal(modalRef.current).show();
        },
        currentOrderId: () => target?.orderId,
        currentItemId: () => target?.item?.id,
        syncItem(item) {
            setTarget(current => current && Number(current.item.id) === Number(item?.id) ? { ...current, item } : current);
        },
        removeImage(imageId) {
            setTarget(current => current ? {
                ...current,
                item: { ...current.item, returnImages: (current.item.returnImages || []).filter(image => Number(image.id) !== Number(imageId)) }
            } : current);
        },
        removeSelectedImage(index) {
            if (busyRef.current.saving || busyRef.current.deleting || !Number.isInteger(index) || index < 0 ||
                index >= selectedRef.current.length) return;
            setSelectedImages(current => current.filter((_, fileIndex) => fileIndex !== index));
        }
    }));

    const item = target?.item;
    const computed = item ? computeReturn(item, getPayments(), form) : null;
    const busy = saving || photoBusy;
    const update = field => event => {
        const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
        setForm(current => ({ ...current, [field]: value }));
    };

    const addSelectedImages = event => {
        const input = event.target;
        const next = [...selectedRef.current];
        for (const file of Array.from(input.files || [])) {
            if (!next.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) {
                next.push(file);
            }
        }
        input.value = '';
        if (next.length > 10) {
            showAlert('Bitte höchstens 10 Rückgabefotos pro Speichervorgang auswählen.', 'warning');
            return;
        }
        setSelectedImages(next);
    };

    const uploadSelectedImages = async () => {
        const files = selectedRef.current;
        if (!files.length) return;
        const formData = new FormData();
        files.forEach(file => formData.append('images', file));
        const response = await fetch(`/admin/order-items/${item.id}/return-images`, { method: 'POST', body: formData });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Fotos konnten nicht hochgeladen werden.');
        if (uploadRef.current) uploadRef.current.value = '';
        setSelectedImages([]);
        // Persisted IDs keep the photos individually deletable if saving fails.
        const updatedItem = { ...item, returnImages: [...(item.returnImages || []), ...(result.images || [])] };
        setTarget(current => current ? { ...current, item: updatedItem } : current);
        return updatedItem;
    };

    const save = async () => {
        if (busyRef.current.saving || busyRef.current.deleting || !item) return;

        const payload = {
            actualReturnDate: form.actualDate || null,
            actualReturnTime: form.actualTime || null,
            adjustedRentalStart: item.adjustedRentalStart || item.rentalStart || null,
            adjustedRentalEnd: item.adjustedRentalEnd || item.rentalEnd || null,
            adjustedPricePerDay: normalizeDecimalInput(computed.pricePerDay),
            returnStatus: computed.returnStatus,
            isDamaged: Boolean(form.isDamaged),
            damageDescription: form.damageDescription.trim(),
            isLate: computed.isLate,
            lateDescription: String(item.lateDescription || '').trim(),
            depositDecision: computed.depositDecision,
            depositDeductionPercent: computed.depositDeductionPercent || null,
            depositRefundAmount: normalizeDecimalInput(computed.depositRefundAmount),
            depositDeductionReason: computed.depositDeductionReason.trim(),
            additionalChargeReason: form.additionalChargeReason.trim(),
            additionalChargeAmount: normalizeDecimalInput(form.additionalChargeAmount),
            additionalChargePaymentMethod: form.paymentMethod,
            returnNotes: form.notes.trim()
        };

        busyRef.current.saving = true;
        setSaving(true);
        try {
            // Upload once before finalization; a failed upload must not finalize
            // the return without its selected documentation.
            await uploadSelectedImages();
            const response = await fetch(`/admin/order-items/${item.id}/return`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (!response.ok) {
                showAlert(result.error || 'Rückgabe konnte nicht gespeichert werden.', 'danger');
                return;
            }

            await onSaved(target.orderId, result, () => hideModal(modalRef.current));
        } catch (error) {
            console.error('Fehler beim Speichern der Positionsrückgabe:', error);
            showAlert(error.message || 'Rückgabe konnte nicht gespeichert werden.', 'danger');
        } finally {
            busyRef.current.saving = false;
            setSaving(false);
        }
    };

    const submit = async () => {
        showAlert('Achtung: Die Rückgabe wird beim Speichern festgeschrieben und kann danach nicht mehr rückgängig gemacht werden.', 'warning');
        const confirmed = await showConfirm(
            'Die Rückgabe wird festgeschrieben und kann danach nicht mehr geändert oder rückgängig gemacht werden. Möchten Sie fortfahren?',
            'Rückgabe festschreiben'
        );
        if (!confirmed) return;
        await save();
    };

    const damaged = Boolean(form.isDamaged);
    const due = computed?.customerAdditionalDue || 0;

    return (
        <div className="modal fade lifecycle-modal" id="orderItemReturnModal" tabIndex={-1} aria-hidden="true" style={{ zIndex: 3060 }} ref={modalRef}>
            <div className="modal-dialog modal-lg modal-dialog-scrollable">
                <div className="modal-content">
                    <div className="modal-header">
                        <h2 className="modal-title h5">Rückgabe dokumentieren</h2>
                        <button type="button" className="btn-close btn-close-white" aria-label="Schließen" data-bs-dismiss="modal" />
                    </div>
                    <div className="modal-body">
                        <input type="hidden" id="returnOrderId" value={target?.orderId ?? ''} readOnly />
                        <input type="hidden" id="returnItemId" value={item?.id ?? ''} readOnly />
                        <input type="hidden" id="returnPricePerDay" value={computed?.pricePerDay ?? ''} readOnly />
                        <input type="hidden" id="returnStatus" value={computed?.returnStatus ?? ''} readOnly />
                        <input type="hidden" id="returnDepositDecision" value={computed?.depositDecision ?? ''} readOnly />
                        <input type="hidden" id="returnLateDescription" value={item?.lateDescription || ''} readOnly />
                        <input type="hidden" id="returnDepositDeductionPercent" value={computed?.depositDeductionPercent ?? ''} readOnly />
                        <input type="hidden" id="returnDepositRefundAmount" value={computed?.depositRefundAmount ?? ''} readOnly />
                        <input type="hidden" id="returnDepositDeductionReason" value={computed?.depositDeductionReason ?? ''} readOnly />

                        <p className="protocol-intro">Rückgabe prüfen, Zustand dokumentieren und die Abrechnung kontrollieren.</p>
                        <div className="row g-3 return-form-grid">
                            <div className="col-12"><h3 className="protocol-step">1. Mietzeitraum &amp; Rückgabe</h3></div>
                            <div className="col-12 col-md-4">
                                <label className="form-label" htmlFor="returnActualDate">Rückgabedatum</label>
                                <input type="date" className="form-control" id="returnActualDate" value={form.actualDate} onChange={update('actualDate')} />
                                <div id="returnTimeField" className="mt-3" hidden={!item?.rentalHours}>
                                    <label htmlFor="returnActualTime" className="form-label">Tatsächliche Rückgabezeit</label>
                                    <input type="time" className="form-control" id="returnActualTime" value={form.actualTime} onChange={update('actualTime')} />
                                </div>
                            </div>
                            <div className="col-12 col-md-4">
                                <label className="form-label" htmlFor="returnAdjustedStart">Mietbeginn</label>
                                <input type="date" className="form-control" id="returnAdjustedStart" disabled readOnly
                                    value={item ? item.adjustedRentalStart || item.rentalStart || '' : ''} />
                            </div>
                            <div className="col-12 col-md-4">
                                <label className="form-label" htmlFor="returnAdjustedEnd">Mietende</label>
                                <input type="date" className="form-control" id="returnAdjustedEnd" disabled readOnly
                                    value={item ? item.adjustedRentalEnd || item.rentalEnd || '' : ''} />
                            </div>

                            <div className="col-12"><h3 className="protocol-step">2. Zustand bei Rückgabe</h3></div>
                            <div className="col-12 col-md-6">
                                <div className="form-check">
                                    <input className="form-check-input" type="checkbox" id="returnIsDamaged" checked={damaged} onChange={update('isDamaged')} />
                                    <label className="form-check-label" htmlFor="returnIsDamaged">Beschädigt</label>
                                </div>
                            </div>
                            <div className="col-12 col-md-6">
                                <div className="form-check">
                                    <input className="form-check-input" type="checkbox" id="returnIsLate" disabled checked={Boolean(computed?.isLate)} readOnly />
                                    <label className="form-check-label" htmlFor="returnIsLate">Verspätet</label>
                                </div>
                                <div className="form-text">Wird automatisch aus Rückgabedatum und vereinbartem Mietende berechnet.</div>
                            </div>
                            <div className={damaged ? 'col-12' : 'col-12 d-none'} id="returnDamageDescriptionGroup">
                                <label className="form-label" htmlFor="returnDamageDescription">Schadensbeschreibung</label>
                                <textarea className="form-control" id="returnDamageDescription" rows={2} required={damaged}
                                    placeholder="Festgestellten Schaden konkret dokumentieren" value={form.damageDescription}
                                    onChange={update('damageDescription')} />
                            </div>

                            <div className="col-12"><h3 className="protocol-step">3. Mehrkosten &amp; Dokumentation</h3></div>
                            <div className="col-12 col-md-8">
                                <label className="form-label" htmlFor="returnAdditionalChargeReason">Zusätzliche Reparaturkosten / Forderung</label>
                                <input type="text" className="form-control" id="returnAdditionalChargeReason"
                                    placeholder="z.B. Reparatur Lüftermotor, Ersatzteil, Reinigung" required={(computed?.repairCosts || 0) > 0}
                                    value={form.additionalChargeReason} onChange={update('additionalChargeReason')} />
                            </div>
                            <div className="col-12 col-md-4">
                                <label className="form-label" htmlFor="returnAdditionalChargeAmount">Zusätzlicher Betrag</label>
                                <input type="number" step="0.01" min="0" className="form-control" id="returnAdditionalChargeAmount"
                                    value={form.additionalChargeAmount} onChange={update('additionalChargeAmount')} />
                            </div>
                            <div className={due > 0 ? 'col-12 col-md-6' : 'col-12 col-md-6 d-none'} id="returnAdditionalChargePaymentMethodGroup">
                                <label className="form-label" htmlFor="returnAdditionalChargePaymentMethod">Nachzahlung begleichen über</label>
                                <select className="form-select" id="returnAdditionalChargePaymentMethod" value={form.paymentMethod} onChange={update('paymentMethod')}>
                                    <option value="online">Mollie-Zahlungslink</option>
                                    <option value="cash">Zahlung vor Ort</option>
                                </select>
                            </div>
                            <div className="col-12">
                                <label className="form-label" htmlFor="returnNotes">Interne Notiz</label>
                                <textarea className="form-control" id="returnNotes" rows={2} value={form.notes} onChange={update('notes')} />
                            </div>
                            <div className="col-12">
                                <label className="form-label" htmlFor="returnImageUpload">Rückgabefotos</label>
                                <input type="file" className="form-control" id="returnImageUpload" accept="image/*" multiple ref={uploadRef}
                                    disabled={busy} onChange={addSelectedImages} />
                                <div className="form-text">Bis zu 10 Fotos auswählen oder nacheinander hinzufügen. Der Upload erfolgt einmalig mit „Rückgabe speichern“.</div>
                                <div id="returnSelectedImagePreview"><SelectedReturnImages files={selectedImages} busy={busy} /></div>
                                <div id="returnExistingImages" className="row g-2 mt-2">
                                    {(item?.returnImages || []).map(image => (
                                        <div className="col-6 col-md-3" key={image.id}>
                                            <a href={`/${image.imagePath}`} target="_blank" rel="noopener">
                                                <img src={`/${image.imagePath}`} alt="Rückgabefoto" className="img-fluid rounded border"
                                                    style={{ height: 120, objectFit: 'cover', width: '100%' }} />
                                            </a>
                                            {!isReturnFinalized(item) ? (
                                                <button type="button" className="btn btn-outline-danger btn-sm w-100 mt-1"
                                                    data-backend-action="delete-return-image" data-image-id={image.id}
                                                    data-order-id={target.orderId} disabled={busy}>Foto löschen</button>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="col-12">
                                <h3 className="protocol-step">4. Abrechnung prüfen</h3>
                                <div className="return-settlement-preview" id="returnPricePreview">
                                    {!computed ? 'Preisübersicht erscheint nach Eingabe.' : (
                                        <div className="admin-price-panel mt-3">
                                            <div className="summary-section-label">Rückgabevorschau</div>
                                            <div className="checkout-summary-row">
                                                <span>Rückgabestatus</span><strong>{formatReturnStatusLabel(computed.returnStatus)}</strong>
                                            </div>
                                            <div className="checkout-summary-row">
                                                <span>Verspätung</span>
                                                <strong>{computed.hourlyLate ? `${computed.hourlyLate.minutesLate} Minuten` : `${computed.lateDays} Tage`}</strong>
                                            </div>
                                            {computed.lateFee > 0 ? (
                                                <div className="checkout-summary-row">
                                                    <span>Verspätungskosten</span><strong className="text-danger">{computed.lateFee.toFixed(2)} €</strong>
                                                </div>
                                            ) : null}
                                            {computed.openRentalAdjustment > 0 ? (
                                                <div className="checkout-summary-row">
                                                    <span>Offene Mietverlängerung</span>
                                                    <strong className="text-danger">{computed.openRentalAdjustment.toFixed(2)} €</strong>
                                                </div>
                                            ) : null}
                                            <hr />
                                            {computed.earlyCredit.amount > 0 ? (
                                                <>
                                                    <div className="checkout-summary-row">
                                                        <span>Mieterstattung · {computed.earlyCredit.days} ungenutzte Tage</span>
                                                        <strong className="text-success">{computed.earlyCredit.amount.toFixed(2)} €</strong>
                                                    </div>
                                                    <p className="small text-muted">Separater Korrekturbeleg; Auszahlung über das ursprüngliche Zahlungsmittel.</p>
                                                </>
                                            ) : null}
                                            <div className="summary-section-label">Kaution</div>
                                            <div className="checkout-summary-row">
                                                <span>Ursprüngliche Kaution</span><strong>{computed.deposit.toFixed(2)} €</strong>
                                            </div>
                                            <div className="checkout-summary-row">
                                                <span>Kaution zurück</span><strong className="text-success">{computed.refundAmount.toFixed(2)} €</strong>
                                            </div>
                                            <div className="checkout-summary-row">
                                                <span>Kaution einbehalten</span><strong className="text-danger">{computed.retainedAmount.toFixed(2)} €</strong>
                                            </div>
                                            <hr />
                                            <div className="summary-section-label">Nachzahlung</div>
                                            <div className="checkout-summary-total-row">
                                                <span>Kunde muss zusätzlich zahlen</span>
                                                <strong className={due > 0 ? 'text-danger' : 'text-muted'}>{due.toFixed(2)} €</strong>
                                            </div>
                                            {due > 0 ? (
                                                <div className="small text-muted mt-2">
                                                    Zahlungsweg: {form.paymentMethod === 'cash' ? 'Zahlung vor Ort' : 'Mollie-Zahlungslink'}
                                                </div>
                                            ) : null}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">Abbrechen</button>
                        <button type="button" className="btn btn-primary" id="submitOrderItemReturnButton" disabled={busy} onClick={submit}>
                            Rückgabe speichern
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});
