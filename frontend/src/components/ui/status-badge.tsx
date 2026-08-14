import { statusLabel, statusTone } from '@/lib/status';
import styles from './status-badge.module.css';

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const tone = statusTone(status);
  return <span className={`${styles.badge} ${styles[tone]}`}>{statusLabel(status)}</span>;
}

