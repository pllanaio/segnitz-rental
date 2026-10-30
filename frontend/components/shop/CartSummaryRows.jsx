import { formatCurrency, splitGrossRental } from '../../lib/shop';

// Shared "Mietkosten / Kaution / Heute zu zahlen" block of cart modal and review step.
export default function CartSummaryRows({ idPrefix, totals }) {
    const { rentalGross, rentalNet, rentalVat } = splitGrossRental(totals.rentalTotal);
    const grandTotal = totals.rentalTotal + totals.depositTotal;

    return (
        <>
            <div className="summary-section-label">Mietkosten</div>

            <div className="checkout-summary-row">
                <span>Mietpreis netto</span>
                <strong id={`${idPrefix}RentalNetTotal`}>{formatCurrency(rentalNet)}</strong>
            </div>

            <div className="checkout-summary-row">
                <span>Mehrwertsteuer 19%</span>
                <strong id={`${idPrefix}RentalVatTotal`}>{formatCurrency(rentalVat)}</strong>
            </div>

            <div className="checkout-summary-row">
                <span>Mietpreis brutto</span>
                <strong id={`${idPrefix}RentalTotal`}>{formatCurrency(rentalGross)}</strong>
            </div>

            <hr />

            <div className="summary-section-label">Kaution</div>

            <div className="checkout-summary-row">
                <span>Zu hinterlegen</span>
                <strong id={`${idPrefix}DepositTotal`}>{formatCurrency(totals.depositTotal)}</strong>
            </div>

            <div className="small text-muted mb-3">
                Die Kaution wird nach Rückgabe geprüft und je nach Zustand vollständig oder teilweise erstattet.
            </div>

            <div className="checkout-summary-total-row">
                <span>Heute zu zahlen</span>
                <strong id={`${idPrefix}GrandTotal`}>{`${formatCurrency(grandTotal)} inkl. MwSt.`}</strong>
            </div>
        </>
    );
}
