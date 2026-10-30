import {
    RETURN_PROTOCOL_STATUS, formatProtocolDate, invoiceMoney, isReturnFinalized, orderSettlement, safeRelativeImagePath
} from '../../lib/orders';

const money = cents => invoiceMoney(cents / 100);

function TotalRow({ label, amount }) {
    return <div className="settlement-total-row"><span>{label}</span><strong>{money(amount)}</strong></div>;
}

export function OrderSettlement({ order }) {
    const settlement = orderSettlement(order);
    const result = settlement.balance < 0
        ? 'Noch an den Kunden zu erstatten'
        : settlement.balance > 0 ? 'Noch vom Kunden zu zahlen' : 'Aktuell vollständig ausgeglichen';
    const tone = settlement.balance < 0 ? 'is-credit' : settlement.balance > 0 ? 'is-due' : '';

    return (
        <section className="order-sheet-section order-settlement">
            <h3>Preisberechnung im Detail</h3>
            <div className={`settlement-result ${tone}`}>
                <span>{result}</span>
                <strong>{money(Math.abs(settlement.balance))}</strong>
                <small>{settlement.complete ? 'Abrechnung nach Rückgabe' : 'Zwischenstand · Endabrechnung nach Rückgabe aller Artikel'}</small>
            </div>
            <div className="order-sheet-table-wrap">
                <table className="order-sheet-table settlement-costs">
                    <thead><tr><th>Kosten &amp; Begründung</th><th>Betrag</th></tr></thead>
                    <tbody>
                        {settlement.lines.length ? settlement.lines.map((line, index) => (
                            <tr key={index}>
                                <td><strong>{line.label}</strong><small>{line.item}</small><small>{line.reason}</small></td>
                                <td>{money(line.amount)}</td>
                            </tr>
                        )) : <tr><td colSpan={2}>Keine verbleibenden Mietpositionen.</td></tr>}
                    </tbody>
                </table>
            </div>
            <div className="settlement-totals">
                <TotalRow label="Miete und Mehrkosten insgesamt" amount={settlement.costs} />
                <TotalRow label="Bereits eingegangene Zahlungen inkl. Kaution" amount={settlement.paid} />
                {settlement.refunded ? <TotalRow label="Bereits zurückerstattet" amount={settlement.refunded} /> : null}
                <TotalRow label="Noch gebundene Kaution" amount={settlement.held} />
            </div>
            {settlement.deposit ? (
                <div className="settlement-deposit">
                    <strong>Kaution: {money(settlement.deposit)}</strong>
                    <p>{money(settlement.retained)} mit Kosten verrechnet · {money(settlement.held)} noch bis zur Rückgabe gebunden.</p>
                    <small>Die Verrechnung mit der Kaution ist keine zusätzliche Gebühr. Sie ist in der Abrechnung oben bereits berücksichtigt.</small>
                </div>
            ) : null}
            <p className="settlement-note">
                Berücksichtigt werden bestätigte Zahlungen und Erstattungen. Fehlgeschlagene Zahlungsversuche zählen nicht als Zahlung.
                {' '}Der Saldo zeigt die noch offene Differenz.
            </p>
        </section>
    );
}

function ProtocolNote({ label, value }) {
    if (!value) return null;
    return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export function OrderReturnProtocol({ order, admin }) {
    const returned = (order.items || []).filter(item => item.returnedAt || String(item.itemStatus || '').startsWith('returned_'));

    return (
        <section className="order-sheet-section order-return-protocol">
            <h3>Rückgabeprotokoll</h3>
            {!returned.length ? (
                <p className="settlement-note">
                    Noch kein Rückgabeprotokoll vorhanden. Es erscheint hier, sobald eine Rückgabe erfasst wurde.
                </p>
            ) : returned.map((item, index) => (
                <article className="return-protocol-card" key={item.id ?? index}>
                    <header>
                        <strong>{item.title}</strong>
                        <span>{RETURN_PROTOCOL_STATUS[item.itemStatus] || 'Rückgabe erfasst'}</span>
                    </header>
                    <dl>
                        <ProtocolNote label="Geplante Rückgabe" value={formatProtocolDate(item.adjustedRentalEnd || item.rentalEnd)} />
                        <ProtocolNote label="Tatsächliche Rückgabe"
                            value={formatProtocolDate(item.actualReturnDate) + (item.actualReturnTime ? ` · ${item.actualReturnTime} Uhr` : '')} />
                        <ProtocolNote label="Erfasst am" value={formatProtocolDate(item.returnedAt)} />
                        <ProtocolNote label="Schäden" value={item.damageDescription} />
                        <ProtocolNote label="Verspätung" value={item.lateDescription} />
                        <ProtocolNote label="Begründung der Mehrkosten" value={item.additionalChargeReason} />
                        <ProtocolNote label="Kautionsverrechnung" value={item.depositDeductionReason} />
                        <ProtocolNote label="Bemerkungen" value={item.returnNotes} />
                    </dl>
                    <div className="return-protocol-photos">
                        {(item.returnImages || []).map((photo, photoIndex) => {
                            const path = safeRelativeImagePath(photo.imagePath);
                            if (!path) return null;
                            return (
                                <div key={photo.id ?? photoIndex}>
                                    <a href={`/${path}`} target="_blank" rel="noopener">
                                        <img src={`/${path}`} alt={`Rückgabefoto ${item.title}`} />
                                    </a>
                                    {admin && !isReturnFinalized(item) ? (
                                        <button className="btn btn-outline-danger btn-sm" data-backend-action="delete-return-image"
                                            data-image-id={Number(photo.id)} data-order-id={Number(order.id)}>Foto löschen</button>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </article>
            ))}
        </section>
    );
}
