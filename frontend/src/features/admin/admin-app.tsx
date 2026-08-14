'use client';

import { useEffect, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { AlertRegion } from '@/components/ui/alert-region';
import { Brand } from '@/components/ui/brand';
import { Icon } from '@/components/ui/icon';
import { useAlerts } from '@/hooks/use-alerts';
import { apiGet, apiJson, setCsrfToken } from '@/lib/api/client';
import { errorMessage } from './admin-utils';
import { OpeningHoursView } from './opening-hours-view';
import { OrdersView } from './orders-view';
import { ProductsView } from './products-view';
import type { AdminView, AuthStatus } from './types';
import styles from './admin.module.css';

const NAVIGATION: Array<{ view: AdminView; label: string; icon: 'package' | 'cart' | 'clock' }> = [
  { view: 'products', label: 'Produkte', icon: 'package' },
  { view: 'orders', label: 'Bestellungen', icon: 'cart' },
  { view: 'opening-hours', label: 'Öffnungszeiten', icon: 'clock' },
];

export function AdminApp() {
  const [view, setView] = useState<AdminView>('products');
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const { alerts, dismiss, notify } = useAlerts();
  const { data: auth, error, isLoading, mutate } = useSWR<AuthStatus>('/auth-status', apiGet, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });

  useEffect(() => {
    if (auth?.csrfToken) setCsrfToken(auth.csrfToken);
    if (!auth) return;
    if (!auth.loggedIn) {
      window.location.replace('/login.html?reason=session_expired');
      return;
    }
    if (auth.role !== 'global_admin') window.location.replace('/index.html');
  }, [auth]);

  async function logout() {
    setLoggingOut(true);
    try {
      await apiJson<string>('/logout', 'POST');
      setCsrfToken(null);
      window.location.replace('/index.html');
    } catch (logoutError) {
      notify(errorMessage(logoutError, 'Abmelden ist fehlgeschlagen.'), 'danger');
      setLoggingOut(false);
    }
  }

  if (isLoading || (auth && (!auth.loggedIn || auth.role !== 'global_admin'))) {
    return <AdminGate message="Admin-Bereich wird geöffnet …" />;
  }

  if (error || !auth) {
    return (
      <AdminGate
        action={<button className="button" onClick={() => void mutate()} type="button"><Icon name="refresh" /> Erneut versuchen</button>}
        message="Die Admin-Sitzung konnte nicht geprüft werden."
      />
    );
  }

  return (
    <div className={styles.adminShell}>
      <AlertRegion alerts={alerts} dismiss={dismiss} />
      <header className={styles.mobileHeader}>
        <Brand compact />
        <button aria-expanded={menuOpen} aria-label="Admin-Navigation öffnen" className="iconButton" onClick={() => setMenuOpen((current) => !current)} type="button"><Icon name={menuOpen ? 'close' : 'menu'} /></button>
      </header>

      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarBrand}>
          <Brand compact />
          <span>Administration</span>
        </div>
        <div className={styles.userCard}>
          <span className={styles.avatar}><Icon name="user" /></span>
          <div><span>Angemeldet als</span><strong>{auth.user}</strong></div>
        </div>
        <nav aria-label="Admin-Bereiche" className={styles.sidebarNav}>
          {NAVIGATION.map((item) => (
            <button
              aria-current={view === item.view ? 'page' : undefined}
              className={view === item.view ? styles.navActive : ''}
              id={`nav-${item.view}`}
              key={item.view}
              onClick={() => { setView(item.view); setMenuOpen(false); }}
              type="button"
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <a className="button buttonSecondary" href="/index.html"><Icon name="arrow-left" /> Zum Shop</a>
          <button className="button buttonDanger" disabled={loggingOut} id="backendLogoutButton" onClick={() => void logout()} type="button"><Icon name="logout" /> {loggingOut ? 'Wird abgemeldet …' : 'Abmelden'}</button>
        </div>
      </aside>

      {menuOpen ? <button aria-label="Navigation schließen" className={styles.mobileBackdrop} onClick={() => setMenuOpen(false)} type="button" /> : null}

      <main className={styles.mainContent}>
        {view === 'products' ? <ProductsView notify={notify} /> : null}
        {view === 'orders' ? <OrdersView notify={notify} /> : null}
        {view === 'opening-hours' ? <OpeningHoursView notify={notify} /> : null}
      </main>
    </div>
  );
}

function AdminGate({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <main className={styles.gate}>
      <Brand />
      <div className={`card ${styles.gateCard}`}>
        <span className={styles.gateIcon}><Icon name="lock" size={28} /></span>
        <h1>Administration</h1>
        <p>{message}</p>
        {action}
      </div>
    </main>
  );
}
