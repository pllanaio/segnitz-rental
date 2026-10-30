import { useEffect, useState } from 'react';
import Badge from './Badge';
import InvoiceDocuments from './InvoiceDocuments';
import { OrderReturnProtocol, OrderSettlement } from './OrderSettlement';
import {
    PAYMENT_METHOD_LABELS, PAYMENT_ROW_LABELS, calculateOrderItemFinancials, formatSheetDate, formatSheetStamp, invoiceFetch,
    invoiceMoney, isLatestSheetPayment, orderStateTone, paymentBadge, paymentDueDays, paymentStatusLabel, safeRelativeImagePath,
    sheetPaymentRows
} from '../../lib/orders';

// Assigns the admin payment actions to the payment rows they belong to. Every action
// is used once; actions without a matching payment get their own row.
export function assignPaymentActions(payments, actions = []) {
    const remaining = [...actions];
    const assigned = new Map();

    payments.forEach(payment => {
        if (!isLatestSheetPayment(payment, payments)) return;
        const matching = remaining.filter(action => action.matchers.some(matcher =>
            (matcher.paymentId !== undefined && matcher.paymentId === String(payment.id)) ||
            (matcher.type === payment.paymentType && String(matcher.item || '') === String(payment.orderItemId || ''))));
        if (!matching.length) return;
        matching.forEach(action => remaining.splice(remaining.indexOf(action), 1));
        assigned.set(payment, matching);
    });

    return { assigned, remaining };
}

