'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/icon';
import { AdminStatusBadge } from './admin-status-badge';
import {
  assetPath,
  dateLabel,
  depositDecisionLabel,
  deriveOrderStatus,
  financials,
  itemStatus,
  latestPayments,
  money,
  numberValue,
  paymentTypeLabel,
  safeCheckoutUrl,
  textValue,
} from './admin-utils';
import type {
  AdminOrder,
  AdminOrderItem,
  AdminPayment,
  AdminReturnImage,
  PaymentAction,
} from './types';
import styles from './admin.module.css';

interface OrderDetailsProps {
  order: AdminOrder;
  busyAction: string | null;
  onCancelItem: (item: AdminOrderItem) => void;
  onCancelOrder: () => void;
  onDeleteImage: (image: AdminReturnImage) => void;
  onExtend: (item: AdminOrderItem) => void;
  onOpenPayment: (action: PaymentAction) => void;
  onPickupItem: (item: AdminOrderItem) => void;
  onPickupOrder: () => void;
  onResendSummary: (item: AdminOrderItem) => void;
  onRetryRefund: (payment: AdminPayment) => void;
  onReturn: (item: AdminOrderItem) => void;
}

export function OrderDetails({
  order,
  busyAction,
  onCancelItem,
  onCancelOrder,
  onDeleteImage,
  onExtend,
  onOpenPayment,
  onPickupItem,
  onPickupOrder,
  onResendSummary,
  onRetryRefund,
  onReturn,
}: OrderDetailsProps) {
  const status = String(order.status ?? '').toLowerCase();
  const paid = String(order.payment_status ?? '').toLowerCase() === 'paid';
  const items = order.items ?? [];
  const canPickupOrder = paid && ['reserved', 'confirmed', 'paid', 'active'].includes(status)
    && items.some((item) => itemStatus(item) === 'active');
  const canCancelOrder = !['cancelled', 'returned', 'expired', 'picked_up'].includes(status)
    && !items.some((item) => itemStatus(item) === 'picked_up' || item.pickedUpAt || item.picked_up_at);

  return (
    <div className={styles.orderDetails} id="orderDetailsBody">
      <div className={styles.detailHeaderGrid}>
        <section className={styles.detailBlock}>
          <span className={styles.eyebrow}>Bestellung</span>
          <h3>{order.order_no || `#${order.id}`}</h3>
          <div className={styles.badgeLine}>
            <AdminStatusBadge status={deriveOrderStatus(order)} />
            <AdminStatusBadge status={order.payment_status} />
            <AdminStatusBadge status={order.return_status} />
            {order.return_case_status ? <AdminStatusBadge status={order.return_case_status} /> : null}
          </div>
          <dl className={styles.dataList}>
            <div><dt>Erstellt</dt><dd>{dateLabel(order.created_at, true)}</dd></div>
            <div><dt>Zahlungsart</dt><dd>{order.payment_method === 'cash' ? 'Barzahlung' : order.payment_method === 'online' ? 'Online' : textValue(order.payment_method)}</dd></div>
            {status === 'cancelled' ? <div><dt>Storniert</dt><dd>{dateLabel(order.cancelled_at || order.cancelledAt, true)}</dd></div> : null}
            {status === 'cancelled' ? <div><dt>Stornogrund</dt><dd>{textValue(order.cancel_reason ?? order.cancelReason)}</dd></div> : null}
          </dl>
        </section>
        <section className={styles.detailBlock}>
          <span className={styles.eyebrow}>Kunde</span>
          <h3>{[order.customer_first_name, order.customer_last_name].filter(Boolean).join(' ') || 'Unbekannt'}</h3>
          {order.customer_company ? <p>{order.customer_company}</p> : null}
          <address>
            <a href={`mailto:${order.customer_email ?? ''}`}>{order.customer_email || '–'}</a><br />
            <a href={`tel:${order.customer_phone ?? ''}`}>{order.customer_phone || '–'}</a><br />
            {order.customer_address || '–'}<br />
            {order.customer_zip || ''} {order.customer_city || ''}
          </address>
        </section>
      </div>

      <div className={styles.detailToolbar}>
        <button className="button buttonSecondary" disabled={!canPickupOrder || Boolean(busyAction)} onClick={onPickupOrder} type="button"><Icon name="check" /> Bestellung abholen</button>
        <button className="button buttonDanger" disabled={!canCancelOrder || Boolean(busyAction)} onClick={onCancelOrder} type="button"><Icon name="trash" /> Bestellung stornieren</button>
      </div>

      <PaymentActionPanel order={order} onOpenPayment={onOpenPayment} onRetryRefund={onRetryRefund} />

      <section className={styles.detailSection}>
        <div className={styles.sectionHeading}>
          <div><h3>Artikel</h3><p>{items.length} Bestellposition{items.length === 1 ? '' : 'en'}</p></div>
        </div>
        {items.length === 0 ? <div className="emptyState">Keine Artikel vorhanden.</div> : (
          <div className={styles.itemList}>
            {items.map((item) => (
              <OrderItemCard
                busyAction={busyAction}
                item={item}
                key={item.id}
                onCancel={() => onCancelItem(item)}
                onDeleteImage={onDeleteImage}
                onExtend={() => onExtend(item)}
                onPickup={() => onPickupItem(item)}
                onResendSummary={() => onResendSummary(item)}
                onReturn={() => onReturn(item)}
                order={order}
              />
            ))}
          </div>
        )}
      </section>

      <OrderFinancialSummary order={order} />
      <PaymentHistory payments={order.payments ?? []} />
    </div>
  );
}

