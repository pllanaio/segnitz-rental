'use client';

import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { AdminStatusBadge, adminStatusLabel } from './admin-status-badge';
import { apiGet, apiJson, apiRequest } from '@/lib/api/client';
import { AdminConfirmDialog, useAdminConfirm } from './admin-confirm';
import { dateLabel, deriveOrderStatus, errorMessage } from './admin-utils';
import { OrderDetails } from './order-details';
import { PaymentDialog, type PaymentSubmission } from './payment-dialog';
import { RentalPeriodDialog, type RentalAdjustmentSubmission } from './rental-period-dialog';
import { ReturnDialog, returnFileValidationError, type ReturnSubmission } from './return-dialog';
import type {
  AdminMessageResponse,
  AdminOrder,
  AdminOrderFilterOptions,
  AdminOrderItem,
  AdminOrderListResponse,
  AdminOrderPagination,
  AdminPayment,
  AdminReturnImage,
  Notify,
  PaymentAction,
} from './types';
import styles from './admin.module.css';

const EMPTY_FILTER_OPTIONS: AdminOrderFilterOptions = {
  years: [],
  months: [],
  statuses: [],
  returnStatuses: [],
  paymentStatuses: [],
};

const EMPTY_PAGINATION: AdminOrderPagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 1,
};

const MONTH_LABELS: Record<string, string> = {
  '01': 'Januar',
  '02': 'Februar',
  '03': 'März',
  '04': 'April',
  '05': 'Mai',
  '06': 'Juni',
  '07': 'Juli',
  '08': 'August',
  '09': 'September',
  '10': 'Oktober',
  '11': 'November',
  '12': 'Dezember',
};

