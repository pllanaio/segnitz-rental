'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/ui/icon';
import { apiJson } from '@/lib/api/client';
import { safeCheckoutUrl } from '@/lib/format';
import styles from './shop.module.css';

interface PaymentResult {
  orderNo?: string;
  order_no?: string;
  payment_status?: string;
  paymentStatus?: string;
  settled_by_offset?: boolean;
  settled_by_cash?: boolean;
  duplicate_refund_status?: string | null;
}

interface ReturnContext {
  kind: 'return' | 'extension' | 'return_charge';
  orderId: string;
  paymentType: string | null;
  itemId: string | null;
}

interface MollieCheckoutResponse {
  checkoutUrl?: string;
  alreadyPaid?: boolean;
  message?: string;
}

const successCopy = {
  return: ['Mietvorgang erfolgreich bezahlt', 'Ihre Reservierung wurde erfolgreich bezahlt.'],
  extension: ['Mietzeitraum erfolgreich verlängert', 'Die Nachzahlung für die Verlängerung wurde bestätigt.'],
  return_charge: ['Nachzahlung erfolgreich bezahlt', 'Die Nachzahlung aus der Rückgabe wurde bestätigt.'],
} as const;

function subscribeToLocation(onStoreChange: () => void) {
  window.addEventListener('popstate', onStoreChange);
  return () => window.removeEventListener('popstate', onStoreChange);
}

function getLocationSearch() {
  return window.location.search;
}

function getServerLocationSearch() {
  return '';
}

function paymentStatusPath(context: ReturnContext): string {
  const query = new URLSearchParams();
  if (context.paymentType) query.set('paymentType', context.paymentType);
  if (context.itemId) query.set('itemId', context.itemId);
  return `/orders/${context.orderId}/payment-status/sync${query.size ? `?${query}` : ''}`;
}

export function PaymentReturn({ onDone }: { onDone: () => void }) {
  const search = useSyncExternalStore(subscribeToLocation, getLocationSearch, getServerLocationSearch);
  const context = useMemo<ReturnContext | null>(() => {
    const params = new URLSearchParams(search);
    const kind = params.get('payment');
    const orderId = params.get('orderId');
    if (!orderId || !['return', 'extension', 'return_charge'].includes(kind ?? '')) return null;
    return { kind: kind as ReturnContext['kind'], orderId, paymentType: params.get('paymentType'), itemId: params.get('itemId') };
  }, [search]);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!context) return;
    apiJson<PaymentResult>(paymentStatusPath(context), 'POST')
      .then((payload) => setResult(payload))
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Der Zahlungsstatus konnte nicht geprüft werden.'))
      .finally(() => setLoading(false));
  }, [context]);

  if (!context) return null;

  const status = result?.payment_status ?? result?.paymentStatus;
  const paid = status === 'paid';
  const refundable = ['refund_pending', 'refunded', 'refund_failed'].includes(status ?? '');
  const copy = successCopy[context.kind];
  const canRetry = context.kind === 'return' && ['failed', 'expired', 'cancelled', 'canceled', 'pending'].includes(status ?? '');

  async function retry() {
    if (!context) return;
    const retryContext = context;
    setRetrying(true);
    try {
      const response = await apiJson<MollieCheckoutResponse>(`/orders/${retryContext.orderId}/mollie-checkout`, 'POST');
      const url = safeCheckoutUrl(response.checkoutUrl);
      if (url) {
        window.location.assign(url);
      } else if (response.alreadyPaid) {
        const refreshed = await apiJson<PaymentResult>(paymentStatusPath(retryContext), 'POST');
        setResult(refreshed);
        setError('');
      } else {
        setError(response.message || 'Die Zahlungsseite wird noch vorbereitet. Bitte versuchen Sie es gleich erneut.');
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Die Zahlung konnte nicht erneut gestartet werden.');
    } finally {
      setRetrying(false);
    }
  }

  function close() {
    window.history.replaceState({}, '', '/index.html');
    window.dispatchEvent(new PopStateEvent('popstate'));
    onDone();
  }

  return (
    <section aria-label="Zahlungsergebnis" className={styles.paymentReturnLayer}>
      <div className={styles.completionCard}>
        <span className={`${styles.completionIcon} ${!paid && !loading ? styles.completionError : ''}`}>
          <Icon name={loading ? 'clock' : paid ? 'check' : 'info'} size={34} />
        </span>
        <p className={styles.eyebrow}>Zahlungsstatus</p>
        <h1>{loading ? 'Zahlung wird geprüft …' : paid ? copy[0] : 'Zahlung nicht abgeschlossen'}</h1>
        {loading ? <p>Wir gleichen den aktuellen Status sicher mit dem Zahlungsanbieter ab.</p> : null}
        {paid ? <p>{result?.settled_by_offset ? 'Die Forderung wurde bereits mit der Kaution verrechnet.' : result?.settled_by_cash ? 'Die Forderung wurde bereits bar beglichen.' : copy[1]}</p> : null}
        {!loading && !paid ? <p className={styles.paymentErrorText}>{error || (refundable ? 'Für diese Bestellung ist keine weitere Zahlung erforderlich.' : 'Die Zahlung wurde noch nicht bestätigt oder abgebrochen.')}</p> : null}
        {result?.duplicate_refund_status ? <p>Eine doppelte Zahlung wird automatisch erstattet (Status: {result.duplicate_refund_status}).</p> : null}
        {(result?.orderNo || result?.order_no) ? <dl className={styles.orderFacts}><div><dt>Bestellnummer</dt><dd>{result.orderNo || result.order_no}</dd></div></dl> : null}
        <div className={styles.completionActions}>
          {canRetry ? <button className="button" disabled={retrying} onClick={retry} type="button">{retrying ? 'Wird vorbereitet …' : 'Online-Zahlung erneut starten'}</button> : null}
          <button className="button buttonSecondary" onClick={close} type="button">Zur Produktübersicht</button>
        </div>
      </div>
    </section>
  );
}
