import Badge from './Badge';
import {
    deriveMyOrderReturnStatus, orderDisplayBadge, paymentBadge, returnBadge, returnCaseBadge, statusBadge
} from '../../lib/orders';

export default function OrderOverview({ order, admin }) {
    const actionAttribute = admin ? { 'data-backend-action': 'open-order-details' } : { 'data-profile-action': 'open-order-details' };

    return (
        <div className="card-body">
            <div className="order-overview-layout">
                <div>
                    <h3 className="h5 mb-2">{order.order_no}</h3>
                    <div className="small text-muted mb-2">
                        Bestellt am {order.created_at ? new Date(order.created_at.replace(' ', 'T')).toLocaleDateString('de-DE') : '–'}
                        {' · '}{(order.items || []).length} Artikel
                    </div>
                    <div>{order.customer_first_name || ''} {order.customer_last_name || ''}</div>
                    {order.customer_company ? <div className="small text-muted">{order.customer_company}</div> : null}
                    <small>{order.customer_email || ''}</small><br />
                    <Badge badge={admin ? orderDisplayBadge(order) : statusBadge(order.status)} />{' '}
                    <Badge badge={paymentBadge(order.payment_status)} />{' '}
                    <Badge badge={returnBadge(admin ? order.return_status : deriveMyOrderReturnStatus(order), order.status, admin)} />{' '}
                    <Badge badge={returnCaseBadge(order.return_case_status, order.status)} />
                </div>

                <div className="d-flex flex-wrap gap-2">
                    {order.hasInvoice ? (
                        <a className="btn btn-outline-primary btn-sm" href={`/${admin ? 'admin/orders' : 'my-orders'}/${Number(order.id)}/invoice/pdf`}>
                            Rechnung
                        </a>
                    ) : null}
                    <button className="btn btn-primary btn-sm" {...actionAttribute} data-order-id={order.id}>Bestellung öffnen</button>
                </div>
            </div>
        </div>
    );
}