export function OrdersView({ notify }: { notify: Notify }) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [filterOptions, setFilterOptions] = useState(EMPTY_FILTER_OPTIONS);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [status, setStatus] = useState('');
  const [returnStatus, setReturnStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [detailOrder, setDetailOrder] = useState<AdminOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [paymentAction, setPaymentAction] = useState<PaymentAction | null>(null);
  const [rentalItem, setRentalItem] = useState<AdminOrderItem | null>(null);
  const [returnItem, setReturnItem] = useState<AdminOrderItem | null>(null);
  const { confirmation, requestConfirmation, settle } = useAdminConfirm();

  const loadOrders = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '10' });
    if (deferredSearch) params.set('query', deferredSearch);
    if (year) {
      params.set('year', year);
      if (month) params.set('month', month);
    }
    if (status) params.set('status', status);
    if (returnStatus) params.set('returnStatus', returnStatus);
    if (paymentStatus) params.set('paymentStatus', paymentStatus);
    try {
      const result = await apiGet<AdminOrderListResponse>(`/admin/orders?${params.toString()}`);
      setOrders(result.items ?? []);
      setPagination(result.pagination ?? EMPTY_PAGINATION);
      setFilterOptions(result.filterOptions ?? EMPTY_FILTER_OPTIONS);
    } catch (error) {
      notify(errorMessage(error, 'Bestellungen konnten nicht geladen werden.'), 'danger');
    } finally {
      setLoading(false);
    }
  }, [deferredSearch, month, notify, page, paymentStatus, returnStatus, status, year]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadOrders(), 180);
    return () => window.clearTimeout(timeout);
  }, [loadOrders]);

  const loadOrderDetails = useCallback(async (orderId: number, showLoading = true) => {
    if (showLoading) setDetailLoading(true);
    try {
      const order = await apiGet<AdminOrder>(`/admin/orders/${orderId}`);
      setDetailOrder(order);
      return order;
    } catch (error) {
      notify(errorMessage(error, 'Bestellung konnte nicht geladen werden.'), 'danger');
      return null;
    } finally {
      if (showLoading) setDetailLoading(false);
    }
  }, [notify]);

  async function openOrder(orderId: number) {
    setDetailOrderId(orderId);
    setDetailOrder(null);
    await loadOrderDetails(orderId);
  }

  function closeOrder() {
    setDetailOrderId(null);
    setDetailOrder(null);
    setPaymentAction(null);
    setRentalItem(null);
    setReturnItem(null);
  }

  async function refresh(orderId = detailOrderId) {
    await Promise.all([
      loadOrders(),
      orderId ? loadOrderDetails(orderId, false) : Promise.resolve(null),
    ]);
  }

  async function runMutation(
    actionKey: string,
    endpoint: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body: unknown,
    fallback: string,
    orderId = detailOrderId,
  ): Promise<boolean> {
    setBusyAction(actionKey);
    try {
      const result = await apiJson<AdminMessageResponse>(endpoint, method, body);
      notify(result.message ?? fallback, 'success');
      await refresh(orderId);
      return true;
    } catch (error) {
      notify(errorMessage(error, fallback), 'danger');
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function pickupOrder() {
    if (!detailOrder) return;
    const confirmed = await requestConfirmation({
      title: 'Abholung bestätigen',
      message: 'Alle noch aktiven Positionen werden als abgeholt markiert.',
      confirmLabel: 'Als abgeholt markieren',
      danger: false,
    });
    if (confirmed) await runMutation('pickup-order', `/admin/orders/${detailOrder.id}/pick-up`, 'PUT', undefined, 'Bestellung wurde als abgeholt markiert.', detailOrder.id);
  }

  async function pickupItem(item: AdminOrderItem) {
    if (!detailOrder) return;
    const confirmed = await requestConfirmation({
      title: 'Artikel als abgeholt markieren',
      message: `Position #${item.id} wird verbindlich als abgeholt dokumentiert.`,
      confirmLabel: 'Abholung bestätigen',
      danger: false,
    });
    if (confirmed) await runMutation(`pickup-item-${item.id}`, `/admin/order-items/${item.id}/pickup`, 'PUT', undefined, 'Artikel wurde als abgeholt markiert.', detailOrder.id);
  }

  async function cancelOrder() {
    if (!detailOrder) return;
    const confirmed = await requestConfirmation({
      title: 'Bestellung vollständig stornieren',
      message: 'Alle noch aktiven Positionen werden storniert. Eventuelle Zahlungen können Erstattungsvorgänge auslösen.',
      confirmLabel: 'Bestellung stornieren',
    });
    if (confirmed) await runMutation('cancel-order', `/admin/orders/${detailOrder.id}/cancel`, 'PUT', {}, 'Bestellung wurde storniert.', detailOrder.id);
  }

  async function cancelItem(item: AdminOrderItem) {
    if (!detailOrder) return;
    const confirmed = await requestConfirmation({
      title: 'Bestellposition stornieren',
      message: `Nur Position #${item.id} wird storniert; die übrige Bestellung bleibt bestehen.`,
      confirmLabel: 'Position stornieren',
    });
    if (confirmed) await runMutation(`cancel-item-${item.id}`, `/admin/order-items/${item.id}/cancel`, 'PUT', {}, 'Artikel wurde storniert.', detailOrder.id);
  }

  async function deleteReturnImage(image: AdminReturnImage) {
    if (!detailOrder) return;
    const confirmed = await requestConfirmation({
      title: 'Rückgabefoto löschen',
      message: 'Das Rückgabefoto wird dauerhaft entfernt.',
      confirmLabel: 'Foto löschen',
    });
    if (confirmed) await runMutation(`delete-image-${image.id}`, `/admin/return-images/${image.id}`, 'DELETE', undefined, 'Rückgabefoto wurde gelöscht.', detailOrder.id);
  }

  async function retryRefund(payment: AdminPayment) {
    if (!detailOrder) return;
    const confirmed = await requestConfirmation({
      title: 'Online-Erstattung erneut versuchen',
      message: 'Die fehlgeschlagene Erstattung wird erneut bei Mollie beauftragt.',
      confirmLabel: 'Erstattung starten',
      danger: false,
    });
    if (confirmed) await runMutation(`retry-refund-${payment.id}`, `/admin/order-payments/${payment.id}/retry-refund`, 'POST', undefined, 'Erstattung wurde erneut gestartet.', detailOrder.id);
  }

  async function resendReturnSummary(item: AdminOrderItem) {
    if (!detailOrder) return;
    await runMutation(`return-mail-${item.id}`, `/admin/order-items/${item.id}/send-return-summary`, 'POST', undefined, 'Rückgabe-Abschlussmail wurde versendet.', detailOrder.id);
  }

  async function submitPayment(action: PaymentAction, submission: PaymentSubmission): Promise<boolean> {
    return runMutation(
      `${action.mode}-${action.paymentType}-${action.orderItemId ?? 'order'}`,
      action.mode === 'refund' ? '/admin/order-payments/manual-refund' : '/admin/order-payments/manual',
      'POST',
      {
        orderId: action.orderId,
        orderItemId: action.orderItemId,
        paymentType: action.paymentType,
        amount: action.amount,
        note: submission.note,
      },
      action.mode === 'refund' ? 'Rückerstattung wurde erfasst.' : 'Zahlung wurde erfasst.',
      action.orderId,
    );
  }

  async function submitRentalAdjustment(item: AdminOrderItem, submission: RentalAdjustmentSubmission): Promise<boolean> {
    if (!detailOrder) return false;
    return runMutation(`extend-${item.id}`, `/admin/order-items/${item.id}/rental-adjustment`, 'PUT', submission, 'Mietzeitraum wurde gespeichert.', detailOrder.id);
  }

  async function uploadReturnFiles(item: AdminOrderItem, files: File[]): Promise<boolean> {
    if (!detailOrder || files.length === 0) return false;
    const validationError = returnFileValidationError(files);
    if (validationError) {
      notify(validationError, 'warning');
      return false;
    }
    setBusyAction(`upload-return-${item.id}`);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('images', file));
      const result = await apiRequest<AdminMessageResponse>(`/admin/order-items/${item.id}/return-images`, { method: 'POST', body: formData });
      notify(result.message ?? 'Rückgabefotos wurden hochgeladen.', 'success');
      await refresh(detailOrder.id);
      return true;
    } catch (error) {
      notify(errorMessage(error, 'Rückgabefotos konnten nicht hochgeladen werden.'), 'danger');
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function submitReturn(item: AdminOrderItem, submission: ReturnSubmission, files: File[]): Promise<boolean> {
    if (!detailOrder) return false;
    const validationError = returnFileValidationError(files);
    if (validationError) {
      notify(validationError, 'warning');
      return false;
    }
    setBusyAction(`return-${item.id}`);
    try {
      const result = await apiJson<AdminMessageResponse>(`/admin/order-items/${item.id}/return`, 'PUT', submission);
      let partialFailure = false;

      if (files.length > 0) {
        try {
          const formData = new FormData();
          files.forEach((file) => formData.append('images', file));
          await apiRequest<AdminMessageResponse>(`/admin/order-items/${item.id}/return-images`, { method: 'POST', body: formData });
        } catch (error) {
          partialFailure = true;
          notify(errorMessage(error, 'Rückgabe gespeichert, Fotos konnten jedoch nicht hochgeladen werden.'), 'warning', 9000);
        }
      }

      try {
        await apiJson<AdminMessageResponse>(`/admin/order-items/${item.id}/send-return-summary`, 'POST');
      } catch (error) {
        partialFailure = true;
        notify(errorMessage(error, 'Rückgabe gespeichert, Abschlussmail konnte jedoch nicht versendet werden.'), 'warning', 9000);
      }

      notify(result.message ?? 'Rückgabe wurde gespeichert.', partialFailure ? 'warning' : 'success');
      await refresh(detailOrder.id);
      return true;
    } catch (error) {
      notify(errorMessage(error, 'Rückgabe konnte nicht gespeichert werden.'), 'danger');
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function updateYearFilter(value: string) {
    setYear(value);
    if (!value) setMonth('');
    setPage(1);
  }

  return (
    <section aria-labelledby="orders-heading" className={styles.view}>
      <div className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>Vermietungen</span>
          <h1 id="orders-heading">Bestellungen</h1>
          <p>Bestellungen, Zahlungen, Abholungen und Rückgaben bearbeiten.</p>
        </div>
        <button className="button buttonSecondary" disabled={loading} onClick={() => void loadOrders()} type="button"><Icon name="refresh" /> Aktualisieren</button>
      </div>

      <div className={`card ${styles.filterCard}`}>
        <label className={`${styles.searchField} ${styles.orderSearch}`}>
          <Icon name="search" />
          <span className="srOnly">Bestellung suchen</span>
          <input id="orderSearchInput" onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Bestellnummer, Kunde oder E-Mail …" type="search" value={search} />
        </label>
        <div className={styles.filterGrid}>
          <FilterSelect label="Jahr" onChange={updateYearFilter} options={filterOptions.years} value={year} />
          <FilterSelect disabled={!year} label="Monat" labelMap={MONTH_LABELS} onChange={(value) => updateFilter(setMonth, value)} options={filterOptions.months} value={month} />
          <FilterSelect formatOption={adminStatusLabel} label="Bestellstatus" onChange={(value) => updateFilter(setStatus, value)} options={filterOptions.statuses} value={status} />
          <FilterSelect formatOption={adminStatusLabel} label="Rückgabestatus" onChange={(value) => updateFilter(setReturnStatus, value)} options={filterOptions.returnStatuses} value={returnStatus} />
          <FilterSelect formatOption={adminStatusLabel} label="Zahlungsstatus" onChange={(value) => updateFilter(setPaymentStatus, value)} options={filterOptions.paymentStatuses} value={paymentStatus} />
        </div>
      </div>

      {loading ? <OrderSkeleton /> : orders.length === 0 ? <div className="emptyState">Keine Bestellungen gefunden.</div> : (
        <div className={styles.orderList} id="ordersList">
          {orders.map((order) => (
            <article className={`card ${styles.orderRow}`} key={order.id}>
              <div className={styles.orderIdentity}>
                <span className={styles.itemNumber}>{dateLabel(order.created_at, true)}</span>
                <h2>{order.order_no || `Bestellung #${order.id}`}</h2>
                <p>{[order.customer_first_name, order.customer_last_name].filter(Boolean).join(' ') || 'Unbekannter Kunde'}{order.customer_company ? ` · ${order.customer_company}` : ''}</p>
                <a href={`mailto:${order.customer_email ?? ''}`}>{order.customer_email || '–'}</a>
              </div>
              <div className={styles.orderBadges}>
                <AdminStatusBadge status={deriveOrderStatus(order)} />
                <AdminStatusBadge status={order.payment_status} />
                <AdminStatusBadge status={order.return_status} />
                {order.return_case_status ? <AdminStatusBadge status={order.return_case_status} /> : null}
              </div>
              <button className="button" onClick={() => void openOrder(order.id)} type="button">Details <Icon name="arrow-right" size={17} /></button>
            </article>
          ))}
        </div>
      )}

      <div className={styles.pagination}>
        <p>{pagination.total} Bestellung{pagination.total === 1 ? '' : 'en'} · Seite {pagination.page} von {pagination.totalPages}</p>
        <div>
          <button className="button buttonSecondary" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(current - 1, 1))} type="button"><Icon name="arrow-left" size={17} /> Zurück</button>
          <button className="button buttonSecondary" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((current) => Math.min(current + 1, pagination.totalPages))} type="button">Weiter <Icon name="arrow-right" size={17} /></button>
        </div>
      </div>

      <Dialog
        footer={<button className="button buttonSecondary" onClick={closeOrder} type="button">Schließen</button>}
        onClose={closeOrder}
        open={detailOrderId !== null}
        size="large"
        title={detailOrder ? `Bestelldetails · ${detailOrder.order_no || `#${detailOrder.id}`}` : 'Bestelldetails'}
      >
        {detailLoading || !detailOrder ? <div className={styles.detailLoading}>Bestellung wird geladen …</div> : (
          <OrderDetails
            busyAction={busyAction}
            onCancelItem={(item) => void cancelItem(item)}
            onCancelOrder={() => void cancelOrder()}
            onDeleteImage={(image) => void deleteReturnImage(image)}
            onExtend={setRentalItem}
            onOpenPayment={setPaymentAction}
            onPickupItem={(item) => void pickupItem(item)}
            onPickupOrder={() => void pickupOrder()}
            onResendSummary={(item) => void resendReturnSummary(item)}
            onRetryRefund={(payment) => void retryRefund(payment)}
            onReturn={setReturnItem}
            order={detailOrder}
          />
        )}
      </Dialog>

      <PaymentDialog action={paymentAction} onClose={() => setPaymentAction(null)} onSubmit={submitPayment} />
      <RentalPeriodDialog
        item={rentalItem}
        onClose={() => setRentalItem(null)}
        onSubmit={submitRentalAdjustment}
        orderPaymentMethod={detailOrder?.payment_method}
      />
      <ReturnDialog
        item={returnItem}
        onClose={() => setReturnItem(null)}
        onDeleteImage={deleteReturnImage}
        onSubmit={submitReturn}
        onUpload={uploadReturnFiles}
        payments={detailOrder?.payments ?? []}
      />
      <AdminConfirmDialog confirmation={confirmation} settle={settle} />
    </section>
  );
}

function FilterSelect({
  disabled = false,
  label,
  value,
  options,
  labelMap = {},
  formatOption,
  onChange,
}: {
  disabled?: boolean;
  label: string;
  value: string;
  options: Array<string | number>;
  labelMap?: Record<string, string>;
  formatOption?: (value: string) => string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span className="fieldLabel">{label}</span>
      <select className="select" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">Alle</option>
        {options.map(String).filter(Boolean).sort().map((option) => <option key={option} value={option}>{labelMap[option] ?? formatOption?.(option) ?? option.replaceAll('_', ' ')}</option>)}
      </select>
    </label>
  );
}

function OrderSkeleton() {
  return <div className={styles.orderList}>{[0, 1, 2, 3].map((key) => <div className={`card skeleton ${styles.orderSkeleton}`} key={key} />)}</div>;
}