function SheetPayments({ order, paymentActions, admin }) {
    const payments = sheetPaymentRows(order);
    const { assigned, remaining } = assignPaymentActions(payments, paymentActions);

    return (
        <>
            <div className="order-sheet-table-wrap">
                <table className="order-sheet-table">
                    <thead><tr><th>Position</th><th>Betrag</th><th>Status</th><th>Aktion</th></tr></thead>
                    <tbody>
                        {payments.map(payment => {
                            const isOpen = ['pending', 'open'].includes(payment.paymentStatus);
                            const dueDays = paymentDueDays(payment);
                            const tone = orderStateTone(payment.paymentStatus);
                            const matching = assigned.get(payment) || [];
                            return (
                                <tr className={`order-payment-row ${tone}`} key={`payment-${payment.id}-${payment.paymentType}`}>
                                    <td>
                                        {PAYMENT_ROW_LABELS[payment.paymentType] || 'Zahlung'}
                                        <small>{payment.createdAt ? new Date(payment.createdAt).toLocaleString('de-DE') : ''}</small>
                                        {['failed', 'cancelled', 'expired', 'replaced'].includes(payment.paymentStatus)
                                            ? <small>Vorheriger Zahlungsversuch</small> : null}
                                    </td>
                                    <td>{invoiceMoney(payment.amount)}</td>
                                    <td>
                                        <span className={`order-sheet-payment-status ${tone || (dueDays < 0 && isOpen ? 'is-failed' : '')}`}>
                                            {paymentStatusLabel(payment.paymentStatus)}
                                        </span>
                                        {isOpen && dueDays !== null
                                            ? <small>{dueDays < 0 ? 'Überfällig' : dueDays === 0 ? 'Heute fällig' : `Fällig in ${dueDays} Tagen`}</small>
                                            : null}
                                    </td>
                                    <td>
                                        {matching.length ? (
                                            <details className={isOpen ? 'order-sheet-payment-actions is-payable' : 'order-sheet-payment-actions'}>
                                                <summary>{isOpen ? 'Jetzt bezahlen' : 'Zahlungsdetails'}</summary>
                                                <div className="order-sheet-action-options">
                                                    {matching.map(action => <PaymentActionNode key={action.key} action={action} />)}
                                                </div>
                                            </details>
                                        ) : (
                                            <details className="order-sheet-payment-actions">
                                                <summary>Zahlungsdetails</summary>
                                                <div className="order-sheet-action-options">
                                                    {PAYMENT_METHOD_LABELS[payment.paymentMethod] || 'Zahlung'} · {paymentStatusLabel(payment.paymentStatus)}
                                                    {payment.paidAt
                                                        ? <><br />Bezahlt am {new Date(payment.paidAt).toLocaleDateString('de-DE')}</>
                                                        : null}
                                                </div>
                                            </details>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        {remaining.map(action => (
                            <tr key={`action-${action.key}`}>
                                <td>{action.title || 'Zahlung'}</td>
                                <td>–</td>
                                <td>Aktion erforderlich</td>
                                <td>
                                    <details className="order-sheet-payment-actions">
                                        <summary>Zahlungsdetails</summary>
                                        <div className="order-sheet-action-options"><PaymentActionNode action={action} /></div>
                                    </details>
                                </td>
                            </tr>
                        ))}
                        {!payments.length && !remaining.length
                            ? <tr><td colSpan={4}>Noch keine Zahlungsvorgänge vorhanden.</td></tr>
                            : null}
                    </tbody>
                </table>
            </div>
            {admin ? (
                <button className="btn btn-link btn-sm order-sheet-sync" data-backend-action="open-order-details"
                    data-order-id={order.id}>Mit Mollie abgleichen</button>
            ) : null}
        </>
    );
}

function PaymentActionNode({ action }) {
    return action.node;
}

const NO_INVOICES_TEXT = 'Bezahlte Rechnungen sowie Storno- und Korrekturbelege erscheinen hier nach ihrer Freigabe.';

// Order-sheet variant of the invoice card: documents only, no payment controls.
function SheetInvoices({ orderId, admin, revision }) {
    const [state, setState] = useState({ status: 'loading', items: [] });

    useEffect(() => {
        let active = true;
        setState({ status: 'loading', items: [] });
        (async () => {
            try {
                const data = await invoiceFetch(`${admin ? '/admin/orders' : '/my-orders'}/${Number(orderId)}/invoice`);
                const invoice = data.invoice || (admin ? { status: 'queued', amount: null } : null);
                if (!invoice) {
                    if (active) setState({ status: 'removed', items: [] });
                    return;
                }
                const archive = await invoiceFetch(`${admin ? '/admin/invoices' : '/my-invoices'}?orderId=${Number(orderId)}`);
                if (active) setState({ status: 'loaded', items: archive.items });
            } catch (error) {
                if (active) setState({ status: 'error', items: [] });
            }
        })();
        return () => { active = false; };
    }, [orderId, admin, revision]);

    if (state.status === 'removed') return null;
    if (state.status === 'error') return <div data-sheet-invoices="">Rechnungen konnten gerade nicht geladen werden.</div>;

    return (
        <div data-sheet-invoices="">
            {state.status === 'loaded' ? (
                <>
                    <InvoiceDocuments items={state.items} admin={admin} compact />
                    {state.items.length ? null : <p className="text-muted">{NO_INVOICES_TEXT}</p>}
                </>
            ) : null}
        </div>
    );
}

function CustomerBlock({ order }) {
    return (
        <div>
            <span className="order-sheet-label">Kunde</span>
            <div className="order-sheet-customer">
                <i className="bi bi-person-fill" aria-hidden="true" />
                <div>
                    <strong>{order.customer_first_name} {order.customer_last_name}</strong>
                    {order.customer_company ? <div>{order.customer_company}</div> : null}
                    <div>{order.customer_address}</div>
                    <div>{order.customer_zip} {order.customer_city}</div>
                    <div>{order.customer_email}</div>
                    <div>{order.customer_phone}</div>
                </div>
            </div>
        </div>
    );
}

function ItemRows({ items }) {
    return items.map((item, index) => {
        const financials = calculateOrderItemFinancials(item);
        // Relative image paths only; protocol-relative or absolute URLs fall back to the icon.
        const image = safeRelativeImagePath(item.imagePath);
        return (
            <tr className={item.itemStatus === 'cancelled' ? 'order-sheet-item-cancelled' : ''} key={item.id ?? index}>
                <td>
                    <div className="order-sheet-product">
                        {image ? <img src={`/${image}`} alt="" /> : <i className="bi bi-box-seam" aria-hidden="true" />}
                        <div>
                            <strong className="order-sheet-product-title">{item.title}</strong>
                            {item.itemStatus === 'cancelled'
                                ? <small className="text-danger">Storniert</small>
                                : item.itemStatus === 'picked_up' ? <small>Abgeholt</small> : null}
                            <small>{[item.manufacturer, item.model].filter(value => value && value !== 'n.V.').join(' ')}</small>
                            <small>Art.-Nr. {item.productKey || item.productId}</small>
                        </div>
                    </div>
                </td>
                <td>
                    {formatSheetDate(item.adjustedRentalStart || item.rentalStart)} – {formatSheetDate(item.adjustedRentalEnd || item.rentalEnd)}
                    {item.rentalHours
                        ? <small>{Number(item.adjustedRentalHours || item.rentalHours)} Stunden ab {item.rentalStartTime}</small>
                        : null}
                </td>
                <td>
                    {invoiceMoney(financials.pricePerDay)}
                    {item.rentalHours ? <small>Preis für den Stundentarif</small> : <small>pro Tag</small>}
                    <small>Kaution: {invoiceMoney(financials.deposit)}</small>
                </td>
                <td><strong>{invoiceMoney(financials.grossTotalWithDeposit)}</strong></td>
            </tr>
        );
    });
}

// The order detail sheet shared by "Meine Bestellungen" and the admin dashboard.
export default function OrderSheet({
    order, admin, statusBadge, cancel = null, itemActions = null, paymentActions = [], reviews = null, invoiceRevision = 0
}) {
    const items = order.items || [];
    const picked = items.map(item => item.pickedUpAt).filter(Boolean).sort()[0];
    const ends = items.filter(item => item.itemStatus !== 'cancelled')
        .map(item => item.adjustedRentalEnd || item.rentalEnd).filter(Boolean).sort();
    const signed = admin ? order.handoverStatus === 'signed' : order.handoverAvailable;
    const handoverUrl = `${admin ? '/admin/orders/' : '/my-orders/'}${Number(order.id)}/handover/pdf`;

    const handover = admin
        ? (
            <button className="btn btn-outline-primary order-handover" data-handover-order={Number(order.id)}>
                <i className="bi bi-file-earmark-text" /> Übergabeprotokoll {signed ? 'ansehen' : 'erstellen'}
            </button>
        )
        : (
            <button type="button" className="btn btn-outline-primary order-handover"
                data-handover-order={signed ? Number(order.id) : undefined}
                data-handover-customer={signed ? 'true' : undefined}
                disabled={!signed}>
                <i className="bi bi-file-earmark-text" /> Übergabeprotokoll ansehen
            </button>
        );

    // A single wrapper keeps unmounting safe even if a script replaced inner sections.
    return (
        <div className="order-sheet-content">
            <div className="order-sheet-status">
                <span className={orderStateTone(order.status)}>
                    <i className="bi bi-truck" aria-hidden="true" /> <Badge badge={statusBadge} />
                </span>{' '}
                <span className={orderStateTone(order.payment_status)}>
                    <i className="bi bi-clock" aria-hidden="true" /> <Badge badge={paymentBadge(order.payment_status)} />
                </span>
            </div>
            <div className="order-sheet-parties">
                <CustomerBlock order={order} />
                <dl>
                    <dt>Auftragsnummer</dt><dd>{order.order_no}</dd>
                    <dt>Bestelldatum</dt><dd>{formatSheetDate(order.created_at)}</dd>
                    <dt>Abholung am</dt><dd>{picked ? formatSheetStamp(picked) : 'Noch nicht abgeholt'}</dd>
                    <dt>Rückgabe geplant</dt><dd>{formatSheetDate(ends.at(-1))}</dd>
                </dl>
            </div>
            <div className="order-sheet-actions">{cancel}{handover}{itemActions}</div>
            {order.status === 'cancelled' ? (
                <p className="alert alert-danger">
                    Storniert{order.cancelled_at ? ` am ${formatSheetDate(order.cancelled_at)}` : ''}{order.cancel_reason ? ` · ${order.cancel_reason}` : ''}
                </p>
            ) : null}
            <section className="order-sheet-section">
                <h3>Zahlungen</h3>
                <div data-sheet-payments="">
                    <SheetPayments order={order} paymentActions={paymentActions} admin={admin} />
                </div>
            </section>
            <section className="order-sheet-section">
                <h3>Artikel</h3>
                <div className="order-sheet-table-wrap">
                    <table className="order-sheet-table">
                        <thead><tr><th>Artikel</th><th>Zeitraum</th><th>Miettarif / Kaution</th><th>Gesamt inkl. Kaution</th></tr></thead>
                        <tbody><ItemRows items={items} /></tbody>
                    </table>
                </div>
            </section>
            <section className="order-sheet-section order-sheet-documents">
                <h3>Dokumente</h3>
                <div className="order-sheet-document-head"><span>Name</span><span>Erstellt am</span><span>Aktion</span></div>
                {signed ? (
                    <div className="order-sheet-document">
                        <span><i className="bi bi-file-earmark-text" /> Übergabeprotokoll</span>
                        <span>{formatSheetStamp(order.handoverSignedAt)}</span>
                        <a className="btn btn-outline-primary btn-sm" href={handoverUrl} target="_blank" rel="noopener">
                            <i className="bi bi-download" /> PDF
                        </a>
                    </div>
                ) : null}
                <SheetInvoices orderId={order.id} admin={admin} revision={invoiceRevision} />
            </section>
            <OrderSettlement order={order} />
            <OrderReturnProtocol order={order} admin={admin} />
            {reviews}
        </div>
    );
}
