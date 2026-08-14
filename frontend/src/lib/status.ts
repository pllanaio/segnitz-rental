export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const statusLabels: Record<string, string> = {
  reserved: 'Reserviert',
  pending_payment: 'Zahlung ausstehend',
  payment_failed: 'Zahlung fehlgeschlagen',
  paid: 'Bezahlt',
  confirmed: 'Bestätigt',
  active: 'Aktiv',
  picked_up: 'Abgeholt',
  returned: 'Zurückgegeben',
  partially_returned: 'Teilweise zurückgegeben',
  cancelled: 'Storniert',
  partially_cancelled: 'Teilweise storniert',
  expired: 'Abgelaufen',
  payment_dispute: 'Zahlungskonflikt',
  returned_ok: 'Ordnungsgemäß zurückgegeben',
  returned_damaged: 'Beschädigt zurückgegeben',
  returned_late: 'Verspätet zurückgegeben',
  returned_late_damaged: 'Verspätet und beschädigt',
  pending: 'Ausstehend',
  failed: 'Fehlgeschlagen',
  refunded: 'Erstattet',
  refund_pending: 'Erstattung ausstehend',
  refund_failed: 'Erstattung fehlgeschlagen',
  open: 'Offen',
  closed: 'Abgeschlossen',
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Unbekannt';
  return statusLabels[status] ?? status.replaceAll('_', ' ');
}

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return 'neutral';
  if (['paid', 'confirmed', 'returned', 'returned_ok', 'closed'].includes(status)) return 'success';
  if (['cancelled', 'expired', 'failed', 'payment_failed', 'refund_failed', 'payment_dispute'].includes(status)) return 'danger';
  if (['pending', 'pending_payment', 'refund_pending', 'partially_returned', 'partially_cancelled'].includes(status)) return 'warning';
  if (['active', 'picked_up', 'reserved', 'open'].includes(status)) return 'info';
  return 'neutral';
}
