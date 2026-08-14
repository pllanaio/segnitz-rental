'use client';

import { useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { StatusBadge } from '@/components/ui/status-badge';
import { ApiError, apiJson } from '@/lib/api/client';
import { formatCurrency, formatDate } from '@/lib/format';
import type {
  CustomerOrderDetails,
  CustomerOrderItem,
  ReviewDraft,
} from './profile-types';
import { calculateItemFinancials, formatTextValue, safePrivateImagePath } from './profile-utils';
import { OrderFinancialSummary } from './order-financial-summary';
import styles from './profile.module.css';

interface OrderDetailsDialogProps {
  open: boolean;
  order?: CustomerOrderDetails;
  error?: Error;
  loading: boolean;
  notify: (message: string, tone?: 'success' | 'danger' | 'info' | 'warning') => void;
  onChanged: () => Promise<void>;
  onClose: () => void;
  onRetry: () => void;
}

function ItemMetric({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className={styles.itemMetric}>
      <span>{label}</span>
      <strong className={tone ? styles[tone] : undefined}>{value}</strong>
    </div>
  );
}

function ReturnImages({ item }: { item: CustomerOrderItem }) {
  const images = (item.returnImages ?? []).flatMap((image) => {
    const src = safePrivateImagePath(image.imagePath);
    return src ? [{ ...image, src }] : [];
  });

  if (images.length === 0) {
    return <p className={styles.noImages}>Keine Rückgabefotos zu diesem Artikel vorhanden.</p>;
  }

  return (
    <div className={styles.returnImageGrid}>
      {images.map((image, index) => (
        <a href={image.src} key={image.id} rel="noopener noreferrer" target="_blank">
          {/* Private, cookie-protected route: it must bypass the Next image pipeline. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={`Rückgabefoto ${index + 1} für ${item.title || 'Mietartikel'}`} loading="lazy" src={image.src} />
          <span><Icon name="external" size={15} /> Großansicht</span>
        </a>
      ))}
    </div>
  );
}

function OrderItemCard({ item }: { item: CustomerOrderItem }) {
  const financials = calculateItemFinancials(item);
  const effectiveStart = item.adjustedRentalStart || item.rentalStart;
  const effectiveEnd = item.adjustedRentalEnd || item.rentalEnd;

  return (
    <article className={styles.itemCard}>
      <header className={styles.itemHeader}>
        <div>
          <p>Position #{item.id}</p>
          <h4>{item.title || 'Mietartikel'}</h4>
        </div>
        <StatusBadge status={item.itemStatus || 'active'} />
      </header>

      <div className={styles.itemDates}>
        <div><span>Ursprünglicher Mietzeitraum</span><strong>{formatDate(item.rentalStart)} – {formatDate(item.rentalEnd)}</strong></div>
        {(item.adjustedRentalStart || item.adjustedRentalEnd || item.actualReturnDate) ? (
          <div><span>Aktueller Mietzeitraum</span><strong>{formatDate(effectiveStart)} – {formatDate(effectiveEnd)}</strong></div>
        ) : null}
        <div><span>Rückgabestatus</span><StatusBadge status={item.returnStatus || 'pending'} /></div>
      </div>

      {financials.extendedDays > 0 ? (
        <div className={styles.extensionNotice}>
          <Icon name="calendar" />
          <div>
            <strong>Mietzeitraum verlängert</strong>
            <span>{financials.extendedDays} zusätzliche {financials.extendedDays === 1 ? 'Tag' : 'Tage'} bis {formatDate(effectiveEnd)}</span>
          </div>
        </div>
      ) : null}

      <div className={styles.itemMetrics}>
        <ItemMetric label="Miettage" value={String(financials.effectiveDays)} />
        <ItemMetric label="Tagespreis inkl. MwSt." value={formatCurrency(financials.pricePerDay)} />
        <ItemMetric label="Miete gesamt inkl. MwSt." value={formatCurrency(financials.rentalTotal)} />
        <ItemMetric label="Kaution" value={formatCurrency(financials.deposit)} />
        <ItemMetric label="Gesamt inkl. Kaution" value={formatCurrency(financials.grossTotalWithDeposit)} />
      </div>

      {(item.actualReturnDate || item.returnedAt || item.returnNotes || item.damageDescription || item.additionalChargeReason) ? (
        <section className={styles.returnSection}>
          <h5>Rückgabeabwicklung</h5>
          <div className={styles.returnFacts}>
            {item.actualReturnDate ? <p><span>Rückgabedatum</span><strong>{formatDate(item.actualReturnDate)}</strong></p> : null}
            {item.returnCaseProcessedAt ? <p><span>Bearbeitet am</span><strong>{formatDate(item.returnCaseProcessedAt)}</strong></p> : null}
            {item.damageDescription ? <p><span>Schadensdokumentation</span><strong>{formatTextValue(item.damageDescription)}</strong></p> : null}
            {item.lateDescription ? <p><span>Verspätung</span><strong>{formatTextValue(item.lateDescription)}</strong></p> : null}
            {item.returnNotes ? <p><span>Hinweis</span><strong>{formatTextValue(item.returnNotes)}</strong></p> : null}
            {financials.additionalCharge > 0 ? (
              <p><span>Reparatur-/Zusatzkosten</span><strong className={styles.negative}>{formatCurrency(financials.additionalCharge)}</strong></p>
            ) : null}
            {financials.additionalChargeReason ? (
              <p><span>Grund der Zusatzkosten</span><strong>{formatTextValue(financials.additionalChargeReason)}</strong></p>
            ) : null}
            <p><span>Kaution zurück</span><strong className={styles.positive}>{formatCurrency(financials.depositRefund)}</strong></p>
            <p><span>Kaution einbehalten</span><strong className={styles.negative}>{formatCurrency(financials.depositRetained)}</strong></p>
          </div>
        </section>
      ) : null}

      <section className={styles.imagesSection}>
        <h5>Rückgabefotos</h5>
        <ReturnImages item={item} />
      </section>
    </article>
  );
}

function Stars({ rating }: { rating: number }) {
  const normalized = Math.max(0, Math.min(5, Number(rating || 0)));
  return <span aria-label={`${normalized} von 5 Sternen`} className={styles.stars}>{'★'.repeat(normalized)}{'☆'.repeat(5 - normalized)}</span>;
}

function ReviewCard({
  item,
  orderId,
  notify,
  onChanged,
}: {
  item: CustomerOrderItem;
  orderId: number;
  notify: OrderDetailsDialogProps['notify'];
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ReviewDraft>({ rating: '', reviewText: '' });
  const [submitting, setSubmitting] = useState(false);

  if (item.review) {
    return (
      <article className={styles.reviewCard}>
        <div className={styles.reviewHeading}>
          <div><h4>{item.title || 'Produkt'}</h4><Stars rating={item.review.rating} /></div>
          <span>Bewertet {item.review.createdAt ? `am ${formatDate(item.review.createdAt)}` : ''}</span>
        </div>
        <p>{item.review.reviewText || 'Kein Kommentar hinterlegt.'}</p>
      </article>
    );
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.rating) {
      notify('Bitte wählen Sie eine Sternebewertung aus.', 'warning');
      return;
    }
    if (!item.productId) {
      notify('Für diesen Artikel ist keine Produktreferenz verfügbar.', 'danger');
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiJson<{ message?: string }>(`/products/${item.productId}/reviews`, 'POST', {
        orderId,
        rating: Number(draft.rating),
        reviewText: draft.reviewText.trim(),
      });
      notify(result.message || 'Bewertung wurde gespeichert.', 'success');
    } catch (error) {
      notify(error instanceof ApiError || error instanceof Error ? error.message : 'Bewertung konnte nicht gespeichert werden.', 'danger');
      setSubmitting(false);
      return;
    }

    try {
      await onChanged();
    } catch {
      notify('Die Bewertung wurde gespeichert, die Ansicht konnte aber nicht aktualisiert werden.', 'warning');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.reviewCard} onSubmit={submitReview}>
      <h4>{item.title || 'Produkt'} bewerten</h4>
      <div className={styles.reviewFormGrid}>
        <label className={styles.field}>
          <span>Sterne</span>
          <select
            className={styles.select}
            id={`rating-${item.productId}`}
            onChange={(event) => setDraft((current) => ({ ...current, rating: event.target.value }))}
            required
            value={draft.rating}
          >
            <option value="">Bitte auswählen</option>
            <option value="5">5 Sterne</option><option value="4">4 Sterne</option><option value="3">3 Sterne</option>
            <option value="2">2 Sterne</option><option value="1">1 Stern</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Kommentar (optional)</span>
          <textarea
            className={styles.textarea}
            id={`reviewText-${item.productId}`}
            maxLength={2000}
            onChange={(event) => setDraft((current) => ({ ...current, reviewText: event.target.value }))}
            rows={3}
            value={draft.reviewText}
          />
          <small>{draft.reviewText.length}/2000 Zeichen · Öffentlich erscheinen Vorname und Nachnamensinitial.</small>
        </label>
      </div>
      <button className="button buttonSecondary" disabled={submitting} type="submit">
        <Icon name={submitting ? 'refresh' : 'star'} size={18} />
        {submitting ? 'Wird gespeichert …' : 'Bewertung speichern'}
      </button>
    </form>
  );
}

function uniqueReviewItems(items: CustomerOrderItem[]): CustomerOrderItem[] {
  const byProduct = new Map<number, CustomerOrderItem>();
  for (const item of items) {
    if (!item.productId) continue;
    const existing = byProduct.get(item.productId);
    if (!existing || (!existing.review && item.review)) byProduct.set(item.productId, item);
  }
  return [...byProduct.values()];
}

function OrderDetails({
  order,
  notify,
  onChanged,
}: {
  order: CustomerOrderDetails;
  notify: OrderDetailsDialogProps['notify'];
  onChanged: () => Promise<void>;
}) {
  const canReview = String(order.status || '').toLowerCase() === 'returned';
  const reviewItems = canReview ? uniqueReviewItems(order.items ?? []) : [];

  return (
    <div className={styles.orderDetails} id="myOrderDetailsBody">
      <div className={styles.orderOverview}>
        <section>
          <p className={styles.eyebrow}>Bestellung</p>
          <h3>{order.order_no || `#${order.id}`}</h3>
          <div className={styles.detailBadges}>
            <StatusBadge status={order.status} />
            <StatusBadge status={order.payment_status} />
            {order.return_case_status ? <StatusBadge status={order.return_case_status} /> : null}
          </div>
          {order.status === 'cancelled' ? (
            <div className={styles.cancellationNotice}>
              <strong>Storniert {order.cancelled_at ? `am ${formatDate(order.cancelled_at)}` : ''}</strong>
              {order.cancel_reason ? <p>{formatTextValue(order.cancel_reason)}</p> : null}
            </div>
          ) : null}
        </section>
        <section>
          <p className={styles.eyebrow}>Kundendaten</p>
          <h3>{order.customer_first_name || ''} {order.customer_last_name || ''}</h3>
          <address>
            {order.customer_company ? <>{order.customer_company}<br /></> : null}
            {order.customer_email || '–'}<br />
            {order.customer_phone || '–'}<br />
            {order.customer_address || '–'}<br />
            {order.customer_zip || ''} {order.customer_city || ''}
          </address>
        </section>
      </div>

      <section className={styles.detailsSection}>
        <div className={styles.detailsSectionHeading}>
          <div><p className={styles.eyebrow}>Mietpositionen</p><h3>Artikel & Rückgabe</h3></div>
          <span>{order.items?.length || 0} {order.items?.length === 1 ? 'Artikel' : 'Artikel'}</span>
        </div>
        <div className={styles.itemList}>
          {(order.items ?? []).length > 0
            ? order.items?.map((item) => <OrderItemCard item={item} key={item.id} />)
            : <div className="emptyState">Keine Artikel vorhanden.</div>}
        </div>
      </section>

      <OrderFinancialSummary order={order} />

      {canReview ? (
        <section className={styles.detailsSection}>
          <div className={styles.detailsSectionHeading}>
            <div><p className={styles.eyebrow}>Ihre Erfahrung</p><h3>Produkte bewerten</h3></div>
          </div>
          <div className={styles.reviewList}>
            {reviewItems.length > 0
              ? reviewItems.map((item) => (
                  <ReviewCard item={item} key={item.productId} notify={notify} onChanged={onChanged} orderId={order.id} />
                ))
              : <p className={styles.noImages}>Für diese Bestellung sind keine bewertbaren Produkte vorhanden.</p>}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function OrderDetailsDialog({
  open,
  order,
  error,
  loading,
  notify,
  onChanged,
  onClose,
  onRetry,
}: OrderDetailsDialogProps) {
  return (
    <div hidden={!open} id="myOrderDetailsModal">
      <Dialog
        footer={<button className="button buttonSecondary" onClick={onClose} type="button">Schließen</button>}
        onClose={onClose}
        open={open}
        size="large"
        title={order?.order_no ? `Bestelldetails ${order.order_no}` : 'Bestelldetails'}
      >
        {loading && !order ? (
          <div className={styles.dialogState} role="status"><span className={styles.spinner} /><strong>Bestellung wird geladen …</strong></div>
        ) : error ? (
          <div className={styles.dialogState} role="alert">
            <Icon name="info" size={28} />
            <strong>Bestellung konnte nicht geladen werden.</strong>
            <p>{error.message}</p>
            <button className="button buttonSecondary" onClick={onRetry} type="button"><Icon name="refresh" /> Erneut versuchen</button>
          </div>
        ) : order ? (
          <OrderDetails notify={notify} onChanged={onChanged} order={order} />
        ) : null}
      </Dialog>
    </div>
  );
}