function PaymentActionPanel({
  order,
  onOpenPayment,
  onRetryRefund,
}: {
  order: AdminOrder;
  onOpenPayment: (action: PaymentAction) => void;
  onRetryRefund: (payment: AdminPayment) => void;
}) {
  const payments = order.payments ?? [];
  const orderClosed = ['cancelled', 'expired'].includes(String(order.status ?? '').toLowerCase());
  const actions: ReactNode[] = [];

  payments
    .filter((payment) => ['rental_adjustment', 'return_additional_charge'].includes(String(payment.paymentType))
      && payment.paymentMethod === 'online'
      && ['pending', 'open', 'authorized'].includes(String(payment.paymentStatus)))
    .forEach((payment) => {
      const checkoutUrl = safeCheckoutUrl(payment.checkoutUrl);
      if (!checkoutUrl) return;
      actions.push(
        <PaymentActionRow description="Der Mollie-Zahlungslink ist noch offen." key={`checkout-${payment.id}`} title={paymentTypeLabel(payment.paymentType)} value={money(payment.amount)}>
          <a className="button buttonSecondary" href={checkoutUrl} rel="noopener noreferrer" target="_blank"><Icon name="external" size={17} /> Zahlungslink</a>
        </PaymentActionRow>,
      );
    });

  const initialOpen = payments.filter((payment) => ['rental', 'deposit'].includes(String(payment.paymentType))
    && payment.paymentMethod === 'cash'
    && ['pending', 'open'].includes(String(payment.paymentStatus))
    && !payment.orderItemId);
  const initialAmount = initialOpen.reduce((sum, payment) => sum + numberValue(payment.amount), 0);
  const initialPaid = String(order.payment_status).toLowerCase() === 'paid' || payments.some((payment) => payment.paymentType === 'initial_payment' && payment.paymentMethod === 'cash' && payment.paymentStatus === 'paid');
  if (!orderClosed && initialAmount > 0 && !initialPaid) {
    actions.push(
      <PaymentActionRow description="Miete und Kaution müssen vor der Abholung vollständig kassiert werden." key="cash-initial" title="Barzahlung bei Abholung" value={money(initialAmount)}>
        <button className="button" onClick={() => onOpenPayment({ mode: 'payment', orderId: order.id, orderItemId: null, paymentType: 'initial_payment', amount: initialAmount })} type="button">Bar kassieren</button>
      </PaymentActionRow>,
    );
  }

  payments
    .filter((payment) => !orderClosed
      && ['rental_adjustment', 'return_additional_charge'].includes(String(payment.paymentType))
      && payment.paymentMethod === 'cash'
      && ['pending', 'open'].includes(String(payment.paymentStatus)))
    .forEach((payment) => actions.push(
      <PaymentActionRow description="Offener Barzahlungsvorgang." key={`cash-${payment.id}`} title={paymentTypeLabel(payment.paymentType)} value={money(payment.amount)}>
        <button className="button" onClick={() => onOpenPayment({ mode: 'payment', orderId: order.id, orderItemId: payment.orderItemId ?? null, paymentType: String(payment.paymentType), amount: numberValue(payment.amount) })} type="button">Bar kassieren</button>
      </PaymentActionRow>,
    ));

  payments
    .filter((payment) => ['deposit_refund', 'order_cancellation_refund'].includes(String(payment.paymentType))
      && payment.paymentMethod === 'cash'
      && ['pending', 'open'].includes(String(payment.paymentStatus)))
    .forEach((payment) => actions.push(
      <PaymentActionRow description="Die Auszahlung muss vor Ort bestätigt werden." key={`refund-${payment.id}`} title={paymentTypeLabel(payment.paymentType)} value={money(Math.abs(numberValue(payment.amount)))}>
        <button className="button buttonDanger" onClick={() => onOpenPayment({ mode: 'refund', orderId: order.id, orderItemId: payment.orderItemId ?? null, paymentType: String(payment.paymentType), amount: Math.abs(numberValue(payment.amount)) })} type="button">Bar erstatten</button>
      </PaymentActionRow>,
    ));

  const retryable = latestPayments(payments.filter((payment) => payment.paymentMethod === 'online'), new Set(['deposit_refund', 'order_cancellation_refund', 'duplicate_payment_refund']));
  retryable.filter((payment) => ['failed', 'cancelled'].includes(String(payment.paymentStatus))).forEach((payment) => actions.push(
    <PaymentActionRow description="Die Erstattung muss erneut bei Mollie beauftragt werden." key={`retry-${payment.id}`} title="Online-Erstattung fehlgeschlagen" value={money(Math.abs(numberValue(payment.amount)))}>
      <button className="button buttonSecondary" onClick={() => onRetryRefund(payment)} type="button"><Icon name="refresh" size={17} /> Erneut versuchen</button>
    </PaymentActionRow>,
  ));

  if (actions.length === 0) return null;
  return (
    <section className={`${styles.detailSection} ${styles.paymentActions}`}>
      <div className={styles.sectionHeading}><div><h3>Offene Zahlungs- und Erstattungsvorgänge</h3><p>Vorgänge mit Handlungsbedarf</p></div></div>
      <div className={styles.paymentActionList}>{actions}</div>
    </section>
  );
}

