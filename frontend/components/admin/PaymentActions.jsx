// Renders the descriptors of lib/adminPayments.js. The buttons only carry data
// attributes; the admin page handles them through delegated click handlers.
function ActionButton({ button }) {
    switch (button.kind) {
    case 'manual-payment':
    case 'manual-refund':
        return (
            <button type="button" className={button.className}
                data-backend-action={button.kind === 'manual-payment' ? 'open-manual-payment' : 'open-manual-refund'}
                data-order-id={button.orderId} data-item-id={button.itemId} data-payment-type={button.paymentType}
                data-amount={button.amount}>
                {button.label}
            </button>
        );
    case 'retry-refund':
        return (
            <button type="button" className={button.className} data-backend-action="retry-online-refund"
                data-payment-id={button.paymentId} data-order-id={button.orderId}>
                {button.label}
            </button>
        );
    case 'pos':
        return (
            <button type="button" className={button.className} data-pos-order={button.orderId} data-pos-item={button.posItem}
                data-pos-type={button.posType} data-pos-record={button.posRecord}>
                {button.label}
            </button>
        );
    case 'transfer':
        return <button type="button" className={button.className} data-transfer-order={button.orderId}>{button.label}</button>;
    case 'additional-transfer':
        return (
            <button type="button" className={button.className} data-additional-transfer={button.orderId}
                data-item={button.item ?? undefined} data-type={button.type}>
                {button.label}
            </button>
        );
    case 'checkout-link':
        return <a className={button.className} href={button.href} target="_blank" rel="noopener noreferrer">{button.label}</a>;
    default:
        return null;
    }
}

export function PaymentActionRow({ action }) {
    const heading = (
        <div>
            <div className="cash-action-title">{action.title}</div>
            <div className="small text-muted">{action.subtitle}</div>
        </div>
    );

    if (action.layout === 'pos-only') {
        return (
            <div className="cash-action-row">
                {heading}
                {action.buttons.map((button, index) => <ActionButton key={index} button={button} />)}
            </div>
        );
    }

    return (
        <div className="cash-action-row">
            {heading}
            <div className="cash-action-controls">
                <strong>{Number(action.amount || 0).toFixed(2)} €</strong>
                {action.buttons.map((button, index) => <ActionButton key={index} button={button} />)}
            </div>
        </div>
    );
}

export function toSheetPaymentActions(actions) {
    return actions.map(action => ({ ...action, node: <PaymentActionRow action={action} /> }));
}

// Stand-alone panel (renderOrderPaymentActionPanel compatibility API).
export function OrderPaymentActionPanel({ order, actions }) {
    if (!actions.length) return null;

    return (
        <div className="col-12">
            <div className="card checkout-summary mb-3">
                <div className="card-body">
                    <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                        <h5 className="mb-0">Zahlungen &amp; Erstattungen</h5>
                        <button type="button" className="btn btn-outline-primary btn-sm" data-backend-action="open-order-details"
                            data-order-id={order.id}>Mit Mollie abgleichen</button>
                    </div>
                    {actions.map(action => <PaymentActionRow key={action.key} action={action} />)}
                </div>
            </div>
        </div>
    );
}
