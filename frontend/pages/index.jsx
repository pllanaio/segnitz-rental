import { useCallback, useEffect, useRef, useState } from 'react';
import PageHead from '../components/PageHead';
import GlobalAlerts from '../components/GlobalAlerts';
import Preloader from '../components/Preloader';
import SignatureCanvas from '../components/SignatureCanvas';
import { SidebarLegal, SidebarLogo } from '../components/SidebarBrand';
import ProductCard from '../components/shop/ProductCard';
import ProductDetailsModal from '../components/shop/ProductDetailsModal';
import CartModal from '../components/shop/CartModal';
import CartItemEditModal from '../components/shop/CartItemEditModal';
import ConfirmClearCartModal from '../components/shop/ConfirmClearCartModal';
import CartSummaryRows from '../components/shop/CartSummaryRows';
import CheckoutCustomerStep from '../components/shop/CheckoutCustomerStep';
import { showAlert } from '../lib/alerts';
import { exposeGlobals } from '../lib/compat';
import {
    PRODUCTS_PER_PAGE, buildOrderForm, calculateCartTotals, countCategories, describeCartItemDuration, filterProducts,
    firstInvalidCustomerField, formatCurrency, getItemDeposit, getItemPricePerDay, calculateRentalDays, listProductKinds,
    rangesOverlap, validateCustomerFields
} from '../lib/shop';
import {
    DEFINITIVE_STATUSES, NOT_CONFIRMED_TEXT, PAYMENT_CONTEXTS, VERIFICATION_DELAYS_MS, VERIFYING_TEXT,
    describePaymentError, describePaymentSuccess
} from '../lib/paymentReturn';

const STEP_COUNT = 3;
const QUIRKS_FORM_SPACING = { marginBottom: '1em' };
const EMPTY_CART = { cartId: null, items: [] };
const EMPTY_CUSTOMER = {
    FirstName: '', LastName: '', CustomerCompany: '', CustomerEmail: '', CustomerPhone: '',
    CustomerAddress: '', CustomerZip: '', CustomerCity: ''
};
const INITIAL_RESULT = {
    icon: 'bi-check-lg',
    iconClass: 'success-icon',
    title: 'Mietvorgang erfolgreich hinterlegt',
    text: 'Vielen Dank! Ihr Mietvorgang wurde erfolgreich bei uns im System gespeichert.',
    final: null
};

async function retryMolliePayment(orderId) {
    try {
        const response = await fetch(`/orders/${orderId}/mollie-checkout`, { method: 'POST' });
        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Zahlung konnte nicht erneut gestartet werden.', 'danger');
            return;
        }

        if (result.alreadyPaid) {
            showAlert(result.message || 'Die Zahlung ist bereits eingegangen.', 'success');
            window.location.reload();
            return;
        }

        if (result.paymentPending || !result.checkoutUrl) {
            showAlert(
                result.message || 'Die Online-Zahlung wird noch vorbereitet. Bitte versuchen Sie es gleich erneut.',
                'info',
                8000
            );
            return;
        }

        window.location.href = result.checkoutUrl;
    } catch (error) {
        console.error('Fehler beim erneuten Starten der Zahlung:', error);
        showAlert('Zahlung konnte nicht erneut gestartet werden.', 'danger');
    }
}

function RetryPaymentButton({ orderId, children }) {
    return (
        <button type="button" className="btn btn-primary" data-frontend-action="retry-payment" data-order-id={Number(orderId)}
            onClick={() => retryMolliePayment(Number(orderId))}>
            {children}
        </button>
    );
}

function PaymentFinal({ final, onVerifyAgain }) {
    if (!final) return null;

    switch (final.kind) {
    case 'error':
        return (
            <>
                <div className={`alert ${final.alertClass}`} role="status">
                    {final.message}<br />
                    {final.followUpText}
                </div>
                {final.contextLabel
                    ? <p>{final.contextLabel} · Bestellung <strong>{final.orderNo}</strong></p>
                    : null}
                {final.retryOrderId !== null
                    ? <RetryPaymentButton orderId={final.retryOrderId}>Online-Zahlung erneut starten</RetryPaymentButton>
                    : null}
            </>
        );
    case 'success':
        return (
            <div className="alert alert-success">
                {final.body}<br />
                Bestellnummer: <strong>{final.orderNo}</strong>
            </div>
        );
    case 'verify':
        return (
            <>
                <button type="button" className="btn btn-primary" onClick={onVerifyAgain}>Zahlungsstatus erneut prüfen</button>
                {final.resumeOrderId !== null
                    ? (
                        <button type="button" className="btn btn-warning ms-2" onClick={() => retryMolliePayment(final.resumeOrderId)}>
                            Zahlung bei Mollie fortsetzen
                        </button>
                    )
                    : null}
            </>
        );
    case 'payment-pending':
        return (
            <>
                <div className="alert alert-info">
                    Bestellnummer: <strong>{final.orderNo}</strong><br />
                    Die Zahlungsseite kann in Kürze erneut angefordert werden.
                </div>
                <RetryPaymentButton orderId={final.orderId}>Zahlungsseite erneut laden</RetryPaymentButton>
            </>
        );
    case 'confirmed':
        return (
            <div className="alert alert-success">
                Bestellnummer: <strong>{final.orderNo}</strong><br />
                Bei Abholung zu zahlen: <strong>{Number(final.amountDue || 0).toFixed(2)} €</strong>
            </div>
        );
    default:
        return null;
    }
}

function CategoryFilterButton({ value, label, count, selected, onSelect }) {
    return (
        <button type="button"
            className={selected
                ? 'btn btn-warning w-100 text-start d-flex justify-content-between align-items-center mb-2'
                : 'btn btn-outline-light w-100 text-start d-flex justify-content-between align-items-center mb-2'}
            onClick={() => onSelect(value)}>
            <span><i className={`bi ${value === 'all' ? 'bi-grid' : 'bi-tag'}`} />{` ${label}`}</span>
            <span>{String(count)}</span>
        </button>
    );
}

