import { forwardRef, useImperativeHandle, useRef } from 'react';
import CartSummaryRows from './CartSummaryRows';
import { getModal, hideModal } from '../../lib/bootstrap';
import {
    calculateCartTotals, calculateRentalDays, describeCartItemDuration, formatCurrency, getItemDeposit, getItemPricePerDay
} from '../../lib/shop';

const CartModal = forwardRef(function CartModal({ items, onEditItem, onDeleteItem, onClearCart, onNext }, ref) {
    const modalRef = useRef(null);

    useImperativeHandle(ref, () => ({
        element: () => modalRef.current,
        hide: () => hideModal(modalRef.current)
    }));

    return (
        <div className="modal fade" id="cartModal" tabIndex={-1} aria-hidden="true" ref={modalRef}>
            <div className="modal-dialog modal-dialog-centered modal-lg">
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title"><i className="bi bi-cart3" /> Warenkorb</h5>
                        <button type="button" className="btn-close" data-bs-dismiss="modal" />
                    </div>

                    <div className="modal-body">
                        <div id="cartItems">
                            {items.length === 0
                                ? <div className="alert alert-info mb-0">Ihr Warenkorb ist leer.</div>
                                : items.map(item => {
                                    const days = calculateRentalDays(item.rentalStart, item.rentalEnd);
                                    const pricePerDay = getItemPricePerDay(item);
                                    return (
                                        <div className="border rounded p-3 mb-2" key={item.id}>
                                            <div className="d-flex justify-content-between gap-3">
                                                <div>
                                                    <strong>{item.title}</strong><br />
                                                    <span className="small text-muted">
                                                        {item.rentalStart} bis {item.rentalEnd} · {describeCartItemDuration(item)}
                                                    </span><br />
                                                    <span>{formatCurrency(pricePerDay)} {item.rentalHours ? 'für den Stundentarif' : '/ Tag'}</span><br />
                                                    <span>Kaution: {formatCurrency(getItemDeposit(item))}</span>
                                                </div>

                                                <div className="text-end">
                                                    <strong>{formatCurrency(days * pricePerDay)}</strong>

                                                    <div className="cart-item-actions mt-2">
                                                        <button type="button" className="btn btn-sm btn-outline-primary"
                                                            data-frontend-action="edit-cart-item" data-item-id={item.id}
                                                            onClick={() => onEditItem(item.id)}>
                                                            <i className="bi bi-calendar-range" /> Zeitraum ändern
                                                        </button>{' '}
                                                        <button type="button" className="btn btn-sm btn-outline-danger"
                                                            data-frontend-action="delete-cart-item" data-item-id={item.id}
                                                            onClick={() => onDeleteItem(item.id)}>
                                                            <i className="bi bi-trash" /> Entfernen
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                        <div id="cartSummary" className={items.length === 0 ? 'checkout-summary p-3 mt-3 d-none' : 'checkout-summary p-3 mt-3'}>
                            <CartSummaryRows idPrefix="cart" totals={calculateCartTotals(items)} />

                            <div className="text-end mt-3">
                                <button type="button" className="btn btn-outline-danger btn-sm" id="clearCartButton" onClick={onClearCart}>
                                    <i className="bi bi-trash" /> Warenkorb leeren
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">Schließen</button>
                        <button type="button" className="btn btn-primary" id="cartModalNextBtn" disabled={items.length === 0}
                            onClick={onNext}>
                            Weiter
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default CartModal;
