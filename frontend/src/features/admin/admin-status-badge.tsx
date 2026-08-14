import styles from './admin.module.css';

const LABELS: Record<string, string> = {
  reserved: 'Reserviert',
  confirmed: 'Bestätigt',
  paid: 'Bezahlt',
  active: 'Aktiv',
  picked_up: 'Abgeholt',
  returned: 'Zurückgegeben',
  partially_returned: 'Teilweise zurückgegeben',
  partially_cancelled: 'Teilweise storniert',
  completed_with_issues: 'Zurückgegeben mit Klärung',
  cancelled: 'Storniert',
  expired: 'Abgelaufen',
  pending_payment: 'Zahlung ausstehend',
  payment_failed: 'Zahlung fehlgeschlagen',
  payment_dispute: 'Zahlung strittig',
  returned_ok: 'Ordnungsgemäß zurückgegeben',
  returned_late: 'Verspätet zurückgegeben',
  returned_damaged: 'Beschädigt zurückgegeben',
  returned_late_damaged: 'Verspätet und beschädigt',
  pending: 'Ausstehend',
  unpaid: 'Unbezahlt',
  open: 'Offen',
  authorized: 'Autorisiert',
  failed: 'Fehlgeschlagen',
  refunded: 'Erstattet',
  refund_pending: 'Erstattung läuft',
  refund_failed: 'Erstattung fehlgeschlagen',
  charged_back: 'Rückbelastet',
  replaced: 'Durch Barzahlung ersetzt',
  offset: 'Mit Kaution verrechnet',
  not_required: 'Nicht erforderlich',
  partial: 'Teilrückgabe offen',
  payment_pending: 'Nachzahlung offen',
  closed: 'Abgeschlossen',
};

function tone(status: string): string {
  if (['paid', 'confirmed', 'returned', 'returned_ok', 'closed'].includes(status)) return styles.adminBadgeSuccess;
  if (['cancelled', 'expired', 'failed', 'payment_failed', 'refund_failed', 'payment_dispute', 'returned_damaged', 'returned_late_damaged', 'completed_with_issues', 'charged_back'].includes(status)) return styles.adminBadgeDanger;
  if (['pending', 'unpaid', 'open', 'pending_payment', 'refund_pending', 'partially_returned', 'partially_cancelled', 'returned_late', 'partial', 'payment_pending'].includes(status)) return styles.adminBadgeWarning;
  if (['active', 'picked_up', 'reserved', 'authorized'].includes(status)) return styles.adminBadgeInfo;
  return styles.adminBadgeNeutral;
}

export function AdminStatusBadge({ status }: { status: string | null | undefined }) {
  const normalized = String(status || 'unknown').toLowerCase();
  return <span className={`${styles.adminBadge} ${tone(normalized)}`}>{adminStatusLabel(normalized)}</span>;
}

export function adminStatusLabel(status: string | null | undefined): string {
  const normalized = String(status || 'unknown').toLowerCase();
  return LABELS[normalized] ?? normalized.replaceAll('_', ' ');
}
