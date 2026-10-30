import { useCallback, useEffect, useRef, useState } from 'react';
import PageHead from '../components/PageHead';
import GlobalAlerts from '../components/GlobalAlerts';
import ConfirmModal from '../components/ConfirmModal';
import { SidebarLegal, SidebarLogo } from '../components/SidebarBrand';
import OrderOverview from '../components/orders/OrderOverview';
import OrderSheet from '../components/orders/OrderSheet';
import { OrderReturnProtocol, OrderSettlement } from '../components/orders/OrderSettlement';
import InvoiceArchive from '../components/orders/InvoiceArchive';
import HandoverModal from '../components/orders/HandoverModal';
import Badge from '../components/orders/Badge';
import { showAlert, showConfirm } from '../lib/alerts';
import { getModal } from '../lib/bootstrap';
import { exposeGlobals, renderToHtml } from '../lib/compat';
import { useDelegatedClick } from '../lib/delegation';
import { returnBadge, statusBadge } from '../lib/orders';
import { allowAddressChars, allowOnlyDigits } from '../lib/shop';

const ORDERS_PER_PAGE = 10;
const MONTH_LABELS = {
    '01': 'Januar', '02': 'Februar', '03': 'März', '04': 'April', '05': 'Mai', '06': 'Juni',
    '07': 'Juli', '08': 'August', '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Dezember'
};
const FILTERS = [
    { id: 'myOrderYearFilter', key: 'year', label: 'Alle Jahre', column: 'col-12 col-md-3', options: 'years', labels: {} },
    { id: 'myOrderMonthFilter', key: 'month', label: 'Alle Monate', column: 'col-12 col-md-3', options: 'months', labels: MONTH_LABELS },
    {
        id: 'myOrderStatusFilter', key: 'status', label: 'Alle Status', column: 'col-12 col-md-2', options: 'statuses',
        labels: {
            pending: 'Ausstehend', reserved: 'Reserviert', confirmed: 'Bestätigt', paid: 'Bezahlt', active: 'Aktiv',
            picked_up: 'Abgeholt', returned: 'Zurückgegeben', cancelled: 'Storniert', expired: 'Abgelaufen'
        }
    },
    {
        id: 'myOrderReturnStatusFilter', key: 'returnStatus', label: 'Alle Rückgabestatus', column: 'col-12 col-md-2',
        options: 'returnStatuses',
        labels: {
            pending: 'Offen', returned_ok: 'Ordnungsgemäß zurückgegeben', returned_late: 'Verspätet zurückgegeben',
            returned_damaged: 'Beschädigt zurückgegeben', returned_late_damaged: 'Verspätet und beschädigt',
            not_required: 'Nicht erforderlich'
        }
    },
    {
        id: 'myOrderPaymentStatusFilter', key: 'paymentStatus', label: 'Alle Zahlungsstatus', column: 'col-12 col-md-2',
        options: 'paymentStatuses',
        labels: {
            refund_pending: 'Erstattung ausstehend', unpaid: 'Unbezahlt', pending: 'Ausstehend', open: 'Offen',
            authorized: 'Autorisiert', paid: 'Bezahlt', failed: 'Fehlgeschlagen', refunded: 'Erstattet',
            cancelled: 'Abgebrochen', expired: 'Abgelaufen'
        }
    }
];
const EMPTY_FILTER_OPTIONS = { years: [], months: [], statuses: [], returnStatuses: [], paymentStatuses: [] };
const EMPTY_PROFILE = {
    customerNo: '', email: '', firstName: '', lastName: '', company: '', phone: '', address: '', zip: '', city: '', verified: ''
};

