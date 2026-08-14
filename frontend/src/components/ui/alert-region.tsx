'use client';

import { Icon } from './icon';
import styles from './alert-region.module.css';

export type AlertTone = 'success' | 'danger' | 'info' | 'warning';

export interface AppAlert {
  id: number;
  message: string;
  tone: AlertTone;
}

export function AlertRegion({ alerts, dismiss }: { alerts: AppAlert[]; dismiss: (id: number) => void }) {
  return (
    <div aria-atomic="true" aria-live="polite" className={styles.region} id="globalAlertContainer">
      {alerts.map((alert) => (
        <div className={`${styles.alert} ${styles[alert.tone]}`} key={alert.id} role="status">
          <Icon name={alert.tone === 'success' ? 'check' : 'info'} />
          <span>{alert.message}</span>
          <button aria-label="Hinweis schließen" onClick={() => dismiss(alert.id)} type="button">
            <Icon name="close" size={17} />
          </button>
        </div>
      ))}
    </div>
  );
}

