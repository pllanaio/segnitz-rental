'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { AlertRegion } from '@/components/ui/alert-region';
import { Brand } from '@/components/ui/brand';
import { Icon } from '@/components/ui/icon';
import { useAlerts } from '@/hooks/use-alerts';
import { ApiError, apiJson } from '@/lib/api/client';
import { OrderDetailsDialog } from './order-details-dialog';
import { OrdersPanel } from './orders-panel';
import { ProfileDetails } from './profile-details';
import type {
  CustomerOrderDetails,
  CustomerOrderListResponse,
  OrderFilters,
  ProfileRecord,
  ProfileSection,
} from './profile-types';
import { buildOrdersUrl, EMPTY_FILTERS } from './profile-utils';
import styles from './profile.module.css';

function LoadingGate() {
  return (
    <main className={styles.gate}>
      <div className={styles.gateCard} role="status">
        <Brand />
        <span className={styles.spinner} />
        <div><h1>Kundenkonto wird geladen</h1><p>Ihre Sitzung und Profildaten werden geprüft.</p></div>
      </div>
    </main>
  );
}

export function ProfileApp() {
  const { alerts, dismiss, notify } = useAlerts();
  const [section, setSection] = useState<ProfileSection>('profile');
  const [filters, setFilters] = useState<OrderFilters>({ ...EMPTY_FILTERS });
  const [page, setPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const profileQuery = useSWR<ProfileRecord>('/my-profile');
  const ordersKey = profileQuery.data ? buildOrdersUrl(page, filters) : null;
  const ordersQuery = useSWR<CustomerOrderListResponse>(ordersKey, { keepPreviousData: true });
  const detailsQuery = useSWR<CustomerOrderDetails>(
    selectedOrderId ? `/my-orders/${selectedOrderId}` : null,
  );

  const unauthorized = profileQuery.error instanceof ApiError && [401, 403].includes(profileQuery.error.status);

  useEffect(() => {
    if (unauthorized) window.location.replace('/login.html');
  }, [unauthorized]);

  function changeFilters(nextFilters: OrderFilters) {
    setFilters(nextFilters);
    setPage(1);
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await apiJson('/logout', 'POST');
      window.location.replace('/index.html');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Abmeldung fehlgeschlagen.', 'danger');
      setLoggingOut(false);
    }
  }

  async function refreshOrder() {
    await Promise.all([detailsQuery.mutate(), ordersQuery.mutate()]);
  }

  if ((!profileQuery.data && !profileQuery.error) || unauthorized) return <LoadingGate />;

  if (profileQuery.error || !profileQuery.data) {
    return (
      <main className={styles.gate}>
        <AlertRegion alerts={alerts} dismiss={dismiss} />
        <div className={styles.gateCard} role="alert">
          <Brand />
          <span className={styles.gateError}><Icon name="info" size={28} /></span>
          <div>
            <h1>Profil konnte nicht geladen werden</h1>
            <p>{profileQuery.error?.message || 'Bitte versuchen Sie es erneut.'}</p>
          </div>
          <button className="button" onClick={() => void profileQuery.mutate()} type="button">
            <Icon name="refresh" /> Erneut versuchen
          </button>
          <a href="/login.html">Zur Anmeldung</a>
        </div>
      </main>
    );
  }

  const profile = profileQuery.data;

  return (
    <div className={styles.shell}>
      <AlertRegion alerts={alerts} dismiss={dismiss} />
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <Brand compact />
          <div>
            <strong>Vermietung</strong>
            <span>Kundenbereich</span>
          </div>
        </div>

        <div className={styles.accountSummary}>
          <span className={styles.avatar}>{(profile.firstName?.[0] || profile.email?.[0] || 'K').toUpperCase()}</span>
          <div><strong>{profile.firstName || 'Kunde'} {profile.lastName || ''}</strong><span>{profile.customerNo || profile.email}</span></div>
        </div>

        <nav aria-label="Kundenbereich" className={styles.nav}>
          <button
            aria-current={section === 'profile' ? 'page' : undefined}
            className={section === 'profile' ? styles.navActive : undefined}
            id="nav-profile"
            onClick={() => setSection('profile')}
            type="button"
          >
            <Icon name="user" /><span>Meine Daten</span>
          </button>
          <button
            aria-current={section === 'orders' ? 'page' : undefined}
            className={section === 'orders' ? styles.navActive : undefined}
            id="nav-orders"
            onClick={() => setSection('orders')}
            type="button"
          >
            <Icon name="package" /><span>Meine Bestellungen</span>
          </button>
        </nav>

        <div className={styles.sidebarActions}>
          <a href="/index.html"><Icon name="arrow-left" /> Mietshop öffnen</a>
          <button disabled={loggingOut} id="profileLogoutButton" onClick={() => void logout()} type="button">
            <Icon name="logout" /> {loggingOut ? 'Wird abgemeldet …' : 'Abmelden'}
          </button>
        </div>
        <p className={styles.sidebarFooter}>Segnitz Rental · Sicherer Kundenbereich</p>
      </aside>

      <main className={styles.main}>
        {section === 'profile' ? (
          <ProfileDetails
            notify={notify}
            onSaved={(updated) => void profileQuery.mutate(updated, { revalidate: false })}
            profile={profile}
          />
        ) : (
          <OrdersPanel
            data={ordersQuery.data}
            error={ordersQuery.error}
            filters={filters}
            loading={ordersQuery.isLoading || ordersQuery.isValidating}
            onChangeFilters={changeFilters}
            onChangePage={setPage}
            onOpenOrder={setSelectedOrderId}
            onRetry={() => void ordersQuery.mutate()}
            page={page}
          />
        )}
      </main>

      <OrderDetailsDialog
        error={detailsQuery.error}
        loading={detailsQuery.isLoading || detailsQuery.isValidating}
        notify={notify}
        onChanged={refreshOrder}
        onClose={() => setSelectedOrderId(null)}
        onRetry={() => void detailsQuery.mutate()}
        open={selectedOrderId !== null}
        order={detailsQuery.data}
      />
    </div>
  );
}
