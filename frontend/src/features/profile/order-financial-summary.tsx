'use client';

import { Icon } from '@/components/ui/icon';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatCurrency, formatDate, safeCheckoutUrl } from '@/lib/format';
import type { CustomerOrderDetails, PaymentRecord } from './profile-types';
import { calculateItemFinancials, latestCancellationRefunds, sumPayments } from './profile-utils';
import styles from './profile.module.css';

const OPEN_PAYMENT_STATUSES = ['pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'];
const ACTIONABLE_PAYMENT_STATUSES = ['pending', 'open', 'authorized'];

interface FinancialTotals {
  rentalTotal: number;
  deposit: number;
  depositRefund: number;
  depositRetained: number;
  originalRentalTotal: number;
  rentalAdjustment: number;
  customerAdditionalDue: number;
  customerCredit: number;
  additionalCharges: number;
}

function calculateTotals(order: CustomerOrderDetails): FinancialTotals {
  return (order.items ?? [])
    .filter((item) => String(item.itemStatus || 'active') !== 'cancelled')
    .reduce<FinancialTotals>((totals, item) => {
      const financials = calculateItemFinancials(item);
      totals.rentalTotal += financials.rentalTotal;
      totals.deposit += financials.deposit;
      totals.depositRefund += financials.depositRefund;
      totals.depositRetained += financials.depositRetained;
      totals.originalRentalTotal += financials.originalRentalTotal;
      totals.rentalAdjustment += financials.rentalAdjustment;
      totals.customerAdditionalDue += financials.customerAdditionalDue;
      totals.customerCredit += financials.customerCredit;
      totals.additionalCharges += financials.additionalCharge;
      return totals;
    }, {
      rentalTotal: 0,
      deposit: 0,
      depositRefund: 0,
      depositRetained: 0,
      originalRentalTotal: 0,
      rentalAdjustment: 0,
      customerAdditionalDue: 0,
      customerCredit: 0,
      additionalCharges: 0,
    });
}

function SummaryRow({ label, value, tone }: { label: string; value: number; tone?: 'positive' | 'negative' | 'muted' }) {
  return (
    <div className={styles.summaryRow}>
      <span>{label}</span>
      <strong className={tone ? styles[tone] : undefined}>{formatCurrency(value)}</strong>
    </div>
  );
}

function validCheckoutLink(payment: PaymentRecord): string | null {
  return safeCheckoutUrl(payment.checkoutUrl);
}

