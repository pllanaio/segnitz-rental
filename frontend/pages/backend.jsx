import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import PageHead from '../components/PageHead';
import GlobalAlerts from '../components/GlobalAlerts';
import ConfirmModal from '../components/ConfirmModal';
import Preloader from '../components/Preloader';
import { SidebarLegal, SidebarLogo } from '../components/SidebarBrand';
import OrderOverview from '../components/orders/OrderOverview';
import OrderSheet from '../components/orders/OrderSheet';
import { OrderReturnProtocol, OrderSettlement } from '../components/orders/OrderSettlement';
import HandoverModal from '../components/orders/HandoverModal';
import Badge from '../components/orders/Badge';
import ProductsView from '../components/admin/ProductsView';
import CouponsView from '../components/admin/CouponsView';
import DeclarationsView from '../components/admin/DeclarationsView';
import InvoicesView from '../components/admin/InvoicesView';
import OpeningHoursView from '../components/admin/OpeningHoursView';
import PosView from '../components/admin/PosView';
import PosPaymentModal from '../components/admin/PosPaymentModal';
import { OrderPaymentActionPanel, toSheetPaymentActions } from '../components/admin/PaymentActions';
import { CancelItemModal, ManualPaymentModal, RentalPeriodModal, ReturnModal } from '../components/admin/OrderModals';
import { showAlert, showConfirm } from '../lib/alerts';
import { getModal } from '../lib/bootstrap';
import { exposeGlobals, renderToHtml } from '../lib/compat';
import { useDelegatedClick } from '../lib/delegation';
import { invoiceFetch, orderDisplayBadge, returnBadge } from '../lib/orders';
import { buildItemActions, buildOrderPaymentActions, canCancelOrder } from '../lib/adminPayments';

const ORDERS_PER_PAGE = 10;
const MONTH_LABELS = {
    '01': 'Januar', '02': 'Februar', '03': 'März', '04': 'April', '05': 'Mai', '06': 'Juni',
    '07': 'Juli', '08': 'August', '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Dezember'
};
const ORDER_FILTERS = [
    { id: 'orderYearFilter', key: 'year', label: 'Alle Jahre', column: 'col-12 col-md-2', options: 'years', labels: {} },
    { id: 'orderMonthFilter', key: 'month', label: 'Alle Monate', column: 'col-12 col-md-2', options: 'months', labels: MONTH_LABELS },
    {
        id: 'orderStatusFilter', key: 'status', label: 'Alle Status', column: 'col-12 col-md-2', options: 'statuses',
        labels: {
            reserved: 'Reserviert', confirmed: 'Bestätigt', paid: 'Bezahlt', active: 'Aktiv', picked_up: 'Abgeholt',
            returned: 'Zurückgegeben', cancelled: 'Storniert', expired: 'Abgelaufen'
        }
    },
    {
        id: 'orderReturnStatusFilter', key: 'returnStatus', label: 'Alle Rückgabestatus', column: 'col-12 col-md-3', options: 'returnStatuses',
        labels: {
            pending: 'Offen', returned_ok: 'Ordnungsgemäß zurückgegeben', returned_late: 'Verspätet zurückgegeben',
            returned_damaged: 'Beschädigt zurückgegeben', returned_late_damaged: 'Verspätet und beschädigt', not_required: 'Nicht erforderlich'
        }
    },
    {
        id: 'orderPaymentStatusFilter', key: 'paymentStatus', label: 'Alle Zahlungsstatus', column: 'col-12 col-md-3', options: 'paymentStatuses',
        labels: {
            refund_pending: 'Erstattung ausstehend', unpaid: 'Unbezahlt', pending: 'Ausstehend', paid: 'Bezahlt',
            failed: 'Fehlgeschlagen', refunded: 'Erstattet', cancelled: 'Abgebrochen', expired: 'Abgelaufen'
        }
    }
];
const NAVIGATION = [
    { view: 'coupons', id: 'nav-coupons', icon: 'bi-ticket-perforated', label: 'Gutscheine & Rabatte' },
    { view: 'invoices', id: 'nav-invoices', icon: 'bi-receipt', label: 'Rechnungen' },
    { view: 'pos', id: 'nav-pos', icon: 'bi-credit-card', label: 'POS & Terminals' },
    { view: 'declarations', id: 'nav-declarations', icon: 'bi-arrow-counterclockwise', label: 'Widerrufe & Stornierungen' },
    { view: 'products', id: 'nav-products', icon: 'bi-box-seam', label: 'Produkte' },
    { view: 'orders', id: 'nav-orders', icon: 'bi-receipt', label: 'Bestellungen' },
    { view: 'opening-hours', id: 'nav-opening-hours', icon: 'bi-clock', label: 'Öffnungszeiten' }
];

function getOptionalNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function restoreOrderDetailsModalLayer() {
    const detailsModal = document.getElementById('orderDetailsModal');
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => { backdrop.style.zIndex = ''; });
    if (detailsModal && detailsModal.classList.contains('show')) document.body.classList.add('modal-open');
}

function logout() {
    fetch('/logout', { method: 'POST' })
        .then(response => {
            if (response.ok) window.location.href = 'index.html';
            else showAlert('Fehler beim Abmelden', 'danger');
        })
        .catch(error => console.error('Netzwerkfehler beim Logout:', error));
}

function AdminOrderSheet({ order }) {
    const itemActions = buildItemActions(order).map(button => (
        <button key={button.key} type="button" className={button.className} disabled={button.disabled} title={button.title}
            data-backend-action={button.action} data-order-id={button.orderId} data-item-id={button.itemId}>
            {button.label}
        </button>
    ));

    return (
        <OrderSheet order={order} admin statusBadge={orderDisplayBadge(order)}
            cancel={canCancelOrder(order) ? (
                <div className="col-12 order-cancel-action">
                    <button type="button" className="btn btn-outline-danger" data-backend-action="cancel-order" data-order-id={order.id}>
                        <i className="bi bi-trash" aria-hidden="true" /> Bestellung stornieren
                    </button>
                </div>
            ) : null}
            itemActions={itemActions}
            paymentActions={toSheetPaymentActions(buildOrderPaymentActions(order))} />
    );
}