function ReviewCard({ item, orderId, onSubmit }) {
    const [rating, setRating] = useState('');
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);

    if (item.review) {
        return (
            <div className="card mt-3">
                <div className="card-body">
                    <h6>Ihre Bewertung für {item.title}</h6>
                    <div className="mb-2">
                        <strong>Sterne:</strong> {'★'.repeat(Number(item.review.rating))} {'☆'.repeat(5 - Number(item.review.rating))}
                    </div>
                    <div className="mb-2">
                        <strong>Kommentar:</strong><br />
                        <div className="border rounded p-2 bg-light">
                            {item.review.reviewText ? item.review.reviewText : <span className="text-muted">Kein Kommentar</span>}
                        </div>
                    </div>
                    <div className="text-muted small">Bewertet am: {item.review.createdAt || '-'}</div>
                </div>
            </div>
        );
    }

    return (
        <div className="card mt-3">
            <div className="card-body">
                <h6>Bewertung für {item.title}</h6>
                <div className="mb-2">
                    <label className="form-label" htmlFor={`rating-${item.productId}`}>Sterne</label>
                    <select className="form-select form-select-sm" id={`rating-${item.productId}`} value={rating}
                        onChange={event => setRating(event.target.value)}>
                        <option value="">Bitte auswählen</option>
                        <option value="5">5 Sterne</option>
                        <option value="4">4 Sterne</option>
                        <option value="3">3 Sterne</option>
                        <option value="2">2 Sterne</option>
                        <option value="1">1 Stern</option>
                    </select>
                </div>
                <div className="mb-2">
                    <label className="form-label" htmlFor={`reviewText-${item.productId}`}>Kommentar</label>
                    <textarea className="form-control form-control-sm" id={`reviewText-${item.productId}`} rows={2} maxLength={2000}
                        value={text} onChange={event => setText(event.target.value)} />
                    <div className="form-text">
                        Maximal 2000 Zeichen. Öffentlich erscheinen Ihr Vorname und nur der Anfangsbuchstabe Ihres Nachnamens.
                    </div>
                </div>
                <button type="button" className="btn btn-outline-success btn-sm" data-profile-action="submit-review"
                    data-product-id={item.productId} data-order-id={orderId} disabled={saving}
                    onClick={() => onSubmit({ productId: item.productId, orderId, rating, reviewText: text.trim(), setSaving })}>
                    {saving ? 'Bewertung wird gespeichert...' : 'Bewertung speichern'}
                </button>
            </div>
        </div>
    );
}

function uniqueReviewItems(order) {
    const reviewItemsByProductId = new Map();
    (order.items || []).forEach(item => {
        const productId = String(item.productId);
        if (!reviewItemsByProductId.has(productId)) {
            reviewItemsByProductId.set(productId, item);
            return;
        }
        const existingItem = reviewItemsByProductId.get(productId);
        if (!existingItem.review && item.review) {
            reviewItemsByProductId.set(productId, { ...existingItem, review: item.review });
        }
    });
    return [...reviewItemsByProductId.values()];
}

function canCancelMyOrder(order) {
    return ['reserved', 'pending_payment', 'payment_failed', 'confirmed'].includes(order.status) &&
        !(order.items || []).some(item => item.pickedUpAt || item.itemStatus === 'picked_up');
}

function cleanupBootstrapModalState() {
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
}

function logout() {
    fetch('/logout', { method: 'POST' })
        .then(response => {
            if (response.ok) {
                window.location.href = '/index.html';
            } else {
                console.error('Fehler beim Logout');
                showAlert('Fehler beim Abmelden', 'danger');
            }
        })
        .catch(error => {
            console.error('Netzwerkfehler beim Versuch, sich abzumelden:', error);
            showAlert('Netzwerkfehler', 'danger');
        });
}