function PaymentActionRow({ title, description, value, children }: { title: string; description: string; value: string; children: ReactNode }) {
  return (
    <div className={styles.paymentActionRow}>
      <div><strong>{title}</strong><span>{description}</span></div>
      <div><b>{value}</b>{children}</div>
    </div>
  );
}

function OrderItemCard({
  order,
  item,
  busyAction,
  onPickup,
  onExtend,
  onCancel,
  onReturn,
  onDeleteImage,
  onResendSummary,
}: {
  order: AdminOrder;
  item: AdminOrderItem;
  busyAction: string | null;
  onPickup: () => void;
  onExtend: () => void;
  onCancel: () => void;
  onReturn: () => void;
  onDeleteImage: (image: AdminReturnImage) => void;
  onResendSummary: () => void;
}) {
  const status = itemStatus(item);
  const orderStatus = String(order.status ?? '').toLowerCase();
  const orderPaid = String(order.payment_status ?? '').toLowerCase() === 'paid';
  const expired = orderStatus === 'expired';
  const canEdit = ['active', 'picked_up'].includes(status) && !expired && orderPaid;
  const canCancel = status === 'active' && !expired && !(order.payment_method === 'online' && !orderPaid);
  const canPickup = status === 'active' && !expired && orderPaid;
  const canReturn = status === 'picked_up' && !expired;
  const returned = status.startsWith('returned_');
  const amounts = financials(item);
  const start = item.adjustedRentalStart || item.rentalStart;
  const end = item.adjustedRentalEnd || item.rentalEnd;

  return (
    <article className={`${styles.itemCard} ${expired ? styles.itemDisabled : ''}`}>
      <div className={styles.itemHeader}>
        <div>
          <span className={styles.itemNumber}>Position #{item.id}</span>
          <h4>{item.title || 'Unbekannter Artikel'}</h4>
          <AdminStatusBadge status={status} />
        </div>
        <div className={styles.itemActions}>
          <button className="button buttonSecondary" disabled={!canPickup || Boolean(busyAction)} onClick={onPickup} type="button">Abholen</button>
          <button className="button buttonSecondary" disabled={!canEdit || Boolean(busyAction)} onClick={onExtend} type="button">Verlängern</button>
          <button className="button buttonSecondary" disabled={!canCancel || Boolean(busyAction)} onClick={onCancel} type="button">Stornieren</button>
          <button className="button" disabled={!canReturn || Boolean(busyAction)} onClick={onReturn} type="button">Rückgabe</button>
        </div>
      </div>

      <div className={styles.itemFacts}>
        <div><span>Mietzeitraum</span><strong>{start || '–'} bis {end || '–'}</strong></div>
        <div><span>Tagespreis</span><strong>{money(amounts.pricePerDay)}</strong></div>
        <div><span>Kaution</span><strong>{money(amounts.deposit)}</strong></div>
        <div><span>Miettage</span><strong>{amounts.effectiveDays}</strong></div>
      </div>

      {status === 'cancelled' ? <p className={styles.dangerCallout}>Storniert: {textValue(item.cancelReason)}</p> : null}
      {returned ? (
        <div className={styles.returnInfo}>
          <div><span>Rückgabe</span><strong>{dateLabel(item.returnedAt, true)}</strong></div>
          <div><span>Kaution</span><strong>{depositDecisionLabel(item.depositDecision)}</strong></div>
          <div><span>Verspätung</span><strong>{amounts.daysLate} Tag{amounts.daysLate === 1 ? '' : 'e'}</strong></div>
          <button className="button buttonSecondary" disabled={Boolean(busyAction)} onClick={onResendSummary} type="button">Abschlussmail erneut senden</button>
        </div>
      ) : null}

      {(item.returnImages ?? []).length > 0 ? (
        <div className={styles.returnImageGrid}>
          {(item.returnImages ?? []).map((image) => (
            <article className={styles.returnImage} key={image.id}>
              <a href={assetPath(image.imagePath)} rel="noopener noreferrer" target="_blank">
                <Image alt={`Rückgabefoto ${image.id}`} fill sizes="180px" src={assetPath(image.imagePath)} unoptimized />
              </a>
              <button className="button buttonDanger" onClick={() => onDeleteImage(image)} type="button"><Icon name="trash" size={16} /> Löschen</button>
            </article>
          ))}
        </div>
      ) : null}

      <div className={styles.itemSummaryGrid}>
        <div className={styles.summaryPanel}>
          <h5>Preisübersicht</h5>
          <SummaryRow label="Miete gesamt" value={money(amounts.rentalTotal)} />
          <SummaryRow label="Kaution" value={money(amounts.deposit)} />
          <SummaryRow emphasis label="Gesamt inkl. Kaution" value={money(amounts.totalWithDeposit)} />
        </div>
        <div className={styles.summaryPanel}>
          <h5>Rückgabe Soll / Ist</h5>
          <SummaryRow label="Geplante Rückgabe" value={dateLabel(end)} />
          <SummaryRow label="Tatsächliche Rückgabe" value={dateLabel(item.actualReturnDate || item.returnedAt)} />
          <SummaryRow label="Verspätungskosten" value={money(amounts.lateFee)} />
          <SummaryRow label="Kaution zurück" value={money(amounts.depositRefund)} />
          <SummaryRow label="Kaution einbehalten" value={money(amounts.depositRetained)} />
        </div>
      </div>
    </article>
  );
}

