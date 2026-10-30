import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getModal, hideModal } from '../../lib/bootstrap';
import { createCalendar, formatCalendarDate } from '../../lib/calendar';
import { showAlert } from '../../lib/alerts';
import { loadBlockedPeriods } from './ProductDetailsModal';

const CartItemEditModal = forwardRef(function CartItemEditModal({ onSaved }, ref) {
    const modalRef = useRef(null);
    const rangeInputRef = useRef(null);
    const startRef = useRef(null);
    const endRef = useRef(null);
    const startTimeRef = useRef(null);
    const calendarRef = useRef(null);
    const [item, setItem] = useState(null);

    useEffect(() => () => calendarRef.current?.destroy(), []);

    useImperativeHandle(ref, () => ({
        async open(cartItem) {
            setItem(cartItem);
            startRef.current.value = cartItem.rentalStart;
            endRef.current.value = cartItem.rentalEnd;
            rangeInputRef.current.value = `${cartItem.rentalStart} bis ${cartItem.rentalEnd}`;
            startTimeRef.current.value = cartItem.rentalStartTime || '08:00';

            const blockedPeriods = await loadBlockedPeriods(cartItem.productId);
            const periods = Array.isArray(blockedPeriods) ? blockedPeriods : [];

            calendarRef.current?.destroy();
            calendarRef.current = createCalendar(rangeInputRef.current, {
                mode: cartItem.rentalHours ? 'single' : 'range',
                dateFormat: 'Y-m-d',
                minDate: 'today',
                defaultDate: cartItem.rentalHours ? [cartItem.rentalStart] : [cartItem.rentalStart, cartItem.rentalEnd],
                disable: periods
                    .filter(period => !cartItem.rentalHours || !period.rentalHours)
                    .map(period => ({ from: period.rentalStart, to: period.rentalEnd })),
                onChange(selectedDates) {
                    if (selectedDates.length === (cartItem.rentalHours ? 1 : 2)) {
                        startRef.current.value = formatCalendarDate(selectedDates[0], 'Y-m-d');
                        endRef.current.value = formatCalendarDate(selectedDates[cartItem.rentalHours ? 0 : 1], 'Y-m-d');
                    }
                }
            });

            getModal(modalRef.current).show();
        }
    }));

    const save = async () => {
        const itemId = item?.id;
        const rentalStart = startRef.current.value;
        const rentalEnd = endRef.current.value;

        if (!rentalStart || !rentalEnd) {
            showAlert('Bitte wählen Sie einen Mietzeitraum aus.', 'warning');
            return;
        }

        if (new Date(rentalEnd) < new Date(rentalStart)) {
            showAlert('Das Mietende darf nicht vor dem Mietbeginn liegen.', 'warning');
            return;
        }

        try {
            const response = await fetch(`/cart/items/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rentalStart,
                    rentalEnd,
                    rentalStartTime: startTimeRef.current?.value
                })
            });

            const result = await response.json();

            if (!response.ok) {
                showAlert(result.error || 'Mietzeitraum konnte nicht geändert werden.', 'danger');
                return;
            }

            hideModal(modalRef.current);
            await onSaved();
            showAlert('Mietzeitraum wurde aktualisiert.', 'success');
        } catch (error) {
            console.error('Fehler beim Aktualisieren des Mietzeitraums:', error);
            showAlert('Mietzeitraum konnte nicht geändert werden.', 'danger');
        }
    };

    return (
        <div className="modal fade" id="cartItemEditModal" tabIndex={-1} aria-hidden="true" ref={modalRef}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title">Zeitraum ändern</h5>
                        <button type="button" className="btn-close" data-bs-dismiss="modal" />
                    </div>

                    <div className="modal-body">
                        <input type="hidden" id="editCartItemId" value={item?.id ?? ''} readOnly />
                        <input type="hidden" id="editCartProductId" value={item?.productId ?? ''} readOnly />
                        <input type="hidden" id="editCartRentalStart" ref={startRef} />
                        <input type="hidden" id="editCartRentalEnd" ref={endRef} />

                        <h6 id="editCartItemTitle">{item?.title || ''}</h6>

                        <label className="form-label mt-3" htmlFor="editCartRentalRange">Neuer Mietzeitraum</label>

                        <input type="text" className="form-control" id="editCartRentalRange" readOnly ref={rangeInputRef} />
                        <label className="form-label d-block mt-3" id="editCartStartTimeLabel" hidden={!item?.rentalHours}>
                            Startzeit
                            <input type="time" id="editCartStartTime" className="form-control" ref={startTimeRef} />
                        </label>
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">Abbrechen</button>
                        <button type="button" className="btn btn-primary" id="saveCartItemRentalPeriodButton" onClick={save}>
                            Zeitraum speichern
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default CartItemEditModal;