export default function ProfilePage() {
    const detailsModalRef = useRef(null);
    const pageRef = useRef(1);
    const filtersRef = useRef({ year: '', month: '', status: '', returnStatus: '', paymentStatus: '' });

    const [view, setView] = useState('profile');
    const [invoiceSession, setInvoiceSession] = useState(0);
    const [profile, setProfile] = useState(EMPTY_PROFILE);
    const [profileLoaded, setProfileLoaded] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', newPasswordConfirm: '' });
    const [emailChange, setEmailChange] = useState({ newEmail: '', password: '', code: '', confirmVisible: false, busy: '' });
    const [emailMessage, setEmailMessage] = useState(null);
    const codeRef = useRef(null);
    const [orders, setOrders] = useState({ status: 'loading', items: [], pagination: { page: 1, limit: ORDERS_PER_PAGE, total: 0, totalPages: 1 } });
    const [filterOptions, setFilterOptions] = useState(EMPTY_FILTER_OPTIONS);
    const [filters, setFilters] = useState(filtersRef.current);
    const [detailOrder, setDetailOrder] = useState(null);
    // Every (re)load renders a fresh sheet, including its invoice documents.
    const [detailRevision, setDetailRevision] = useState(0);

    const switchView = useCallback(nextView => {
        setView(nextView);
        if (nextView === 'invoices') setInvoiceSession(current => current + 1);
    }, []);

    const loadMyOrders = useCallback(async () => {
        try {
            const params = new URLSearchParams({ page: String(pageRef.current), limit: String(ORDERS_PER_PAGE) });
            Object.entries(filtersRef.current).forEach(([key, value]) => {
                if (value) params.set(key, value);
            });

            const response = await fetch(`/my-orders?${params.toString()}`);
            const result = await response.json();

            if (!response.ok) {
                setOrders(current => ({ ...current, status: 'error', error: result.error || 'Bestellungen konnten nicht geladen werden.' }));
                return;
            }

            const items = Array.isArray(result.items) ? result.items : [];
            setOrders(current => {
                const pagination = result.pagination || current.pagination;
                const totalPages = Math.max(Number(pagination.totalPages || 1), 1);
                pageRef.current = Math.min(pageRef.current, totalPages);
                return { status: 'loaded', items, pagination };
            });
            if (result.filterOptions) setFilterOptions(result.filterOptions);
        } catch (error) {
            console.error('Fehler beim Laden der Bestellungen:', error);
            setOrders(current => ({ ...current, status: 'failed' }));
        }
    }, []);

    const openMyOrderDetails = useCallback(async orderId => {
        try {
            const response = await fetch(`/my-orders/${orderId}`);
            const order = await response.json();

            if (!response.ok) {
                showAlert(order.error || 'Bestellung konnte nicht geladen werden.', 'danger');
                return;
            }

            setDetailOrder(order);
            setDetailRevision(current => current + 1);
            getModal(detailsModalRef.current).show();
        } catch (error) {
            console.error('Fehler beim Laden der Bestellung:', error);
            showAlert('Bestellung konnte nicht geladen werden.', 'danger');
        }
    }, []);

    const refreshMyOrderDetails = useCallback(async orderId => {
        try {
            const response = await fetch(`/my-orders/${orderId}`);
            const order = await response.json();

            if (!response.ok) {
                showAlert(order.error || 'Bestellung konnte nicht aktualisiert werden.', 'danger');
                return;
            }

            setDetailOrder(order);
            setDetailRevision(current => current + 1);
        } catch (error) {
            console.error('Fehler beim Aktualisieren der Bestelldetails:', error);
            showAlert('Bestellung konnte nicht aktualisiert werden.', 'danger');
        }
    }, []);

    useEffect(() => {
        if (new URLSearchParams(window.location.search).get('view') === 'invoices') switchView('invoices');

        (async () => {
            try {
                const response = await fetch('/my-profile');

                if (!response.ok) {
                    window.location.href = '/login.html';
                    return;
                }

                const user = await response.json();
                setProfile({
                    customerNo: user.customerNo || '-',
                    email: user.email || '-',
                    firstName: user.firstName || '',
                    lastName: user.lastName || '',
                    company: user.company || '',
                    phone: user.phone || '',
                    address: user.address || '',
                    zip: user.zip || '',
                    city: user.city || '',
                    verified: user.emailVerified === 1 ? 'Ja' : 'Nein'
                });
                setProfileLoaded(true);
                await loadMyOrders();
            } catch (error) {
                setProfileError('Profil konnte nicht geladen werden.');
            }
        })();
    }, [loadMyOrders, switchView]);

    useEffect(() => {
        const element = detailsModalRef.current;
        element.addEventListener('hidden.bs.modal', cleanupBootstrapModalState);
        return () => element.removeEventListener('hidden.bs.modal', cleanupBootstrapModalState);
    }, []);

    useEffect(() => exposeGlobals({
        openMyOrderDetails,
        getReturnBadge: (status, orderStatus = null) => renderToHtml(<Badge badge={returnBadge(status, orderStatus, false)} />),
        renderClearOrderCalculation: order => renderToHtml(<OrderSettlement order={order} />),
        renderOrderReturnProtocol: (order, admin) => renderToHtml(<OrderReturnProtocol order={order} admin={Boolean(admin)} />)
    }), [openMyOrderDetails]);

    const cancelMyOrder = async (orderId, button) => {
        button.disabled = true;
        try {
            const confirmed = await showConfirm(
                'Möchten Sie die gesamte Bestellung vor der Abholung kostenfrei stornieren? Bereits gezahlte Beträge werden zur Erstattung vorgemerkt.',
                'Bestellung stornieren'
            );
            if (!confirmed) return;
            const response = await fetch(`/my-orders/${orderId}/cancel`, { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Stornierung nicht möglich.');
            showAlert(result.message, 'success');
            await loadMyOrders();
        } catch (error) {
            showAlert(error.message, 'danger');
        } finally {
            button.disabled = false;
        }
    };

    const submitProductReview = async ({ productId, orderId, rating, reviewText, setSaving }) => {
        if (!rating) {
            showAlert('Bitte wählen Sie eine Sternebewertung aus.', 'warning');
            return;
        }

        if (reviewText.length > 2000) {
            showAlert('Der Bewertungstext darf maximal 2000 Zeichen lang sein.', 'warning');
            return;
        }

        setSaving(true);

        try {
            const response = await fetch(`/products/${productId}/reviews`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId, rating: Number(rating), reviewText })
            });

            const result = await response.json();

            if (!response.ok) {
                setSaving(false);
                showAlert(result.error || 'Bewertung konnte nicht gespeichert werden.', 'danger');
                return;
            }

            showAlert(result.message || 'Bewertung wurde gespeichert.', 'success');
            await refreshMyOrderDetails(orderId);
            await loadMyOrders();
        } catch (error) {
            setSaving(false);
            console.error('Fehler beim Speichern der Bewertung:', error);
            showAlert('Bewertung konnte nicht gespeichert werden.', 'danger');
        }
    };

    useDelegatedClick('[data-profile-action]', button => {
        const action = button.dataset.profileAction;
        const orderId = Number(button.dataset.orderId);

        if (action === 'open-order-details') openMyOrderDetails(orderId);
        if (action === 'cancel-order') cancelMyOrder(orderId, button);
        if (action === 'change-order-page') {
            pageRef.current += Number(button.dataset.direction);
            loadMyOrders();
        }
    });

    const changeFilter = (key, value) => {
        filtersRef.current = { ...filtersRef.current, [key]: value };
        setFilters(filtersRef.current);
        pageRef.current = 1;
        loadMyOrders();
    };

    const updateProfileField = (field, value) => setProfile(current => ({ ...current, [field]: value }));

    const saveProfile = async event => {
        event.preventDefault();

        const payload = {
            firstName: profile.firstName.trim(),
            lastName: profile.lastName.trim(),
            company: profile.company.trim(),
            phone: profile.phone.trim(),
            address: profile.address.trim(),
            zip: profile.zip.trim(),
            city: profile.city.trim()
        };

        if (!/^[0-9]+$/.test(payload.phone)) {
            showAlert('Telefon darf nur Ziffern enthalten.', 'warning');
            return;
        }

        if (!/^[0-9]+$/.test(payload.zip)) {
            showAlert('PLZ darf nur Ziffern enthalten.', 'warning');
            return;
        }

        if (!/^[a-zA-Z0-9äöüÄÖÜß\s]+$/.test(payload.address)) {
            showAlert('Adresse darf nur Buchstaben, Zahlen und Leerzeichen enthalten.', 'warning');
            return;
        }

        try {
            const response = await fetch('/my-profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                showAlert(result.error || 'Profildaten konnten nicht gespeichert werden.', 'danger');
                return;
            }

            showAlert(result.message || 'Profildaten wurden gespeichert.', 'success');
        } catch (error) {
            console.error('Fehler beim Speichern der Profildaten:', error);
            showAlert('Profildaten konnten nicht gespeichert werden.', 'danger');
        }
    };

    const changePassword = async event => {
        event.preventDefault();

        if (!/^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/.test(passwords.newPassword)) {
            showAlert('Das Passwort muss mindestens 8 Zeichen, eine Zahl und ein Sonderzeichen enthalten.', 'warning');
            return;
        }

        try {
            const response = await fetch('/my-profile/password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(passwords)
            });

            const result = await response.json();

            if (!response.ok) {
                showAlert(result.error || 'Passwort konnte nicht geändert werden.', 'danger');
                return;
            }

            setPasswords({ currentPassword: '', newPassword: '', newPasswordConfirm: '' });
            showAlert(result.message || 'Passwort wurde geändert.', 'success');
        } catch (error) {
            console.error('Fehler beim Ändern des Passworts:', error);
            showAlert('Passwort konnte nicht geändert werden.', 'danger');
        }
    };

    const submitEmailChange = action => async event => {
        event.preventDefault();
        if (emailChange.busy) return;
        setEmailChange(current => ({ ...current, busy: action }));
        try {
            const body = action === 'request'
                ? { email: emailChange.newEmail.trim(), password: emailChange.password }
                : { code: emailChange.code.trim() };
            const response = await fetch('/my-profile/email/' + action, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Die Änderung konnte nicht verarbeitet werden.');
            setEmailMessage({ className: 'alert alert-success mt-3', text: result.message });
            setEmailChange(current => ({
                ...current,
                password: '',
                code: '',
                confirmVisible: action !== 'confirm',
                newEmail: action === 'confirm' ? '' : current.newEmail
            }));
            if (action === 'confirm') {
                setProfile(current => ({ ...current, email: result.email, verified: 'Ja' }));
            } else {
                window.setTimeout(() => codeRef.current?.focus(), 0);
            }
        } catch (error) {
            setEmailMessage({ className: 'alert alert-danger mt-3', text: error.message });
        } finally {
            setEmailChange(current => ({ ...current, busy: '' }));
        }
    };

    const totalPages = Math.max(Number(orders.pagination.totalPages || 1), 1);
    const currentPage = Math.min(pageRef.current, totalPages);
    const total = Number(orders.pagination.total || 0);

    let ordersContent;
    if (orders.status === 'loading') {
        ordersContent = <div className="alert alert-info">Bestellungen werden geladen...</div>;
    } else if (orders.status === 'error') {
        ordersContent = <div className="alert alert-warning">{orders.error}</div>;
    } else if (orders.status === 'failed') {
        ordersContent = <div className="alert alert-danger">Bestellungen konnten nicht geladen werden.</div>;
    } else if (!orders.items.length) {
        ordersContent = <div className="alert alert-info">Sie haben noch keine Bestellungen.</div>;
    } else {
        ordersContent = (
            <>
                {orders.items.map(order => (
                    <div className="card mb-3" key={order.id}><OrderOverview order={order} admin={false} /></div>
                ))}
                <div className="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
                    <div className="text-muted small">
                        {total} Bestellung{total === 1 ? '' : 'en'} gefunden, Seite {currentPage} von {totalPages}
                    </div>
                    <div className="btn-group">
                        <button type="button" className="btn btn-outline-primary btn-sm" disabled={currentPage <= 1}
                            data-profile-action="change-order-page" data-direction="-1">Zurück</button>
                        <button type="button" className="btn btn-outline-primary btn-sm" disabled={currentPage >= totalPages}
                            data-profile-action="change-order-page" data-direction="1">Weiter</button>
                    </div>
                </div>
            </>
        );
    }

    const profileInput = (id, field, props = {}) => (
        <input type="text" id={id} className="form-control" value={profile[field]}
            onChange={event => updateProfileField(field, props.filter ? props.filter(event.target.value) : event.target.value)}
            readOnly={props.readOnly} required={props.required} />
    );

    const navButton = (id, target, icon, label) => (
        <button className={`btn btn-outline-light text-start mb-2${view === target ? ' active' : ''}`} id={id}
            data-profile-view={target} onClick={() => switchView(target)}>
            <i className={`bi ${icon}`} /> {label}
        </button>
    );

    return (
        <>
            <PageHead title="Segnitz Rental - Mein Bereich">
                <link rel="stylesheet" href="/css/handover.css?v=b71de8edc26b" />
            </PageHead>
            <GlobalAlerts />

            <div className="container-fluid min-vh-100 p-0">
                <div className="row g-0 min-vh-100">
                    <aside className="col-12 col-md-3 col-xl-2 bg-primary text-white p-4">
                        <SidebarLogo linked />

                        <nav className="nav flex-column mt-4">
                            {navButton('nav-profile', 'profile', 'bi-person-vcard', 'Meine Daten')}
                            {navButton('nav-orders', 'orders', 'bi-receipt', 'Meine Bestellungen')}
                            {navButton('nav-invoices', 'invoices', 'bi-file-earmark-pdf', 'Meine Rechnungen')}
                        </nav>

                        <a href="/index.html">
                            <button className="btn btn-light w-100 mt-4"><i className="bi bi-arrow-left-circle" /> Mein Profil verlassen</button>
                        </a>

                        <button className="btn btn-danger w-100 mt-2" id="profileLogoutButton" onClick={logout}>
                            <i className="bi bi-x-circle" /> Abmelden
                        </button>
                        <SidebarLegal />
                    </aside>

                    <main className="col-12 col-md-9 col-xl-10 p-4 p-lg-5">
                        <div id="qbox-container_form" className="w-100">
                            <div id="profileView" className={view === 'profile' ? undefined : 'd-none'}>
                                <h2 className="mb-4">Meine Daten</h2>

                                <div id="profileError" className={profileError ? 'alert alert-danger' : 'alert alert-danger d-none'}>{profileError}</div>

                                <div id="profileBox" className={profileLoaded ? 'card' : 'card d-none'}>
                                    <div className="card-body">
                                        <form id="profileForm" onSubmit={saveProfile}>
                                            <div className="row g-3">
                                                <div className="col-12 col-lg-6">
                                                    <label className="form-label" htmlFor="customerNo">Kundennummer</label>
                                                    {profileInput('customerNo', 'customerNo', { readOnly: true })}
                                                </div>
                                                <div className="col-12 col-lg-6">
                                                    <label className="form-label" htmlFor="email">E-Mail</label>
                                                    <input type="email" id="email" className="form-control" value={profile.email} readOnly />
                                                </div>
                                                <div className="col-12 col-lg-6">
                                                    <label className="form-label" htmlFor="profileFirstName">Vorname</label>
                                                    {profileInput('profileFirstName', 'firstName', { required: true })}
                                                </div>
                                                <div className="col-12 col-lg-6">
                                                    <label className="form-label" htmlFor="profileLastName">Nachname</label>
                                                    {profileInput('profileLastName', 'lastName', { required: true })}
                                                </div>
                                                <div className="col-12">
                                                    <label className="form-label" htmlFor="profileCompany">Firma</label>
                                                    {profileInput('profileCompany', 'company')}
                                                </div>
                                                <div className="col-12 col-lg-6">
                                                    <label className="form-label" htmlFor="profilePhone">Telefon</label>
                                                    {profileInput('profilePhone', 'phone', { required: true, filter: allowOnlyDigits })}
                                                </div>
                                                <div className="col-12">
                                                    <label className="form-label" htmlFor="profileAddress">Adresse</label>
                                                    {profileInput('profileAddress', 'address', { required: true, filter: allowAddressChars })}
                                                </div>
                                                <div className="col-12 col-lg-4">
                                                    <label className="form-label" htmlFor="profileZip">PLZ</label>
                                                    {profileInput('profileZip', 'zip', { required: true, filter: allowOnlyDigits })}
                                                </div>
                                                <div className="col-12 col-lg-8">
                                                    <label className="form-label" htmlFor="profileCity">Ort</label>
                                                    {profileInput('profileCity', 'city', { required: true })}
                                                </div>
                                                <div className="col-12">
                                                    <label className="form-label" htmlFor="verified">E-Mail bestätigt</label>
                                                    {profileInput('verified', 'verified', { readOnly: true })}
                                                </div>
                                                <div className="col-12">
                                                    <button type="submit" className="btn btn-success">Daten speichern</button>
                                                </div>
                                            </div>
                                        </form>

                                        <hr className="my-4" />

                                        <h5>E-Mail-Adresse ändern</h5>
                                        <p>Die neue Adresse gilt erst nach Bestätigung. Sie wird danach auch zur Anmeldung und für Ihre Bestellungen verwendet.</p>
                                        <form id="emailChangeForm" className="row g-3" onSubmit={submitEmailChange('request')}>
                                            <div className="col-12 col-lg-6">
                                                <label htmlFor="newEmail" className="form-label">Neue E-Mail-Adresse</label>
                                                <input id="newEmail" type="email" autoComplete="email" maxLength={255} className="form-control" required
                                                    value={emailChange.newEmail}
                                                    onChange={event => setEmailChange(current => ({ ...current, newEmail: event.target.value }))} />
                                            </div>
                                            <div className="col-12 col-lg-6">
                                                <label htmlFor="emailChangePassword" className="form-label">Aktuelles Passwort</label>
                                                <input id="emailChangePassword" type="password" autoComplete="current-password" className="form-control" required
                                                    value={emailChange.password}
                                                    onChange={event => setEmailChange(current => ({ ...current, password: event.target.value }))} />
                                            </div>
                                            <div className="col-12">
                                                <button className="btn btn-primary" type="submit" disabled={emailChange.busy === 'request'}>
                                                    Bestätigungscode anfordern
                                                </button>
                                            </div>
                                        </form>
                                        <form id="emailConfirmForm" className={emailChange.confirmVisible ? 'mt-3' : 'mt-3 d-none'}
                                            onSubmit={submitEmailChange('confirm')}>
                                            <label htmlFor="emailChangeCode" className="form-label">Bestätigungscode aus der neuen Mail</label>
                                            <input id="emailChangeCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
                                                maxLength={6} className="form-control mb-3" required ref={codeRef} value={emailChange.code}
                                                onChange={event => setEmailChange(current => ({ ...current, code: event.target.value }))} />
                                            <button className="btn btn-primary" type="submit" disabled={emailChange.busy === 'confirm'}>
                                                E-Mail-Adresse bestätigen
                                            </button>
                                        </form>
                                        <div id="emailChangeMessage" className={emailMessage?.className || 'mt-3'} role="status">{emailMessage?.text}</div>
                                        <hr className="my-4" />
                                        <h5>Passwort ändern</h5>

                                        <form id="passwordForm" onSubmit={changePassword}>
                                            <div className="row g-3">
                                                <div className="col-12">
                                                    <label className="form-label" htmlFor="currentPassword">Aktuelles Passwort</label>
                                                    <input type="password" id="currentPassword" className="form-control" required
                                                        value={passwords.currentPassword}
                                                        onChange={event => setPasswords(current => ({ ...current, currentPassword: event.target.value }))} />
                                                </div>
                                                <div className="col-12 col-lg-6">
                                                    <label className="form-label" htmlFor="newPassword">Neues Passwort</label>
                                                    <input type="password" id="newPassword" className="form-control" required
                                                        value={passwords.newPassword}
                                                        onChange={event => setPasswords(current => ({ ...current, newPassword: event.target.value }))} />
                                                </div>
                                                <div className="col-12 col-lg-6">
                                                    <label className="form-label" htmlFor="newPasswordConfirm">Neues Passwort wiederholen</label>
                                                    <input type="password" id="newPasswordConfirm" className="form-control" required
                                                        value={passwords.newPasswordConfirm}
                                                        onChange={event => setPasswords(current => ({ ...current, newPasswordConfirm: event.target.value }))} />
                                                </div>
                                                <div className="col-12">
                                                    <button type="submit" className="btn btn-warning">Passwort ändern</button>
                                                </div>
                                            </div>
                                        </form>
                                    </div>
                                </div>
                            </div>

                            <div id="invoicesView" className={view === 'invoices' ? undefined : 'd-none'}>
                                <h2>Meine Rechnungen</h2>
                                <p>Ihre Rechnungen und Rechnungskorrekturen als PDF und E-Rechnung.</p>
                                <div id="customerInvoices" aria-live="polite">
                                    {invoiceSession > 0 ? <InvoiceArchive key={invoiceSession} admin={false} /> : null}
                                </div>
                            </div>
                            <div id="ordersView" className={view === 'orders' ? undefined : 'd-none'}>
                                <h2 className="mb-4">Meine Bestellungen</h2>
                                <div className="card mb-3">
                                    <div className="card-body">
                                        <div className="row g-2">
                                            {FILTERS.map(filter => (
                                                <div className={filter.column} key={filter.id}>
                                                    <select id={filter.id} className="form-select" value={filters[filter.key]}
                                                        aria-label={filter.label}
                                                        onChange={event => changeFilter(filter.key, event.target.value)}>
                                                        <option value="">{filter.label}</option>
                                                        {(filterOptions[filter.options] || []).filter(Boolean).sort().map(value => (
                                                            <option key={value} value={value}>{filter.labels[value] || value}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div id="myOrdersList">{ordersContent}</div>
                            </div>
                        </div>
                    </main>
                </div>
            </div>

            <div className="modal fade order-sheet-modal" id="myOrderDetailsModal" tabIndex={-1} ref={detailsModalRef}>
                <div className="modal-dialog modal-xl modal-dialog-scrollable">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h5 className="modal-title">{detailOrder ? `Bestellung ${detailOrder.order_no}` : 'Bestelldetails'}</h5>
                            <button className="btn-close" data-bs-dismiss="modal" aria-label="Schließen" />
                        </div>

                        <div className={detailOrder ? 'modal-body order-sheet' : 'modal-body'} id="myOrderDetailsBody">
                            {detailOrder ? (
                                <OrderSheet key={`${detailOrder.id}-${detailRevision}`} order={detailOrder} admin={false} statusBadge={statusBadge(detailOrder.status)}
                                    cancel={canCancelMyOrder(detailOrder) ? (
                                        <div className="order-cancel-action">
                                            <button type="button" className="btn btn-outline-danger" data-profile-action="cancel-order"
                                                data-order-id={detailOrder.id}>
                                                <i className="bi bi-trash" /> Bestellung stornieren
                                            </button>
                                        </div>
                                    ) : null}
                                    reviews={String(detailOrder.status || '').trim().toLowerCase() === 'returned' ? (
                                        <section className="order-sheet-section">
                                            <h3>Produkte bewerten</h3>
                                            {uniqueReviewItems(detailOrder).map(item => (
                                                <ReviewCard key={String(item.productId)} item={item} orderId={detailOrder.id}
                                                    onSubmit={submitProductReview} />
                                            ))}
                                        </section>
                                    ) : null} />
                            ) : null}
                        </div>

                        <div className="modal-footer">
                            <button className="btn btn-secondary" data-bs-dismiss="modal">Schließen</button>
                        </div>
                    </div>
                </div>
            </div>

            <ConfirmModal />
            <HandoverModal onReturnToOrder={orderId => openMyOrderDetails(orderId)} />
        </>
    );
}