export default function BackendPage() {
    const detailsModalRef = useRef(null);
    const productsRef = useRef(null);
    const couponsRef = useRef(null);
    const declarationsRef = useRef(null);
    const invoicesRef = useRef(null);
    const posRef = useRef(null);
    const openingHoursRef = useRef(null);
    const manualPaymentRef = useRef(null);
    const rentalPeriodRef = useRef(null);
    const cancelItemRef = useRef(null);
    const returnRef = useRef(null);
    const currentOrderRef = useRef({ items: [], payments: [] });
    const returnBusyRef = useRef({ saving: false, deleting: false });
    const pageRef = useRef(1);
    const paginationRef = useRef({ page: 1, limit: ORDERS_PER_PAGE, total: 0, totalPages: 1 });
    const queryRef = useRef('');
    const filtersRef = useRef({ year: '', month: '', status: '', returnStatus: '', paymentStatus: '' });

    const [loginStatus, setLoginStatus] = useState('');
    const [view, setView] = useState('products');
    const [orders, setOrders] = useState({ status: 'loading', items: [], pagination: paginationRef.current });
    const [filterOptions, setFilterOptions] = useState(null);
    const [filters, setFilters] = useState(filtersRef.current);
    const [query, setQuery] = useState('');
    const [detail, setDetail] = useState({ order: null, revision: 0 });
    const [photoBusy, setPhotoBusy] = useState(false);

    const loadOrders = useCallback(async () => {
        try {
            const params = new URLSearchParams({ page: String(pageRef.current), limit: String(ORDERS_PER_PAGE) });
            const trimmedQuery = queryRef.current.trim();
            if (trimmedQuery) params.set('query', trimmedQuery);
            Object.entries(filtersRef.current).forEach(([key, value]) => {
                if (value) params.set(key, value);
            });

            const response = await fetch(`/admin/orders?${params.toString()}`);
            const result = await response.json();

            if (!response.ok) {
                showAlert(result.error || 'Bestellungen konnten nicht geladen werden.', 'danger');
                return;
            }

            paginationRef.current = result.pagination || paginationRef.current;
            pageRef.current = paginationRef.current.page || pageRef.current;
            setOrders({ status: 'loaded', items: result.items || [], pagination: paginationRef.current });
            if (result.filterOptions) setFilterOptions(result.filterOptions);
        } catch (error) {
            console.error('Fehler beim Laden der Bestellungen:', error);
            showAlert('Bestellungen konnten nicht geladen werden.', 'danger');
        }
    }, []);

    const renderOrderDetails = useCallback(order => {
        currentOrderRef.current = { items: order.items || [], payments: order.payments || [] };
        flushSync(() => setDetail(current => ({ order, revision: current.revision + 1 })));
    }, []);

    const fetchOrder = async orderId => {
        const response = await fetch(`/admin/orders/${orderId}`);
        const order = await response.json();
        return response.ok ? order : null;
    };

    const refreshOrderDetails = async orderId => {
        const order = await fetchOrder(orderId);
        if (order) renderOrderDetails(order);
        return order;
    };

    const openOrderDetails = useCallback(async orderId => {
        try {
            const sync = await fetch(`/admin/orders/${orderId}/payments/sync`, { method: 'POST' });
            if (!sync.ok) showAlert('Mollie konnte gerade nicht abgefragt werden. Angezeigt wird der zuletzt bestätigte Zahlungsstand.', 'warning');
            else await loadOrders();
            const response = await fetch(`/admin/orders/${orderId}`);
            const order = await response.json();

            if (!response.ok) {
                showAlert(order.error || 'Bestellung konnte nicht geladen werden.', 'danger');
                return;
            }

            renderOrderDetails(order);
            getModal(detailsModalRef.current).show();
        } catch (error) {
            console.error(error);
            showAlert('Fehler beim Laden der Bestellung.', 'danger');
        }
    }, [loadOrders, renderOrderDetails]);

    useEffect(() => {
        (async () => {
            try {
                const response = await fetch('/auth-status');
                if (!response.ok) throw new Error(`Auth-Status konnte nicht geladen werden (${response.status}).`);
                const data = await response.json();
                setLoginStatus(`Angemeldet als: ${data.user}`);
            } catch (error) {
                console.error('Auth-Status Fehler:', error);
                setLoginStatus('Benutzer konnte nicht geladen werden');
            }
        })();
    }, []);

    useEffect(() => exposeGlobals({
        openOrderDetails,
        renderOrderDetails,
        loadOrders,
        renderOrderPaymentActionPanel: order => renderToHtml(<OrderPaymentActionPanel order={order} actions={buildOrderPaymentActions(order)} />),
        renderClearOrderCalculation: order => renderToHtml(<OrderSettlement order={order} />),
        renderOrderReturnProtocol: (order, admin) => renderToHtml(<OrderReturnProtocol order={order} admin={Boolean(admin)} />),
        getReturnBadge: (status, orderStatus = null) => renderToHtml(<Badge badge={returnBadge(status, orderStatus, true)} />)
    }), [openOrderDetails, renderOrderDetails, loadOrders]);

    const switchView = nextView => {
        setView(nextView);
        if (nextView === 'invoices') invoicesRef.current.load();
        if (nextView === 'pos') posRef.current.load();
        if (nextView === 'coupons') couponsRef.current.load();
        if (nextView === 'declarations') declarationsRef.current.load();
        if (nextView === 'products') productsRef.current.showList();
        if (nextView === 'orders') loadOrders();
        if (nextView === 'opening-hours') openingHoursRef.current.load();
    };

    const afterOrderChange = async orderId => {
        await loadOrders();
        await refreshOrderDetails(orderId);
    };

    const cancelOrder = async orderId => {
        if (!(await showConfirm('Möchten Sie diese Bestellung wirklich vollständig stornieren?', 'Bestellung stornieren'))) return;
        try {
            const response = await fetch(`/admin/orders/${orderId}/cancel`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const result = await response.json();
            if (!response.ok) {
                showAlert(result.error || 'Bestellung konnte nicht storniert werden.', 'danger');
                return;
            }
            showAlert(result.message || 'Bestellung wurde storniert.', 'success');
            await afterOrderChange(orderId);
        } catch (error) {
            console.error('Fehler beim Stornieren der Bestellung:', error);
            showAlert('Bestellung konnte nicht storniert werden.', 'danger');
        }
    };

    const retryOnlineRefund = async (paymentId, orderId) => {
        if (!(await showConfirm('Soll die fehlgeschlagene Online-Erstattung erneut bei Mollie beauftragt werden?', 'Erstattung erneut versuchen'))) return;
        try {
            const response = await fetch(`/admin/order-payments/${paymentId}/retry-refund`, { method: 'POST' });
            const result = await response.json();
            if (!response.ok) {
                showAlert(result.error || 'Erstattung konnte nicht erneut gestartet werden.', 'danger');
                return;
            }
            showAlert(result.message || 'Erstattung wurde erneut gestartet.', result.paymentStatus === 'failed' ? 'warning' : 'success');
            await refreshOrderDetails(orderId);
            await loadOrders();
        } catch (error) {
            console.error('Fehler beim erneuten Starten der Online-Erstattung:', error);
            showAlert('Erstattung konnte nicht erneut gestartet werden.', 'danger');
        }
    };

    const markItemPickedUp = async (orderId, itemId) => {
        try {
            const response = await fetch(`/admin/order-items/${itemId}/pickup`, { method: 'PUT' });
            const result = await response.json();
            if (!response.ok) {
                showAlert(result.error || 'Artikel konnte nicht als abgeholt markiert werden.', 'danger');
                return;
            }
            showAlert(result.message || 'Artikel wurde als abgeholt markiert.', 'success');
            await afterOrderChange(orderId);
        } catch (error) {
            console.error('Fehler beim Markieren des Artikels als abgeholt:', error);
            showAlert('Artikel konnte nicht als abgeholt markiert werden.', 'danger');
        }
    };

    const setReturnPhotoDeleting = value => {
        returnBusyRef.current.deleting = value;
        setPhotoBusy(value);
    };

    const deleteReturnImage = async (imageId, orderId) => {
        if (returnBusyRef.current.saving || returnBusyRef.current.deleting) return;
        setReturnPhotoDeleting(true);
        try {
            if (!(await showConfirm('Möchten Sie dieses Rückgabefoto wirklich löschen?', 'Rückgabefoto löschen'))) return;
            const response = await fetch(`/admin/return-images/${imageId}`, { method: 'DELETE' });
            const result = await response.json();
            if (!response.ok) {
                showAlert(result.error || 'Foto konnte nicht gelöscht werden.', 'danger');
                return;
            }
            // Remove the confirmed deletion locally even if refreshing details fails.
            currentOrderRef.current.items.forEach(item => {
                item.returnImages = (item.returnImages || []).filter(image => Number(image.id) !== Number(imageId));
            });
            const returnModal = returnRef.current;
            const sameOrder = Number(returnModal.currentOrderId()) === Number(orderId);
            if (sameOrder) returnModal.removeImage(imageId);
            showAlert(result.message || 'Foto wurde gelöscht.', 'success');
            const updatedOrder = await fetchOrder(orderId);
            if (updatedOrder) {
                renderOrderDetails(updatedOrder);
                if (sameOrder) {
                    returnModal.syncItem((updatedOrder.items || []).find(item => Number(item.id) === Number(returnModal.currentItemId())));
                }
            }
        } catch (error) {
            console.error('Fehler beim Löschen des Rückgabefotos:', error);
            showAlert('Foto konnte nicht gelöscht werden.', 'danger');
        } finally {
            setReturnPhotoDeleting(false);
        }
    };

    const findCurrentOrderItem = itemId => currentOrderRef.current.items.find(item => Number(item.id) === Number(itemId));

    useDelegatedClick('[data-backend-action]', button => {
        const action = button.dataset.backendAction;
        const orderId = getOptionalNumber(button.dataset.orderId);
        const itemId = getOptionalNumber(button.dataset.itemId);
        const amount = getOptionalNumber(button.dataset.amount) || 0;
        const productId = getOptionalNumber(button.dataset.productId);

        const actions = {
            'edit-product': () => productsRef.current.editProduct(productId),
            'delete-product': () => productsRef.current.deleteProduct(productId),
            'open-order-details': () => openOrderDetails(orderId),
            'change-order-page': () => {
                const nextPage = pageRef.current + Number(button.dataset.direction);
                if (nextPage < 1 || nextPage > paginationRef.current.totalPages) return;
                pageRef.current = nextPage;
                loadOrders();
            },
            'cancel-order': () => cancelOrder(orderId),
            'open-manual-payment': () => manualPaymentRef.current.open('payment', { orderId, orderItemId: itemId, paymentType: button.dataset.paymentType, amount }),
            'open-manual-refund': () => manualPaymentRef.current.open('refund', { orderId, orderItemId: itemId, paymentType: button.dataset.paymentType, amount }),
            'retry-online-refund': () => retryOnlineRefund(getOptionalNumber(button.dataset.paymentId), orderId),
            'delete-return-image': () => deleteReturnImage(getOptionalNumber(button.dataset.imageId), orderId),
            'remove-selected-return-image': () => returnRef.current.removeSelectedImage(Number(button.dataset.imageIndex)),
            'mark-item-picked-up': () => markItemPickedUp(orderId, itemId),
            'open-rental-period': () => {
                const item = findCurrentOrderItem(itemId);
                if (!item) { showAlert('Artikel wurde nicht gefunden.', 'danger'); return; }
                rentalPeriodRef.current.open(orderId, item);
            },
            'open-cancel-item': () => cancelItemRef.current.open(orderId, itemId),
            'open-return-item': () => {
                const item = findCurrentOrderItem(itemId);
                if (!item) { showAlert('Artikel wurde nicht gefunden.', 'danger'); return; }
                returnRef.current.open(orderId, item);
            }
        };

        actions[action]?.();
    });

    // "Kauf auf Rechnung" for the initial payment.
    useDelegatedClick('[data-transfer-order]', async button => {
        if (!(await showConfirm('Miete und Kaution gemeinsam mit 14 Tagen Zahlungsziel berechnen? Die Abholung ist vor Zahlung erlaubt.', 'Kauf auf Rechnung'))) return;
        button.disabled = true;
        try {
            await invoiceFetch(`/admin/orders/${Number(button.dataset.transferOrder)}/invoice/offer-transfer`, 'POST', {});
            await openOrderDetails(Number(button.dataset.transferOrder));
        } catch (error) {
            showAlert(error.message, 'danger');
        } finally {
            button.disabled = false;
        }
    });

    // Separate Mollie bank-transfer link for an additional payment.
    useDelegatedClick('[data-additional-transfer]', async button => {
        if (!(await showConfirm('Für diese Nachzahlung einen eigenen Mollie-Zahlungslink anfordern? Die ursprüngliche Mietrechnung und deren Zahlungslink bleiben unverändert. Ein vorhandener Zahlungsversuch dieser Nachzahlung wird gegebenenfalls ersetzt.', 'Überweisung anfordern'))) return;
        button.disabled = true;
        try {
            const result = await invoiceFetch(`/admin/orders/${button.dataset.additionalTransfer}/additional-transfer`, 'POST', {
                orderItemId: Number(button.dataset.item),
                paymentType: button.dataset.type
            });
            showAlert(result.message, 'success');
            await openOrderDetails(Number(button.dataset.additionalTransfer));
        } catch (error) {
            showAlert(error.message, 'danger');
        } finally {
            button.disabled = false;
        }
    });

    const onReturnSaved = async (orderId, result, hideReturnModal) => {
        const updatedOrder = await fetchOrder(orderId);
        if (updatedOrder) renderOrderDetails(updatedOrder);
        hideReturnModal();
        window.setTimeout(restoreOrderDetailsModalLayer, 300);
        showAlert(result.message || 'Rückgabe gespeichert.', 'success');
        await loadOrders();
        if (orderId) {
            const latestOrder = await fetchOrder(orderId);
            if (latestOrder) {
                renderOrderDetails(latestOrder);
                window.setTimeout(() => getModal(detailsModalRef.current).show(), 300);
            }
        }
    };

    const changeFilter = (key, value) => {
        filtersRef.current = { ...filtersRef.current, [key]: value };
        setFilters(filtersRef.current);
        pageRef.current = 1;
        loadOrders();
    };

    const totalPages = orders.pagination.totalPages || 1;
    const currentPage = pageRef.current;
    const order = detail.order;

    return (
        <>
            <PageHead title="Segnitz Rental - Backend">
                <link rel="stylesheet" href="/css/handover.css?v=b71de8edc26b" />
            </PageHead>
            <style>{'.btn-primary:hover { background-color: #0d6efd; border-color: #0d6efd; }'}</style>
            <GlobalAlerts variant="admin" />
            <div className="container-fluid min-vh-100 p-0">
                <div className="row g-0 min-vh-100">
                    <aside className="col-12 col-md-3 col-xl-2 bg-primary text-white p-4">
                        <SidebarLogo linked />
                        <p id="backend-login-status" className="mt-4 small">{loginStatus}</p>
                        <nav className="nav flex-column mt-4">
                            {NAVIGATION.map(entry => (
                                <button key={entry.view} className={`btn btn-outline-light text-start mb-2${view === entry.view ? ' active' : ''}`}
                                    id={entry.id} data-backend-view={entry.view} onClick={() => switchView(entry.view)}>
                                    <i className={`bi ${entry.icon}`} aria-hidden="true" /> {entry.label}
                                </button>
                            ))}
                        </nav>
                        <a href="/index.html">
                            <button type="button" className="btn btn-light w-100 mt-4">
                                <i className="bi bi-arrow-left-circle" /> Admin Dashboard verlassen
                            </button>
                        </a>
                        <button type="button" className="btn btn-danger w-100 mt-2" id="backendLogoutButton" onClick={logout}>
                            <i className="bi bi-x-circle" /> Abmelden
                        </button>
                        <SidebarLegal />
                    </aside>

                    <main className="col-12 col-md-9 col-xl-10 p-4 p-lg-5">
                        <div id="qbox-container_form" className="w-100">
                            <InvoicesView ref={invoicesRef} visible={view === 'invoices'} />
                            <PosView ref={posRef} visible={view === 'pos'} />
                            <CouponsView ref={couponsRef} visible={view === 'coupons'} />
                            <DeclarationsView ref={declarationsRef} visible={view === 'declarations'} />
                            <ProductsView ref={productsRef} visible={view === 'products'} />

                            <div id="ordersView" className={view === 'orders' ? undefined : 'd-none'}>
                                <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                                    <h2 className="mb-0">Bestellungen</h2>
                                    <input type="search" id="orderSearchInput" className="form-control w-auto" placeholder="Bestellung suchen..."
                                        value={query}
                                        onChange={event => {
                                            setQuery(event.target.value);
                                            queryRef.current = event.target.value;
                                            pageRef.current = 1;
                                            loadOrders();
                                        }} />
                                </div>
                                <div className="card mb-3">
                                    <div className="card-body">
                                        <div className="row g-2">
                                            {ORDER_FILTERS.map(filter => (
                                                <div className={filter.column} key={filter.id}>
                                                    <select id={filter.id} className="form-select" aria-label={filter.label} value={filters[filter.key]}
                                                        onChange={event => changeFilter(filter.key, event.target.value)}>
                                                        <option value="">{filter.label}</option>
                                                        {(filterOptions?.[filter.options] || []).filter(Boolean).sort().map(value => (
                                                            <option key={value} value={value}>{filter.labels[value] || value}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div id="ordersList">
                                    {orders.status === 'loading'
                                        ? <div className="alert alert-info">Bestellungen werden geladen...</div>
                                        : !orders.items.length
                                            ? <div className="alert alert-info">Keine Bestellungen gefunden.</div>
                                            : (
                                                <>
                                                    {orders.items.map(entry => (
                                                        <div className="card mb-3" key={entry.id}><OrderOverview order={entry} admin /></div>
                                                    ))}
                                                    <div className="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
                                                        <div className="text-muted small">
                                                            {orders.pagination.total} Bestellung{orders.pagination.total === 1 ? '' : 'en'} gefunden, Seite {currentPage} von {totalPages}
                                                        </div>
                                                        <div className="btn-group">
                                                            <button type="button" className="btn btn-outline-primary btn-sm" disabled={currentPage <= 1}
                                                                data-backend-action="change-order-page" data-direction="-1">Zurück</button>
                                                            <button type="button" className="btn btn-outline-primary btn-sm" disabled={currentPage >= totalPages}
                                                                data-backend-action="change-order-page" data-direction="1">Weiter</button>
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                </div>
                            </div>

                            <OpeningHoursView ref={openingHoursRef} visible={view === 'opening-hours'} />
                        </div>
                    </main>
                </div>
            </div>
            <Preloader />

            <div className="modal fade order-sheet-modal" id="orderDetailsModal" tabIndex={-1} aria-hidden="true" ref={detailsModalRef}>
                <div className="modal-dialog modal-xl modal-dialog-scrollable">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h5 className="modal-title">{order ? `Bestellung ${order.order_no}` : 'Bestelldetails'}</h5>
                            <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="Schließen" />
                        </div>
                        <div className={order ? 'modal-body order-sheet' : 'modal-body'} id="orderDetailsBody">
                            {order
                                ? <AdminOrderSheet key={`${order.id}-${detail.revision}`} order={order} />
                                : <div className="alert alert-info">Bestellung wird geladen...</div>}
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">Schließen</button>
                        </div>
                    </div>
                </div>
            </div>

            <ConfirmModal />
            <RentalPeriodModal ref={rentalPeriodRef} onSaved={afterOrderChange} />
            <CancelItemModal ref={cancelItemRef} onSaved={afterOrderChange} />
            <ReturnModal ref={returnRef} getPayments={() => currentOrderRef.current.payments} busyRef={returnBusyRef}
                photoBusy={photoBusy} onSaved={onReturnSaved} />
            <ManualPaymentModal ref={manualPaymentRef} onSaved={async orderId => {
                await refreshOrderDetails(orderId);
                await loadOrders();
            }} />
            <PosPaymentModal onOrderSettled={async details => {
                renderOrderDetails(details);
                await loadOrders();
            }} />
            <HandoverModal onReturnToOrder={orderId => openOrderDetails(orderId)} />
        </>
    );
}