function ProductPagination({ totalPages, currentPage, onChange }) {
    if (totalPages <= 1) return null;

    return (
        <>
            <button type="button" className="btn btn-outline-primary btn-sm" disabled={currentPage === 1}
                onClick={() => onChange(currentPage - 1)}>Zurück</button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map(page => (
                <button type="button" key={page}
                    className={page === currentPage ? 'btn btn-primary btn-sm' : 'btn btn-outline-primary btn-sm'}
                    onClick={() => onChange(page)}>
                    {page}
                </button>
            ))}
            <button type="button" className="btn btn-outline-primary btn-sm" disabled={currentPage === totalPages}
                onClick={() => onChange(currentPage + 1)}>Weiter</button>
        </>
    );
}

export default function ShopPage() {
    const productModalRef = useRef(null);
    const cartModalRef = useRef(null);
    const cartEditModalRef = useRef(null);
    const clearCartModalRef = useRef(null);
    const signatureRef = useRef(null);
    const signatureInputRef = useRef(null);
    const customerFieldRefs = useRef({});
    const verifyPaymentRef = useRef(null);

    // Values that asynchronous handlers must read synchronously, mirrored into refs.
    const cartRef = useRef(EMPTY_CART);
    const stepRef = useRef(0);
    const appliedCouponRef = useRef(null);
    const couponBusyRef = useRef(false);

    const [auth, setAuth] = useState(null);
    const [openingStatus, setOpeningStatus] = useState({ label: 'Status wird geladen...', message: '' });
    const [products, setProducts] = useState(null);
    const [productsError, setProductsError] = useState(false);
    const [bestsellers, setBestsellers] = useState({ status: 'loading', products: [] });
    const [filters, setFilters] = useState({ category: 'all', query: '', kind: '' });
    const [currentPage, setCurrentPage] = useState(1);
    const [cart, setCartState] = useState(EMPTY_CART);
    const [step, setStepState] = useState(0);
    const [view, setView] = useState('wizard');
    const [paymentReturn, setPaymentReturn] = useState(false);
    const [result, setResult] = useState(INITIAL_RESULT);
    const [customer, setCustomer] = useState(EMPTY_CUSTOMER);
    const [customerErrors, setCustomerErrors] = useState({});
    const [paymentMethod, setPaymentMethod] = useState('online');
    const [agbs, setAgbs] = useState(false);
    const [dsgvo, setDsgvo] = useState(false);
    const [couponCode, setCouponCode] = useState('');
    const [couponStatus, setCouponStatus] = useState('');
    const [appliedCoupon, setAppliedCouponState] = useState(null);
    const [couponBusy, setCouponBusyState] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [preloaderVisible, setPreloaderVisible] = useState(false);
    const [bodyLoaded, setBodyLoaded] = useState(false);

    const setCart = next => { cartRef.current = next; setCartState(next); };
    const setStep = next => { stepRef.current = next; setStepState(next); };
    const setAppliedCoupon = next => { appliedCouponRef.current = next; setAppliedCouponState(next); };
    const setCouponBusy = next => { couponBusyRef.current = next; setCouponBusyState(next); };

    useEffect(() => {
        document.body.classList.toggle('loaded', bodyLoaded);
    }, [bodyLoaded]);

    const loadCart = useCallback(async () => {
        try {
            const response = await fetch('/cart');
            const nextCart = await response.json();

            if (!response.ok) {
                throw new Error(nextCart.error || 'Warenkorb konnte nicht geladen werden.');
            }

            if (appliedCouponRef.current && JSON.stringify(cartRef.current.items) !== JSON.stringify(nextCart.items)) {
                setAppliedCoupon(null);
                setCouponStatus('Warenkorb geändert. Bitte den Code erneut anwenden.');
            }
            setCart(nextCart);
            return nextCart;
        } catch (error) {
            console.error('Fehler beim Laden des Warenkorbs:', error);
            setCart(EMPTY_CART);
            return undefined;
        }
    }, []);

    // Authentication state, customer prefill, opening hours, catalogue and cart.
    useEffect(() => {
        fetch('/auth-status')
            .then(res => res.json())
            .then(async data => {
                setAuth(data);
                if (data.loggedIn && data.role !== 'global_admin') {
                    try {
                        const response = await fetch('/my-profile');
                        if (!response.ok) return;
                        const user = await response.json();
                        setCustomer(current => ({
                            ...current,
                            FirstName: user.firstName || '',
                            LastName: user.lastName || '',
                            CustomerCompany: user.company || '',
                            CustomerEmail: user.email || '',
                            CustomerPhone: user.phone || '',
                            CustomerAddress: user.address || '',
                            CustomerZip: user.zip || '',
                            CustomerCity: user.city || ''
                        }));
                    } catch (error) {
                        console.error('Fehler beim Vorbefüllen der Kundendaten:', error);
                    }
                }
            })
            .catch(err => console.error('Auth-Status Fehler:', err));

        (async () => {
            try {
                const response = await fetch('/opening-hours/status');
                const status = await response.json();
                setOpeningStatus({ label: status.label || 'Status unbekannt', message: status.message || '' });
            } catch (error) {
                console.error('Fehler beim Laden des Öffnungsstatus:', error);
                setOpeningStatus(current => ({ ...current, label: 'Status unbekannt' }));
            }
        })();

        (async () => {
            try {
                const response = await fetch('/products');
                const list = await response.json();
                setProducts(list.filter(product => product.is_active === 1));
            } catch (error) {
                console.error('Fehler beim Laden der Produkte:', error);
                setProductsError(true);
            }
        })();

        (async () => {
            try {
                const response = await fetch('/products/bestsellers');
                const list = await response.json();
                if (!response.ok) throw new Error(list.error || 'Bestseller konnten nicht geladen werden.');
                setBestsellers({ status: 'loaded', products: list.filter(product => Number(product.times_ordered || 0) > 0) });
            } catch (error) {
                console.error('Fehler beim Laden der Bestseller:', error);
                setBestsellers(current => ({ ...current, status: 'error' }));
            }
        })();

        loadCart();
    }, [loadCart]);

    // Mollie return: index.html?payment=return|extension|return_charge&orderId=...
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const paymentContext = params.get('payment');
        const paymentType = params.get('paymentType');
        const itemId = params.get('itemId');

        if (!PAYMENT_CONTEXTS.includes(paymentContext)) return undefined;

        const orderId = params.get('orderId');
        setPaymentReturn(true);
        setView('success');
        setResult({ icon: 'bi-hourglass-split', iconClass: 'success-icon payment-pending-icon',
            title: 'Zahlungsstatus wird geprüft', text: 'Bitte warten Sie einen Moment.', final: null });

        let canResumeCheckout = false;
        const setVerificationView = (waiting, message = '') => {
            setResult({
                icon: 'bi-hourglass-split',
                iconClass: 'success-icon payment-pending-icon',
                title: waiting ? 'Zahlungsstatus wird geprüft' : 'Zahlungsstatus noch nicht bestätigt',
                text: message || (waiting ? VERIFYING_TEXT : NOT_CONFIRMED_TEXT),
                final: waiting ? null : {
                    kind: 'verify',
                    resumeOrderId: canResumeCheckout && !paymentType ? orderId : null
                }
            });
        };

        const setPaymentErrorView = (status, order = {}) => {
            const description = describePaymentError(paymentContext, status, order);
            setResult({
                icon: 'bi-x-lg',
                iconClass: 'success-icon payment-error-icon',
                title: description.title,
                text: description.message,
                final: {
                    kind: 'error',
                    alertClass: description.alertClass,
                    message: description.message,
                    followUpText: description.followUpText,
                    contextLabel: ['extension', 'return_charge'].includes(paymentContext)
                        ? (paymentContext === 'extension' ? 'Nachzahlung zur Mietverlängerung' : 'Nachzahlung zur Rückgabe')
                        : null,
                    orderNo: order.orderNo || order.order_no || orderId,
                    retryOrderId: description.canRetryInitialPayment ? Number(orderId) : null
                }
            });
        };

        const setPaymentSuccessView = order => {
            const description = describePaymentSuccess(paymentContext, order);
            setResult({
                icon: 'bi-check-lg',
                iconClass: 'success-icon',
                title: description.title,
                text: description.text,
                final: { kind: 'success', body: description.body, orderNo: order.orderNo || order.order_no || orderId }
            });
        };

        if (!/^\d+$/.test(orderId || '')) {
            setResult({
                icon: 'bi-hourglass-split',
                iconClass: 'success-icon payment-pending-icon',
                title: 'Zahlungsstatus noch nicht bestätigt',
                text: 'Der Zahlungslink enthält keine gültige Bestellnummer. Bitte öffnen Sie Ihre Bestellung oder kontaktieren Sie uns.',
                final: null
            });
            return undefined;
        }

        let verificationRunning = false;
        let pageClosed = false;
        let activeRequest;
        const onPageHide = () => { pageClosed = true; activeRequest?.abort(); };
        window.addEventListener('pagehide', onPageHide, { once: true });

        async function verifyPaymentStatus() {
            if (verificationRunning || pageClosed) return;
            verificationRunning = true;
            setVerificationView(true);
            const queryParams = new URLSearchParams();

            if (paymentType) queryParams.set('paymentType', paymentType);
            if (itemId) queryParams.set('itemId', itemId);

            const query = queryParams.toString() ? `?${queryParams.toString()}` : '';

            try {
                for (const delay of VERIFICATION_DELAYS_MS) {
                    if (delay) await new Promise(resolve => window.setTimeout(resolve, delay));
                    if (pageClosed) return;
                    activeRequest = new AbortController();
                    const timeout = window.setTimeout(() => activeRequest.abort(), 10000);
                    try {
                        const response = await fetch(`/orders/${orderId}/payment-status/sync${query}`, {
                            method: 'POST', cache: 'no-store', signal: activeRequest.signal,
                            headers: { Accept: 'application/json' }
                        });
                        if ([401, 403].includes(response.status)) {
                            setVerificationView(false, 'Der Zahlungsstatus kann mit dieser Sitzung nicht eingesehen werden. Bitte melden Sie sich mit Ihrem Kundenkonto an oder kontaktieren Sie uns. Dies ist keine Bestätigung einer fehlgeschlagenen Zahlung.');
                            return;
                        }
                        if ([400, 404].includes(response.status)) {
                            setVerificationView(false, 'Die Zahlung konnte diesem Link nicht zugeordnet werden. Bitte prüfen Sie Ihre Bestellung oder kontaktieren Sie uns.');
                            return;
                        }
                        if (!response.ok) continue;
                        const order = await response.json();
                        const status = order.payment_status || order.paymentStatus;
                        canResumeCheckout = !paymentType && ['pending', 'open'].includes(status);
                        if (status === 'paid') { setPaymentSuccessView(order); return; }
                        if (DEFINITIVE_STATUSES.includes(status)) { setPaymentErrorView(status, order); return; }
                        if (status === 'authorized') {
                            setVerificationView(true, 'Mollie hat die Zahlung autorisiert. Die endgültige Zahlungsbestätigung steht noch aus. Bitte zahlen Sie nicht erneut.');
                        }
                    } catch (_) {
                        // Transport and temporary reconciliation errors say nothing about payment success.
                    } finally {
                        window.clearTimeout(timeout);
                    }
                }
                if (!pageClosed) setVerificationView(false);
            } finally {
                verificationRunning = false;
            }
        }

        verifyPaymentRef.current = verifyPaymentStatus;
        verifyPaymentStatus();

        return () => {
            pageClosed = true;
            activeRequest?.abort();
            window.removeEventListener('pagehide', onPageHide);
        };
    }, []);

    // A Mollie return restored from the back/forward cache must verify again.
    useEffect(() => {
        const onPageShow = event => {
            if (event.persisted && new URLSearchParams(window.location.search).get('payment') === 'return') {
                window.location.reload();
            }
        };
        window.addEventListener('pageshow', onPageShow);
        return () => window.removeEventListener('pageshow', onPageShow);
    }, []);

    const items = cart.items || [];
    const filtersActive = filters.category !== 'all' || Boolean(filters.query.trim()) || Boolean(filters.kind);
    const filteredProducts = products ? filterProducts(products, filters) : [];
    const totalPages = Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE);
    const pageProducts = filteredProducts.slice((currentPage - 1) * PRODUCTS_PER_PAGE, currentPage * PRODUCTS_PER_PAGE);
    const productKinds = products ? listProductKinds(products) : [];
    const categories = products ? countCategories(products) : [];

    const updateFilters = changes => {
        setFilters(current => ({ ...current, ...changes }));
        setCurrentPage(1);
        setBestsellers(current => current.status === 'loaded' ? current : { status: 'loaded', products: [] });
    };

    const openProduct = card => productModalRef.current.open(card);

    const addProductToCart = async ({ productId, rentalStart, rentalEnd, rentalHours, rentalStartTime, blockedPeriods }) => {
        if (!rentalHours && blockedPeriods.some(period => rangesOverlap(rentalStart, rentalEnd, period))) {
            showAlert('Dieses Produkt ist im ausgewählten Zeitraum bereits reserviert.', 'danger');
            return;
        }

        const cartConflict = (cartRef.current.items || []).some(item => String(item.productId) === String(productId)
            && rentalStart <= item.rentalEnd
            && rentalEnd >= item.rentalStart);

        if (cartConflict && !rentalHours) {
            showAlert('Dieses Produkt befindet sich bereits im Warenkorb.', 'danger');
            return;
        }

        try {
            const response = await fetch('/cart/items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId, rentalStart, rentalEnd, rentalHours, rentalStartTime })
            });

            const addResult = await response.json();

            if (!response.ok) {
                showAlert(addResult.error || 'Produkt konnte nicht zum Warenkorb hinzugefügt werden.', 'danger');
                return;
            }

            await loadCart();
            showAlert('Produkt wurde zum Warenkorb hinzugefügt.', 'success');
        } catch (error) {
            console.error('Fehler beim Hinzufügen zum Warenkorb:', error);
            showAlert('Produkt konnte nicht zum Warenkorb hinzugefügt werden.', 'danger');
        }
    };

    const deleteCartItem = async itemId => {
        try {
            const response = await fetch(`/cart/items/${itemId}`, { method: 'DELETE' });
            const deleteResult = await response.json();

            if (!response.ok) {
                showAlert(deleteResult.error || 'Warenkorbposition konnte nicht gelöscht werden.', 'danger');
                return;
            }

            await loadCart();
        } catch (error) {
            console.error('Fehler beim Löschen der Warenkorbposition:', error);
            showAlert('Warenkorbposition konnte nicht gelöscht werden.', 'danger');
        }
    };

    const deleteCartItemRef = useRef(deleteCartItem);
    deleteCartItemRef.current = deleteCartItem;
    // The plain-JS shop exposed this helper globally; it stays available.
    useEffect(() => exposeGlobals({ deleteCartItem: itemId => deleteCartItemRef.current(itemId) }), []);

    const executeClearCart = async () => {
        try {
            const response = await fetch('/cart', { method: 'DELETE' });
            const clearResult = await response.json();

            if (!response.ok) {
                showAlert(clearResult.error || 'Warenkorb konnte nicht geleert werden.', 'danger');
                return;
            }

            await loadCart();
            showAlert(clearResult.message || 'Warenkorb wurde geleert.', 'success');
        } catch (error) {
            console.error('Fehler beim Leeren des Warenkorbs:', error);
            showAlert('Warenkorb konnte nicht geleert werden.', 'danger');
        }
    };

    const confirmClearCart = async () => {
        clearCartModalRef.current.hide();
        await executeClearCart();
        cartModalRef.current.hide();
    };

    const openCartItemEditor = itemId => {
        const item = cartRef.current.items.find(cartItem => cartItem.id === itemId);

        if (!item) {
            showAlert('Warenkorbposition wurde nicht gefunden.', 'danger');
            return;
        }

        cartEditModalRef.current.open(item);
    };

    const validateProductStep = async () => {
        const current = await loadCart();
        const currentItems = (current || EMPTY_CART).items || [];

        if (currentItems.length === 0) {
            showAlert('Bitte legen Sie mindestens ein Produkt in den Warenkorb.', 'warning');
            return false;
        }

        return true;
    };

    const validateCustomerDataStep = () => {
        const errors = validateCustomerFields(customer);
        setCustomerErrors(errors);

        if (Object.keys(errors).length > 0) {
            showAlert('Bitte füllen Sie alle rot markierten Pflichtfelder korrekt aus.', 'warning');
            const firstInvalid = firstInvalidCustomerField(errors);
            if (firstInvalid) customerFieldRefs.current[firstInvalid]?.focus();
            return false;
        }

        return true;
    };

    const validateSignatureStep = () => {
        let isValid = true;

        if (signatureRef.current.isEmpty()) {
            showAlert('Bitte leisten Sie Ihre Unterschrift.', 'warning');
            isValid = false;
        }

        if (!agbs) {
            showAlert('Bitte stimmen Sie den Allgemeinen Geschäftsbedingungen zu.', 'warning');
            isValid = false;
        }

        if (!dsgvo) {
            showAlert('Bitte stimmen Sie der Datenschutzerklärung zu.', 'warning');
            isValid = false;
        }

        return isValid;
    };

    const goToNextStep = async () => {
        const currentStep = stepRef.current;
        let isValid = true;

        switch (currentStep) {
        case 0:
            isValid = await validateProductStep();
            break;
        case 1: {
            const current = await loadCart();
            if (!((current || EMPTY_CART).items || []).length) {
                showAlert('Ihr Warenkorb ist leer.', 'warning');
                isValid = false;
            }
            break;
        }
        case 2:
            isValid = validateCustomerDataStep();
            break;
        case 3:
            isValid = validateSignatureStep();
            break;
        default:
            break;
        }

        if (!isValid || currentStep >= STEP_COUNT) return;
        setStep(currentStep + 1);
    };

    const goToPreviousStep = () => {
        if (stepRef.current > 0) setStep(stepRef.current - 1);
    };

    const goToNextStepFromCart = async () => {
        if (!(await validateProductStep())) return;
        cartModalRef.current.hide();
        goToNextStep();
    };

    const clearCouponSignature = () => {
        if (signatureRef.current && !signatureRef.current.isEmpty()) {
            signatureRef.current.clear();
            showAlert('Die Summe wurde geändert. Bitte unterschreiben Sie erneut.', 'info');
        }
    };

    const applyCoupon = async () => {
        if (couponBusyRef.current) return;
        setCouponBusy(true);
        setAppliedCoupon(null);
        clearCouponSignature();
        const cartSnapshot = JSON.stringify(cartRef.current.items);
        try {
            const response = await fetch('/cart/coupon-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: couponCode })
            });
            const preview = await response.json();
            if (!response.ok) throw new Error(preview.error);
            if (JSON.stringify(cartRef.current.items) !== cartSnapshot) {
                throw new Error('Warenkorb geändert. Bitte den Code erneut anwenden.');
            }
            setAppliedCoupon(preview);
            setCouponCode(preview.coupon.code);
            setCouponStatus('Gutschein angewendet. Die Kaution bleibt unverändert.');
        } catch (error) {
            setCouponStatus(error.message);
        } finally {
            setCouponBusy(false);
        }
    };

    const removeCoupon = () => {
        setAppliedCoupon(null);
        setCouponCode('');
        setCouponStatus('Gutschein entfernt.');
        clearCouponSignature();
    };

    const changeCouponCode = value => {
        setCouponCode(value);
        if (appliedCouponRef.current) {
            setAppliedCoupon(null);
            clearCouponSignature();
        }
        setCouponStatus('Bitte den Code mit „Anwenden“ prüfen.');
    };

    const submitOrder = async event => {
        event.preventDefault();
        if (couponBusyRef.current || (couponCode.trim() && !appliedCouponRef.current)) {
            showAlert('Bitte den Gutscheincode zuerst anwenden oder entfernen.', 'warning');
            return;
        }

        const signature = signatureRef.current.toDataURL();
        if (signature.trim() !== '' && signatureInputRef.current) {
            signatureInputRef.current.value = signature;
        }

        if (!validateSignatureStep()) return;

        if (!paymentMethod) {
            showAlert('Bitte wählen Sie eine Zahlungsart aus.', 'warning');
            setSubmitting(false);
            return;
        }

        const coupon = appliedCouponRef.current;
        const formData = buildOrderForm({ customer, signature, agbs, dsgvo, paymentMethod });

        try {
            setPreloaderVisible(true);
            setSubmitting(true);

            const response = await fetch('/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    form: formData,
                    paymentMethod,
                    coupon: coupon ? {
                        code: coupon.coupon.code,
                        revision: coupon.coupon.revision,
                        totalCents: Math.round(coupon.totals.grandTotalBeforeDepositReturn * 100)
                    } : null
                })
            });

            const orderResult = await response.json();

            if (!response.ok) {
                setPreloaderVisible(false);
                setBodyLoaded(false);
                setSubmitting(false);

                if (response.status === 409) {
                    showAlert(
                        orderResult.error || 'Die Bestellung wurde zwischenzeitlich geändert. Bitte prüfen Sie Ihre Angaben.',
                        'warning',
                        8000
                    );
                    return;
                }

                showAlert(orderResult.error || 'Bestellung konnte nicht abgeschlossen werden.', 'danger');
                return;
            }

            if (orderResult.checkoutUrl) {
                const returnUrl = new URL(window.location.href);
                returnUrl.searchParams.set('payment', 'return');
                returnUrl.searchParams.set('orderId', String(orderResult.orderId));
                window.history.replaceState(null, '', returnUrl);
                window.location.href = orderResult.checkoutUrl;
                return;
            }

            setBodyLoaded(true);
            setView('success');

            if (orderResult.paymentPending === true) {
                setResult(current => ({
                    ...current,
                    title: 'Online-Zahlung wird vorbereitet',
                    text: orderResult.message ||
                        'Der Zahlungsanbieter ist vorübergehend nicht erreichbar. Ihre Bestellung wurde sicher gespeichert.',
                    final: { kind: 'payment-pending', orderNo: orderResult.orderNo, orderId: Number(orderResult.orderId) }
                }));
            } else {
                const nothingDue = Number(orderResult.amountDue) === 0;
                setResult(current => ({
                    ...current,
                    title: nothingDue ? 'Bestellung bestätigt' : 'Bestellung bestätigt – Zahlung bei Abholung',
                    text: nothingDue
                        ? 'Ihre Mietprodukte sind verbindlich eingeplant. Es ist keine Zahlung erforderlich.'
                        : 'Ihre Mietprodukte sind verbindlich eingeplant. Den ausgewiesenen Betrag zahlen Sie bei der Abholung.',
                    final: { kind: 'confirmed', orderNo: orderResult.orderNo, amountDue: orderResult.amountDue }
                }));
            }

            if (orderResult.pdfUrl) {
                window.open(orderResult.pdfUrl, '_blank');
            }
        } catch (error) {
            console.error('Fehler beim Absenden der Bestellung:', error);

            setPreloaderVisible(false);
            setBodyLoaded(false);
            setSubmitting(false);

            showAlert('Bestellung konnte nicht abgeschlossen werden.', 'danger');
        }
    };

    const logout = event => {
        event.preventDefault();
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
    };

    const updateCustomerField = (fieldId, value) => {
        setCustomer(current => ({ ...current, [fieldId]: value }));
        if (value.trim()) {
            setCustomerErrors(current => {
                if (!current[fieldId]) return current;
                const next = { ...current };
                delete next[fieldId];
                return next;
            });
        }
    };

    const inWizard = view === 'wizard';
    const showPrev = inWizard && step > 0;
    const showNext = inWizard && ((step === 0 && items.length > 0) || (step > 0 && step < STEP_COUNT));
    const showSubmit = inWizard && step === STEP_COUNT;
    const stepClass = index => (inWizard && step === index ? 'step d-block' : 'step d-none');
    const progressValue = paymentReturn ? 100 : (100 / STEP_COUNT) * step;
    const reviewTotals = appliedCoupon ? appliedCoupon.totals : calculateCartTotals(items);

    const loggedIn = auth?.loggedIn === true;
    const isAdmin = loggedIn && auth.role === 'global_admin';
    const adminButton = !loggedIn
        ? { href: '/login.html', icon: 'bi-person-lock', label: 'Login' }
        : isAdmin
            ? { href: '/backend.html', icon: 'bi-gear', label: 'Admin Dashboard' }
            : { href: '#', icon: 'bi-person-check', label: 'Eingeloggt' };
    const authKnown = auth !== null;

    let bestsellerContent = null;
    let bestsellerHidden = false;
    if (filtersActive) {
        bestsellerHidden = true;
    } else if (bestsellers.status === 'loading') {
        bestsellerContent = <div className="alert alert-info w-100">Bestseller werden geladen...</div>;
    } else if (bestsellers.status === 'error') {
        bestsellerContent = <div className="alert alert-warning w-100">Bestseller konnten nicht geladen werden.</div>;
    } else if (bestsellers.products.length === 0) {
        bestsellerHidden = true;
    } else {
        bestsellerContent = bestsellers.products.map(product => (
            <ProductCard key={`bestseller-${product.id}`} product={product} onOpen={openProduct} />
        ));
    }

    let productGridContent;
    if (productsError) {
        productGridContent = <div className="alert alert-danger">Produkte konnten nicht geladen werden.</div>;
    } else if (!products) {
        productGridContent = <div className="alert alert-info w-100">Produkte werden geladen...</div>;
    } else if (filteredProducts.length === 0) {
        productGridContent = <div className="alert alert-warning">Aktuell sind keine Produkte verfügbar.</div>;
    } else {
        productGridContent = pageProducts.map(product => (
            <ProductCard key={product.id} product={product} onOpen={openProduct} />
        ));
    }

    const productSectionTitle = products || productsError
        ? (filters.category === 'all' ? 'Produkte zur Vermietung' : `Produkte zur Vermietung: ${filters.category}`)
        : 'Produkte zur Vermietung auswählen';

    return (
        <>
            <PageHead title="Segnitz Rental" />
            <GlobalAlerts />
            <div className="container-fluid min-vh-100 p-0">
                <div className="row g-0 min-vh-100">
                    <aside className="col-12 col-md-3 col-xl-2 bg-primary text-white p-4">
                        <SidebarLogo linked />
                        <div id="openingStatusBox" className="mt-3 text-white d-flex align-items-center gap-2">
                            <i className="bi bi-clock" />
                            <span id="openingStatusLabel">{openingStatus.label}</span>
                        </div>
                        <div id="openingStatusMessage" className="small mt-2 text-white">{openingStatus.message}</div>

                        <div className="mt-4">
                            <a id="admin-button" href={adminButton.href}>
                                <button type="button" className="btn btn-light sidebar-btn mt-2">
                                    <i className={`bi ${adminButton.icon}`} /> {adminButton.label}
                                </button>
                            </a>

                            <a id="register-button" href="/register.html"
                                style={authKnown ? { display: loggedIn ? 'none' : 'block' } : undefined}>
                                <button type="button" className="btn btn-success sidebar-btn mt-2">
                                    <i className="bi bi-journal-text" /> Jetzt registrieren
                                </button>
                            </a>
                            <a id="profile-button" href="/profile.html" style={{ display: loggedIn ? 'block' : 'none' }}>
                                <button type="button" className="btn btn-outline-light sidebar-btn mt-2">
                                    <i className="bi bi-person-circle" /> Mein Profil
                                </button>
                            </a>

                            <a id="logout-button" href="#" style={{ display: loggedIn ? 'block' : 'none' }} onClick={logout}>
                                <button type="button" className="btn btn-danger sidebar-btn mt-2" id="logoutActionButton">
                                    <i className="bi bi-x-circle" /> Abmelden
                                </button>
                            </a>
                            <p id="login-status" className="mt-3 small">
                                {loggedIn ? `Angemeldet als: ${auth.user}` : 'Kein Benutzer angemeldet'}
                            </p>

                            <div className="mt-4">
                                <h6 className="text-white">Produktkategorien</h6>
                                <div id="categoryFilterList" className="d-grid gap-2">
                                    {products ? (
                                        <>
                                            <CategoryFilterButton value="all" label="Alle Produkte" count={products.length}
                                                selected={filters.category === 'all'} onSelect={category => updateFilters({ category })} />
                                            {categories.map(([categoryName, count]) => (
                                                <CategoryFilterButton key={categoryName} value={categoryName} label={categoryName} count={count}
                                                    selected={filters.category === categoryName} onSelect={category => updateFilters({ category })} />
                                            ))}
                                        </>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                        <SidebarLegal compact />
                    </aside>

                    <main className="col-12 col-md-9 col-xl-10 p-0 d-flex flex-column min-vh-100">
                        <div className="progress w-100" style={{ height: 6, borderRadius: 0 }}>
                            <div aria-valuemax="100" aria-valuemin="0" aria-valuenow={Math.round(progressValue)} aria-label="Fortschritt der Buchung"
                                className="progress-bar progress-bar-striped progress-bar-animated bg-primary" role="progressbar"
                                style={{ width: `${progressValue}%` }} />
                        </div>

                        <div id="qbox-container_form" className="flex-grow-1 w-100 p-4 p-lg-5">
                            {/* The former index.html had no doctype, so browsers rendered it in quirks
                                mode where forms get a 1em bottom margin. Kept for an identical layout. */}
                            <form id="productSearchForm" style={QUIRKS_FORM_SPACING} onSubmit={event => event.preventDefault()} />
                            <form className="needs-validation" id="form-wrapper" method="post" name="form-wrapper" noValidate
                                style={QUIRKS_FORM_SPACING} onSubmit={event => event.preventDefault()}>
                                <div id="steps-container">
                                    <div className={stepClass(0)}>
                                        <div className="d-flex justify-content-end align-items-center mb-3 flex-wrap gap-3">
                                            <div className="d-flex align-items-center flex-wrap gap-2 ms-auto">
                                                <select id="productKindFilter" className="form-select w-auto" aria-label="Artikelart filtern"
                                                    form="productSearchForm" value={filters.kind}
                                                    onChange={event => updateFilters({ kind: event.target.value })}>
                                                    <option value="">Alle Artikelarten</option>
                                                    {productKinds.map(kind => <option key={kind} value={kind}>{kind}</option>)}
                                                </select>
                                                <input type="search" id="productSearchInput" className="form-control"
                                                    aria-label="Produkte und Artikelmerkmale suchen" placeholder="Produkt, Marke, Farbe, Leistung …"
                                                    form="productSearchForm" value={filters.query}
                                                    onChange={event => updateFilters({ query: event.target.value })}
                                                    onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />

                                                <button type="button" className="btn btn-outline-primary position-relative"
                                                    data-bs-toggle="modal" data-bs-target="#cartModal" aria-label="Warenkorb öffnen">
                                                    <i className="bi bi-cart3" />
                                                    <span id="cartItemCount"
                                                        className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">
                                                        {items.length}
                                                    </span>
                                                </button>
                                            </div>
                                        </div>

                                        <div id="bestsellerSection" className={bestsellerHidden ? 'mb-5 d-none' : 'mb-5'}>
                                            <h4 className="mb-0"><i className="bi bi-fire" /> Beliebte Produkte</h4>
                                            <div id="bestsellerGrid" className="product-grid">{bestsellerContent}</div>
                                        </div>

                                        <div className="mb-4">
                                            <h4 id="productSectionTitle">{productSectionTitle}</h4>
                                        </div>

                                        <div className="product-grid" id="productGrid">{productGridContent}</div>

                                        <div id="productPagination" className="product-pagination">
                                            {products && filteredProducts.length > 0
                                                ? <ProductPagination totalPages={totalPages} currentPage={currentPage} onChange={setCurrentPage} />
                                                : null}
                                        </div>
                                    </div>
                                    <div className={stepClass(1)} id="page1">
                                        <h4 className="mb-4">Warenkorb prüfen</h4>

                                        <div className="alert alert-info">
                                            Bitte prüfen Sie Ihre ausgewählten Mietprodukte und Zeiträume.
                                        </div>

                                        <div id="cartReviewItems">
                                            {items.length === 0
                                                ? <div className="alert alert-warning">Ihr Warenkorb ist leer.</div>
                                                : items.map(item => {
                                                    const days = calculateRentalDays(item.rentalStart, item.rentalEnd);
                                                    return (
                                                        <div className="border rounded p-3 mb-2" key={item.id}>
                                                            <strong>{item.title}</strong><br />
                                                            Mietzeitraum: {item.rentalStart} bis {item.rentalEnd}<br />
                                                            Dauer: {describeCartItemDuration(item)}<br />
                                                            Miete: {formatCurrency(days * getItemPricePerDay(item))}<br />
                                                            Kaution: {formatCurrency(getItemDeposit(item))}
                                                        </div>
                                                    );
                                                })}
                                        </div>

                                        <div id="cartReviewSummary" className="card mt-4 checkout-summary">
                                            <div className="card-body">
                                                <h5 className="mb-3">Ihre Kostenübersicht</h5>
                                                <CartSummaryRows idPrefix="cartReview" totals={reviewTotals} />
                                            </div>
                                        </div>
                                    </div>
                                    <div className={stepClass(2)} id="page2">
                                        <h4 className="mb-4">Persönliche Daten</h4>
                                        <CheckoutCustomerStep values={customer} errors={customerErrors} fieldRefs={customerFieldRefs}
                                            onChange={updateCustomerField} />
                                    </div>
                                    <div className={stepClass(3)} id="page3">
                                        <div className="mt-1">
                                            <div className="closing-text">
                                                <h4>Prüfen und verbindlich buchen</h4>

                                                <div className="card p-3 mb-4 checkout-coupon">
                                                    <h5>Gutschein &amp; Gesamtbetrag</h5>
                                                    <label htmlFor="checkoutCouponCode" className="form-label">Code eingeben (optional)</label>
                                                    <div className="d-flex gap-2 flex-wrap">
                                                        <input id="checkoutCouponCode" className="form-control" maxLength={40} autoComplete="off"
                                                            placeholder="z. B. SOMMER10" value={couponCode} disabled={couponBusy}
                                                            onChange={event => changeCouponCode(event.target.value)} />
                                                        <button type="button" className="btn btn-outline-primary" id="checkoutCouponApply"
                                                            disabled={couponBusy} onClick={applyCoupon}>Anwenden</button>
                                                        <button type="button" className="btn btn-outline-secondary" id="checkoutCouponRemove"
                                                            disabled={couponBusy} onClick={removeCoupon}>Entfernen</button>
                                                    </div>
                                                    <p className="small mt-2 mb-0">
                                                        Ein Gutschein pro Bestellung. Der Rabatt gilt auf die Mietsumme; die Kaution bleibt unverändert.
                                                    </p>
                                                    <div id="checkoutCouponStatus" className="mt-2" role="status">{couponStatus}</div>
                                                    <div id="checkoutCouponTotals" className="mt-3 checkout-summary p-3">
                                                        <div className="checkout-summary-row">
                                                            <span>Miete vor Rabatt</span>
                                                            <strong>{formatCurrency(reviewTotals.originalRentalTotal ?? reviewTotals.rentalTotal)}</strong>
                                                        </div>
                                                        {appliedCoupon ? (
                                                            <div className="checkout-summary-row">
                                                                <span>Gutschein {appliedCoupon.coupon.code} ({Number(appliedCoupon.coupon.percent)} %)</span>
                                                                <strong>−{formatCurrency(reviewTotals.discountAmount)}</strong>
                                                            </div>
                                                        ) : null}
                                                        <div className="checkout-summary-row">
                                                            <span>Kaution (unverändert)</span>
                                                            <strong>{formatCurrency(reviewTotals.depositTotal)}</strong>
                                                        </div>
                                                        <div className="checkout-summary-total-row">
                                                            <span>Gesamt inkl. MwSt.</span>
                                                            <strong>{formatCurrency(reviewTotals.rentalTotal + reviewTotals.depositTotal)}</strong>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="mt-4 mb-4">
                                                    <h5 className="mb-3">Zahlungsart wählen</h5>

                                                    <div className="row g-3">
                                                        <div className="col-12 col-lg-6">
                                                            <label className="payment-option-card w-100">
                                                                <input id="paymentMethodCash" type="radio" name="paymentMethod" value="cash"
                                                                    className="payment-radio" checked={paymentMethod === 'cash'}
                                                                    onChange={() => setPaymentMethod('cash')} />
                                                                <div className="card h-100 payment-card">
                                                                    <div className="card-body d-flex align-items-start gap-3">
                                                                        <i className="bi bi-shop payment-icon" />
                                                                        <div>
                                                                            <h6 className="mb-1">Bei Abholung</h6>
                                                                            <small className="text-muted">Sie zahlen den Gesamtbetrag bei Abholung vor Ort.</small>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </label>
                                                        </div>

                                                        <div className="col-12 col-lg-6">
                                                            <label className="payment-option-card w-100">
                                                                <input id="paymentMethodOnline" type="radio" name="paymentMethod" value="online"
                                                                    className="payment-radio" checked={paymentMethod === 'online'}
                                                                    onChange={() => setPaymentMethod('online')} />
                                                                <div className="card h-100 payment-card">
                                                                    <div className="card-body d-flex align-items-start gap-3">
                                                                        <i className="bi bi-credit-card payment-icon" />
                                                                        <div>
                                                                            <h6 className="mb-1">Online bezahlen</h6>
                                                                            <small className="text-muted">
                                                                                Sicher online bezahlen per Karte oder weiteren Zahlungsmethoden.
                                                                            </small>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                                <h5>Unterschrift &amp; Zustimmung</h5>
                                                <p>Bitte unterschreiben Sie im Signaturfeld, um die Reservierung verbindlich abzuschließen.</p>
                                                <p>Mit Ihrer Unterschrift bestätigen Sie:</p>
                                                <ul>
                                                    <li>die Richtigkeit Ihrer angegebenen Daten,</li>
                                                    <li>die verbindliche Reservierung der ausgewählten Mietartikel,</li>
                                                    <li>die Zustimmung zu den AGB und der Datenschutzerklärung,</li>
                                                    <li>dass Kautionen, Zusatzkosten und Nachbelastungen gemäß Mietbedingungen berechnet werden dürfen.</li>
                                                </ul>
                                                <p>Die finale Buchung erfolgt nach erfolgreicher Prüfung und Bestätigung Ihrer Reservierung.</p>
                                                <div id="signature-pad" className="m-signature-pad">
                                                    <div className="m-signature-pad--body">
                                                        <SignatureCanvas ref={signatureRef} visible={inWizard && step === STEP_COUNT} />
                                                        <input type="hidden" name="Signature" id="Signature" defaultValue="" ref={signatureInputRef} />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="container text-center">
                                                <div className="row justify-content-center">
                                                    <div className="col-md-auto">
                                                        <button id="clear-signature" className="btn btn-warning" type="button"
                                                            onClick={() => signatureRef.current.clear()}>
                                                            Signaturfeld leeren
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="form-check form-switch">
                                                <input className="form-check-input" type="checkbox" role="switch" name="agbs" id="agbs"
                                                    checked={agbs} onChange={event => setAgbs(event.target.checked)} />
                                                <label className="form-check-label" htmlFor="agbs">Hiermit stimme ich den AGBs zu</label>
                                            </div>
                                            <div className="form-check form-switch">
                                                <input className="form-check-input" type="checkbox" role="switch" name="dsgvo" id="dsgvo"
                                                    checked={dsgvo} onChange={event => setDsgvo(event.target.checked)} />
                                                <label className="form-check-label" htmlFor="dsgvo">Hiermit stimme ich der Datenschutzerklärung zu</label>
                                            </div>
                                        </div>
                                    </div>
                                    <div id="success" className={view === 'success' ? 'd-block' : 'd-none'}>
                                        <div className="success-screen">
                                            <div className="success-card">
                                                <div className={result.iconClass} id="paymentResultIcon">
                                                    <i className={`bi ${result.icon}`} />
                                                </div>

                                                <h3 id="paymentResultTitle">{result.title}</h3>

                                                <p className="lead mb-4" id="paymentResultText">{result.text}</p>

                                                <div id="final" className="mt-3">
                                                    <PaymentFinal final={result.final} onVerifyAgain={() => verifyPaymentRef.current?.()} />
                                                </div>

                                                <a className="back-link" href="/index.html">
                                                    <button type="button" className="btn btn-primary mt-3">Zurück zur Startseite</button>
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>
                        <div id="q-box__buttons" style={paymentReturn ? { display: 'none' } : undefined}>
                            <button id="prev-btn" type="button" className={showPrev ? 'd-inline-block' : 'd-none'}
                                onClick={goToPreviousStep}>Zurück</button>
                            <button id="next-btn" type="button" className={showNext ? 'd-inline-block' : 'd-none'}
                                onClick={goToNextStep}>Weiter</button>
                            <button id="submit-btn" type="button" className={showSubmit ? 'd-inline-block' : 'd-none'}
                                disabled={submitting} onClick={submitOrder}>Absenden</button>
                        </div>
                    </main>
                </div>
            </div>
            <Preloader visible={preloaderVisible} />

            <ProductDetailsModal ref={productModalRef} onAddToCart={addProductToCart} />
            <ConfirmClearCartModal ref={clearCartModalRef} onConfirm={confirmClearCart} />
            <CartModal ref={cartModalRef} items={items} onEditItem={openCartItemEditor} onDeleteItem={deleteCartItem}
                onClearCart={() => clearCartModalRef.current.show()} onNext={goToNextStepFromCart} />
            <CartItemEditModal ref={cartEditModalRef} onSaved={loadCart} />
        </>
    );
}
