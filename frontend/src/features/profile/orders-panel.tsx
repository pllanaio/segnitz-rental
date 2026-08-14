'use client';

import { Icon } from '@/components/ui/icon';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate } from '@/lib/format';
import type {
  CustomerOrderListResponse,
  CustomerOrderSummary,
  OrderFilters,
} from './profile-types';
import { deriveOrderReturnStatus, MONTHS } from './profile-utils';
import styles from './profile.module.css';

interface OrdersPanelProps {
  data?: CustomerOrderListResponse;
  error?: Error;
  filters: OrderFilters;
  loading: boolean;
  page: number;
  onChangeFilters: (filters: OrderFilters) => void;
  onChangePage: (page: number) => void;
  onOpenOrder: (orderId: number) => void;
  onRetry: () => void;
}

function SelectFilter({
  id,
  label,
  value,
  values,
  valueLabels = {},
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  values: Array<string | number>;
  valueLabels?: Readonly<Record<string, string>>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.filterField}>
      <span>{label}</span>
      <select
        className={styles.select}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">Alle</option>
        {values.map((option) => {
          const normalized = String(option);
          return <option key={normalized} value={normalized}>{valueLabels[normalized] || normalized}</option>;
        })}
      </select>
    </label>
  );
}

function OrderCard({ order, onOpen }: { order: CustomerOrderSummary; onOpen: () => void }) {
  const returnStatus = deriveOrderReturnStatus(order);

  return (
    <article className={styles.orderCard}>
      <div className={styles.orderIdentity}>
        <span className={styles.orderIcon}><Icon name="package" /></span>
        <div>
          <h2>{order.order_no || `Bestellung #${order.id}`}</h2>
          <p>{order.created_at ? `Bestellt am ${formatDate(order.created_at)}` : 'Bestelldatum nicht verfügbar'}</p>
        </div>
      </div>
      <div className={styles.badgeGroup} aria-label="Bestellstatus">
        <span className={styles.badgeLabel}>Auftrag <StatusBadge status={order.status} /></span>
        <span className={styles.badgeLabel}>Zahlung <StatusBadge status={order.payment_status} /></span>
        <span className={styles.badgeLabel}>Rückgabe <StatusBadge status={returnStatus} /></span>
        {order.return_case_status && !(order.return_case_status === 'open' && order.status !== 'picked_up') ? (
          <span className={styles.badgeLabel}>Abwicklung <StatusBadge status={order.return_case_status} /></span>
        ) : null}
      </div>
      <button className="button buttonSecondary" onClick={onOpen} type="button">
        Details anzeigen <Icon name="arrow-right" size={18} />
      </button>
    </article>
  );
}

export function OrdersPanel({
  data,
  error,
  filters,
  loading,
  page,
  onChangeFilters,
  onChangePage,
  onOpenOrder,
  onRetry,
}: OrdersPanelProps) {
  const filterOptions = data?.filterOptions;
  const pagination = data?.pagination;
  const orders = data?.items ?? [];
  const totalPages = Math.max(Number(pagination?.totalPages || 1), 1);

  function updateFilter(field: keyof OrderFilters, value: string) {
    const next = { ...filters, [field]: value };
    if (field === 'year' && !value) next.month = '';
    onChangeFilters(next);
  }

  return (
    <section aria-labelledby="orders-heading" className={styles.section} id="ordersView">
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>Auftragsübersicht</p>
          <h1 id="orders-heading">Meine Bestellungen</h1>
          <p>Prüfen Sie Mietzeiträume, Zahlungen, Rückgaben und Ihre Bewertungen.</p>
        </div>
      </header>

      <div className={styles.filterPanel}>
        <div className={styles.filterHeading}>
          <Icon name="search" size={18} />
          <strong>Bestellungen filtern</strong>
        </div>
        <div className={styles.filterGrid}>
          <SelectFilter
            id="myOrderYearFilter"
            label="Jahr"
            onChange={(value) => updateFilter('year', value)}
            value={filters.year}
            values={filterOptions?.years ?? []}
          />
          <SelectFilter
            disabled={!filters.year}
            id="myOrderMonthFilter"
            label="Monat"
            onChange={(value) => updateFilter('month', value)}
            value={filters.year ? filters.month : ''}
            valueLabels={MONTHS}
            values={filterOptions?.months ?? []}
          />
          <SelectFilter
            id="myOrderStatusFilter"
            label="Auftragsstatus"
            onChange={(value) => updateFilter('status', value)}
            value={filters.status}
            values={filterOptions?.statuses ?? []}
          />
          <SelectFilter
            id="myOrderReturnStatusFilter"
            label="Rückgabestatus"
            onChange={(value) => updateFilter('returnStatus', value)}
            value={filters.returnStatus}
            values={filterOptions?.returnStatuses ?? []}
          />
          <SelectFilter
            id="myOrderPaymentStatusFilter"
            label="Zahlungsstatus"
            onChange={(value) => updateFilter('paymentStatus', value)}
            value={filters.paymentStatus}
            values={filterOptions?.paymentStatuses ?? []}
          />
        </div>
      </div>

      <div aria-busy={loading} className={styles.ordersList} id="myOrdersList">
        {loading && !data ? (
          <div className={styles.loadingPanel} role="status">
            <span className={styles.spinner} />
            <strong>Bestellungen werden geladen …</strong>
          </div>
        ) : error ? (
          <div className={styles.errorPanel} role="alert">
            <Icon name="info" />
            <div>
              <strong>Bestellungen konnten nicht geladen werden.</strong>
              <p>{error.message}</p>
            </div>
            <button className="button buttonSecondary" onClick={onRetry} type="button">
              <Icon name="refresh" /> Erneut versuchen
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="emptyState">
            <div>
              <Icon name="package" size={36} />
              <strong>Keine Bestellungen gefunden</strong>
              <p>Passen Sie die Filter an oder starten Sie eine neue Miete.</p>
              <a className="button" href="/index.html">Zum Mietshop</a>
            </div>
          </div>
        ) : (
          orders.map((order) => <OrderCard key={order.id} onOpen={() => onOpenOrder(order.id)} order={order} />)
        )}
      </div>

      {pagination && orders.length > 0 ? (
        <nav aria-label="Bestellseiten" className={styles.pagination}>
          <p>
            <strong>{pagination.total}</strong> {pagination.total === 1 ? 'Bestellung' : 'Bestellungen'} gefunden,
            {' '}Seite {page} von {totalPages}
          </p>
          <div>
            <button
              className="button buttonSecondary"
              disabled={page <= 1 || loading}
              onClick={() => onChangePage(page - 1)}
              type="button"
            >
              <Icon name="arrow-left" size={18} /> Zurück
            </button>
            <button
              className="button buttonSecondary"
              disabled={page >= totalPages || loading}
              onClick={() => onChangePage(page + 1)}
              type="button"
            >
              Weiter <Icon name="arrow-right" size={18} />
            </button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}