export function OrderFinancialSummary({ order }: { order: CustomerOrderDetails }) {
  const payments = order.payments ?? [];
  const totals = calculateTotals(order);
  const paidRentalAdjustments = sumPayments(
    payments,
    (payment) => payment.paymentType === 'rental_adjustment' && payment.paymentStatus === 'paid',
  );
  const paidReturnCharges = sumPayments(
    payments,
    (payment) => payment.paymentType === 'return_additional_charge' && payment.paymentStatus === 'paid',
  );
  const openRentalAdjustments = sumPayments(
    payments,
    (payment) => payment.paymentType === 'rental_adjustment' && OPEN_PAYMENT_STATUSES.includes(payment.paymentStatus || ''),
  );
  const openReturnCharges = sumPayments(
    payments,
    (payment) => payment.paymentType === 'return_additional_charge' && OPEN_PAYMENT_STATUSES.includes(payment.paymentStatus || ''),
  );
  const paidDepositRefunds = sumPayments(
    payments,
    (payment) => payment.paymentType === 'deposit_refund' && payment.paymentStatus === 'paid',
    true,
  );
  const cancellationRefunds = latestCancellationRefunds(payments);
  const paidCancellationRefunds = sumPayments(
    cancellationRefunds,
    (payment) => payment.paymentStatus === 'paid',
    true,
  );
  const outstandingCancellationRefunds = sumPayments(
    cancellationRefunds,
    (payment) => ['pending', 'open', 'authorized', 'failed', 'cancelled'].includes(payment.paymentStatus || ''),
    true,
  );
  const refundableDeposit = Math.max(totals.customerCredit - paidDepositRefunds, 0);
  const legacyReturnDue = openReturnCharges > 0 ? 0 : Math.max(totals.customerAdditionalDue - paidReturnCharges, 0);
  const remainingAdditionalDue = Math.max(openRentalAdjustments + openReturnCharges + legacyReturnDue, 0);
  const finalBalance = remainingAdditionalDue - refundableDeposit - outstandingCancellationRefunds;
  const checkoutPayments = payments.flatMap((payment) => {
    if (
      !['rental_adjustment', 'return_additional_charge'].includes(payment.paymentType || '') ||
      payment.paymentMethod !== 'online' ||
      !ACTIONABLE_PAYMENT_STATUSES.includes(payment.paymentStatus || '')
    ) return [];
    const checkoutUrl = validCheckoutLink(payment);
    return checkoutUrl ? [{ payment, checkoutUrl }] : [];
  });

  return (
    <section aria-labelledby="financial-summary-heading" className={styles.financialPanel}>
      <div className={styles.panelHeading}>
        <span className={styles.headingIcon}><Icon name="cart" /></span>
        <div>
          <h3 id="financial-summary-heading">Gesamtpreisberechnung</h3>
          <p>Mietkosten, Kautionen, Nachzahlungen und Erstattungen im Überblick.</p>
        </div>
      </div>

      {checkoutPayments.length > 0 ? (
        <div className={styles.paymentCallout}>
          <div><Icon name="info" /><strong>Offene Online-Nachzahlung</strong></div>
          {checkoutPayments.map(({ payment, checkoutUrl }) => (
            <div className={styles.paymentCalloutRow} key={payment.id}>
              <span>
                {payment.paymentType === 'rental_adjustment' ? 'Mietverlängerung' : 'Rückgabe-Nachzahlung'}
                {' · '}{formatCurrency(payment.amount)}
              </span>
              <a className="button" href={checkoutUrl} rel="noopener noreferrer" target="_blank">
                Jetzt bezahlen <Icon name="external" size={17} />
              </a>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.summaryColumns}>
        <div className={styles.summaryBlock}>
          <h4>Mietkosten</h4>
          <SummaryRow label="Ursprüngliche Miete inkl. MwSt." value={totals.originalRentalTotal} />
          <SummaryRow
            label="Mietpreis-Korrektur"
            tone={totals.rentalAdjustment > 0 ? 'negative' : totals.rentalAdjustment < 0 ? 'muted' : undefined}
            value={totals.rentalAdjustment}
          />
          <SummaryRow label="Miete gesamt inkl. MwSt." value={totals.rentalTotal} />
          {totals.rentalAdjustment < 0 ? (
            <p className={styles.summaryNote}>Verkürzungen werden nicht automatisch als Mietrückerstattung berücksichtigt.</p>
          ) : null}
        </div>
        <div className={styles.summaryBlock}>
          <h4>Kaution</h4>
          <SummaryRow label="Kaution gesamt" value={totals.deposit} />
          <SummaryRow label="Kaution zurück" tone="positive" value={totals.depositRefund} />
          <SummaryRow label="Kaution einbehalten" tone="negative" value={totals.depositRetained} />
        </div>
        <div className={styles.summaryBlock}>
          <h4>Nachzahlungen & Erstattungen</h4>
          <SummaryRow label="Zusatzforderungen" tone="negative" value={totals.additionalCharges} />
          <SummaryRow label="Bezahlte Mietverlängerungen" tone="positive" value={paidRentalAdjustments} />
          <SummaryRow label="Bezahlte Rückgabe-Nachzahlungen" tone="positive" value={paidReturnCharges} />
          {openRentalAdjustments > 0 ? <SummaryRow label="Offene Mietverlängerungen" tone="negative" value={openRentalAdjustments} /> : null}
          {openReturnCharges > 0 ? <SummaryRow label="Offene Rückgabe-Nachzahlungen" tone="negative" value={openReturnCharges} /> : null}
          {paidCancellationRefunds > 0 ? <SummaryRow label="Ausgezahlte Erstattungen" tone="positive" value={paidCancellationRefunds} /> : null}
          {outstandingCancellationRefunds > 0 ? <SummaryRow label="Noch auszuzahlende Erstattung" value={outstandingCancellationRefunds} /> : null}
        </div>
      </div>

      <div className={styles.balanceRow}>
        <span>
          {finalBalance > 0
            ? 'Noch zu zahlender Gesamtbetrag'
            : finalBalance < 0
              ? 'Noch zu erstattender Gesamtbetrag'
              : 'Bestellung vollständig ausgeglichen'}
        </span>
        <strong className={finalBalance > 0 ? styles.negative : finalBalance < 0 ? styles.positive : styles.muted}>
          {formatCurrency(Math.abs(finalBalance))}
        </strong>
      </div>

      {payments.length > 0 ? (
        <details className={styles.paymentHistory}>
          <summary>Zahlungsverlauf ({payments.length})</summary>
          <div className={styles.paymentTableWrap}>
            <table className={styles.paymentTable}>
              <thead><tr><th>Art</th><th>Verfahren</th><th>Status</th><th>Betrag</th><th>Datum</th></tr></thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.paymentType?.replaceAll('_', ' ') || 'Zahlung'}</td>
                    <td>{payment.paymentMethod === 'online' ? 'Online' : payment.paymentMethod === 'cash' ? 'Bar' : '–'}</td>
                    <td><StatusBadge status={payment.paymentStatus} /></td>
                    <td>{formatCurrency(payment.amount)}</td>
                    <td>{formatDate(payment.paidAt || payment.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
