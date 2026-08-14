'use client';

import Image from 'next/image';
import { useMemo, useState, useSyncExternalStore } from 'react';
import useSWR from 'swr';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { apiJson } from '@/lib/api/client';
import type { Product } from '@/lib/api/types';
import { calculateRentalDays, formatCurrency, formatDate, imageSource, localIsoDate } from '@/lib/format';
import styles from './shop.module.css';

interface BlockedPeriod {
  rentalStart: string;
  rentalEnd: string;
}

interface ProductReview {
  rating: number | string;
  reviewText?: string | null;
  createdAt?: string;
  displayName?: string;
}

function rangesOverlap(start: string, end: string, blocked: BlockedPeriod): boolean {
  return start <= blocked.rentalEnd && end >= blocked.rentalStart;
}

function subscribeToCalendarDay(onStoreChange: () => void) {
  const timer = window.setInterval(onStoreChange, 60_000);
  return () => window.clearInterval(timer);
}

function useLocalCalendarDay() {
  return useSyncExternalStore(subscribeToCalendarDay, () => localIsoDate(), () => '');
}

export function ProductDialog({ product, onClose, onAdded }: {
  product: Product | null;
  onClose: () => void;
  onAdded: (message: string) => Promise<void> | void;
}) {
  const today = useLocalCalendarDay();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [activeImage, setActiveImage] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showAllReviews, setShowAllReviews] = useState(false);
  const { data: periods = [], isLoading: availabilityLoading } = useSWR<BlockedPeriod[]>(
    product ? `/products/${product.id}/availability` : null,
  );
  const { data: reviews = [], isLoading: reviewsLoading } = useSWR<ProductReview[]>(
    product ? `/products/${product.id}/reviews` : null,
  );

  const images = useMemo(() => {
    if (!product) return [];
    const all = product.images.map((image) => image.path).filter(Boolean);
    if (product.imagePath && !all.includes(product.imagePath)) all.unshift(product.imagePath);
    return all.length ? all : [null];
  }, [product]);

  const effectiveStart = start || today;
  const effectiveEnd = end || effectiveStart;
  const overlap = Boolean(effectiveStart && effectiveEnd && periods.some((period) => rangesOverlap(effectiveStart, effectiveEnd, period)));
  const days = calculateRentalDays(effectiveStart, effectiveEnd);

  async function addToCart() {
    if (!product) return;
    setError('');
    if (!effectiveStart || !effectiveEnd || effectiveEnd < effectiveStart) {
      setError('Bitte wählen Sie einen gültigen Mietzeitraum.');
      return;
    }
    if (overlap) {
      setError('Das Produkt ist in diesem Zeitraum bereits vermietet.');
      return;
    }

    setSubmitting(true);
    try {
      await apiJson('/cart/items', 'POST', { productId: product.id, rentalStart: effectiveStart, rentalEnd: effectiveEnd });
      await onAdded(`${product.title} wurde zum Warenkorb hinzugefügt.`);
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Das Produkt konnte nicht hinzugefügt werden.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      description="Zeitraum wählen und Verfügbarkeit direkt prüfen."
      footer={(
        <>
          <button className="button buttonSecondary" onClick={onClose} type="button">Abbrechen</button>
          <button className="button" disabled={submitting || availabilityLoading || overlap} onClick={addToCart} type="button">
            <Icon name="cart" size={18} /> {submitting ? 'Wird hinzugefügt …' : 'In den Warenkorb'}
          </button>
        </>
      )}
      onClose={onClose}
      open={Boolean(product)}
      size="large"
      title={product?.title ?? 'Produkt'}
    >
      {product ? (
        <div className={styles.productDialogGrid}>
          <div>
            <div className={styles.dialogImageFrame}>
              <Image
                alt={product.title}
                className={styles.dialogImage}
                height={640}
                src={imageSource(images[activeImage])}
                unoptimized
                width={800}
              />
            </div>
            {images.length > 1 ? (
              <div aria-label="Produktbilder" className={styles.thumbnailList}>
                {images.map((path, index) => (
                  <button
                    aria-label={`Bild ${index + 1} anzeigen`}
                    aria-pressed={activeImage === index}
                    className={activeImage === index ? styles.thumbnailActive : ''}
                    key={`${path}-${index}`}
                    onClick={() => setActiveImage(index)}
                    type="button"
                  >
                    <Image alt="" height={80} src={imageSource(path)} unoptimized width={100} />
                  </button>
                ))}
              </div>
            ) : null}
            <div className={styles.productDescription}>
              <h3>Über diesen Mietartikel</h3>
              <p>{product.description || 'Für diesen Artikel liegt noch keine ausführliche Beschreibung vor.'}</p>
            </div>
          </div>

          <div className={styles.rentalPanel}>
            <div className={styles.priceBlock}>
              <strong>{formatCurrency(product.pricePerDay)}</strong><span> pro Miettag</span>
              <small>zzgl. {formatCurrency(product.deposit)} Kaution</small>
            </div>
            <div className={styles.dateGrid}>
              <div className="field">
                <label htmlFor="rental-start">Mietbeginn</label>
                <input className="input" id="rental-start" min={today} onChange={(event) => {
                  setStart(event.target.value);
                  if (effectiveEnd < event.target.value) setEnd(event.target.value);
                }} type="date" value={effectiveStart} />
              </div>
              <div className="field">
                <label htmlFor="rental-end">Mietende</label>
                <input className="input" id="rental-end" min={effectiveStart || today} onChange={(event) => setEnd(event.target.value)} type="date" value={effectiveEnd} />
              </div>
            </div>
            <div className={`${styles.availability} ${overlap ? styles.unavailable : styles.available}`}>
              <Icon name={overlap ? 'info' : 'check'} size={18} />
              {availabilityLoading
                ? 'Verfügbarkeit wird geprüft …'
                : overlap
                  ? 'Im gewählten Zeitraum nicht verfügbar.'
                  : `${days || 0} ${days === 1 ? 'Miettag' : 'Miettage'} verfügbar.`}
            </div>
            {periods.length ? (
              <details className={styles.blockedPeriods}>
                <summary>Nicht verfügbare Zeiträume ({periods.length})</summary>
                <ul>
                  {periods.slice(0, 8).map((period) => <li key={`${period.rentalStart}-${period.rentalEnd}`}>{formatDate(period.rentalStart)} – {formatDate(period.rentalEnd)}</li>)}
                </ul>
              </details>
            ) : null}
            <div className={styles.estimate}>
              <span>Voraussichtliche Mietkosten</span>
              <strong>{formatCurrency(product.pricePerDay * days)}</strong>
              <small>Kaution separat: {formatCurrency(product.deposit)}</small>
            </div>
            {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}

            <section className={styles.reviews} aria-labelledby="reviews-heading">
              <div className={styles.reviewsHeading}>
                <h3 id="reviews-heading">Bewertungen</h3>
                {reviews.length ? <span>{reviews.length}</span> : null}
              </div>
              {reviewsLoading ? <p className="muted">Bewertungen werden geladen …</p> : null}
              {!reviewsLoading && !reviews.length ? <p className="muted">Noch keine Bewertungen vorhanden.</p> : null}
              {(showAllReviews ? reviews : reviews.slice(0, 3)).map((review, index) => (
                <article className={styles.review} key={`${review.createdAt}-${index}`}>
                  <div><span className={styles.stars}>{'★'.repeat(Number(review.rating) || 0)}{'☆'.repeat(5 - (Number(review.rating) || 0))}</span><strong>{review.displayName || 'Kunde'}</strong></div>
                  {review.reviewText ? <p>{review.reviewText}</p> : null}
                  <small>{formatDate(review.createdAt)}</small>
                </article>
              ))}
              {reviews.length > 3 ? <button className="button buttonGhost" onClick={() => setShowAllReviews((value) => !value)} type="button">{showAllReviews ? 'Weniger anzeigen' : 'Alle anzeigen'}</button> : null}
            </section>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