function OrderFinancialSummary({ order }: { order: AdminOrder }) {
  const items = (order.items ?? []).filter((item) => itemStatus(item) !== 'cancelled');
  const totals = items.reduce((sum, item) => {
    const value = financials(item);
    sum.originalRental += value.originalRental;
    sum.rental += value.rentalTotal;
    sum.deposit += value.deposit;
    sum.refund += value.depositRefund;
    sum.retained += value.depositRetained;
    sum.additional += value.additionalCharge;
    return sum;
  }, { originalRental: 0, rental: 0, deposit: 0, refund: 0, retained: 0, additional: 0 });
  const payments = order.payments ?? [];
  const openAdditional = payments.filter((payment) => ['rental_adjustment', 'return_additional_charge'].includes(String(payment.paymentType))
    && ['pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'].includes(String(payment.paymentStatus)))
    .reduce((sum, payment) => sum + numberValue(payment.amount), 0);
  const openRefunds = latestPayments(payments, new Set(['deposit_refund', 'order_cancellation_refund', 'duplicate_payment_refund']))
    .filter((payment) => ['pending', 'open', 'authorized', 'failed', 'cancelled'].includes(String(payment.paymentStatus)))
    .reduce((sum, payment) => sum + Math.abs(numberValue(payment.amount)), 0);
  const balance = openAdditional - openRefunds;
  return (
    <section className={`${styles.detailSection} ${styles.financialSummary}`}>
      <div className={styles.sectionHeading}><div><h3>Gesamtpreisberechnung</h3><p>Aktueller finanzieller Stand der Bestellung</p></div></div>
      <div className={styles.summaryPanel}>
        <SummaryRow label="Ursprüngliche Miete inkl. MwSt." value={money(totals.originalRental)} />
        <SummaryRow label="Mietpreis-Korrektur" value={money(totals.rental - totals.originalRental)} />
        <SummaryRow label="Miete gesamt inkl. MwSt." value={money(totals.rental)} />
        <SummaryRow label="Kaution gesamt" value={money(totals.deposit)} />
        <SummaryRow label="Kaution zurück" value={money(totals.refund)} />
        <SummaryRow label="Kaution einbehalten" value={money(totals.retained)} />
        <SummaryRow label="Dokumentierte Zusatzforderungen" value={money(totals.additional)} />
        <SummaryRow label="Noch auszugleichende Nachzahlungen" value={money(openAdditional)} />
        <SummaryRow label="Noch auszuzahlende Erstattungen" value={money(openRefunds)} />
        <SummaryRow emphasis label={balance > 0 ? 'Kunde muss insgesamt nachzahlen' : balance < 0 ? 'Kunde erhält insgesamt zurück' : 'Bestellung vollständig ausgeglichen'} value={money(Math.abs(balance))} />
      </div>
    </section>
  );
}

