import { invoiceDocumentBase, invoiceDocumentStatus, invoiceDocumentTone, invoiceMoney } from '../../lib/orders';

function amountText(invoice) {
    return invoiceMoney(Number(invoice.amount) + Number(invoice.depositAmount || 0)) +
        (Number(invoice.depositAmount) > 0 ? 'inkl. ' + invoiceMoney(invoice.depositAmount) + ' Kaution' : '');
}

// One invoice/credit document row. "compact" is the order-sheet layout in which the
// amount moves into the row title and the status sits below the document name.
export function InvoiceDocumentRow({ invoice, admin, compact = false }) {
    const base = invoiceDocumentBase(invoice, admin);
    const status = invoiceDocumentStatus(invoice);
    const tone = invoiceDocumentTone(invoice);
    const statusBadge = <span className={`invoice-status ${tone}`}>{status}</span>;

    return (
        <article className={`invoice-document ${tone}`} title={compact ? `${amountText(invoice)} · ${status}` : undefined}>
            <div className="invoice-document-name">
                <i className="bi bi-file-earmark-text" aria-hidden="true" />
                <div>
                    <strong>{invoice.invoiceNumber}</strong>
                    <p>{invoice.description || 'Miete und Kaution'}</p>
                    {compact ? statusBadge : null}
                </div>
            </div>
            <div className="invoice-document-date">
                {new Date(invoice.createdAt).toLocaleDateString('de-DE')}
                {invoice.dueAt && invoice.kind !== 'credit'
                    ? <small>Fällig {new Date(invoice.dueAt).toLocaleDateString('de-DE')}</small>
                    : null}
            </div>
            {compact ? null : (
                <div className="invoice-document-amount">
                    <strong>{invoiceMoney(Number(invoice.amount) + Number(invoice.depositAmount || 0))}</strong>
                    {Number(invoice.depositAmount) > 0 ? <small>inkl. {invoiceMoney(invoice.depositAmount)} Kaution</small> : null}
                </div>
            )}
            {compact ? null : statusBadge}
            <div className="invoice-downloads">
                <a className="btn btn-outline-primary btn-sm" href={`${base}/pdf`} aria-label={`PDF ${invoice.invoiceNumber}`}>PDF</a>
                {invoice.hasXml
                    ? <a className="btn btn-outline-primary btn-sm" href={`${base}/xml`} aria-label={`XML ${invoice.invoiceNumber}`}>XML</a>
                    : null}
            </div>
        </article>
    );
}

export default function InvoiceDocuments({ items, admin, compact = false }) {
    return (
        <div className={compact ? 'invoice-documents order-sheet-invoice-rows' : 'invoice-documents'}>
            {items.map(invoice => <InvoiceDocumentRow key={`${invoice.kind}-${invoice.id}-${invoice.legacy ? 'l' : 'n'}`}
                invoice={invoice} admin={admin} compact={compact} />)}
        </div>
    );
}