function PaymentHistory({ payments }: { payments: AdminPayment[] }) {
  return (
    <section className={styles.detailSection}>
      <div className={styles.sectionHeading}><div><h3>Zahlungsverlauf</h3><p>{payments.length} Zahlungsvorgang{payments.length === 1 ? '' : 'e'}</p></div></div>
      {payments.length === 0 ? <div className="emptyState">Keine Zahlungsvorgänge vorhanden.</div> : (
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <thead><tr><th>Vorgang</th><th>Position</th><th>Methode</th><th>Status</th><th>Betrag</th><th>Datum</th><th>Hinweis</th></tr></thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{paymentTypeLabel(payment.paymentType)}</td>
                  <td>{payment.orderItemId ? `#${payment.orderItemId}` : 'Bestellung'}</td>
                  <td>{payment.paymentMethod === 'cash' ? 'Bar' : payment.paymentMethod === 'online' ? 'Online' : textValue(payment.paymentMethod)}</td>
                  <td><AdminStatusBadge status={payment.paymentStatus} /></td>
                  <td>{money(payment.amount)}</td>
                  <td>{dateLabel(payment.paidAt || payment.createdAt, true)}</td>
                  <td>{payment.note || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SummaryRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={emphasis ? styles.summaryTotal : styles.summaryRow}><span>{label}</span><strong>{value}</strong></div>;
}
