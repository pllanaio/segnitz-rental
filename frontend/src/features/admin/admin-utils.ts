import type { AdminOrder, AdminOrderItem, AdminPayment } from './types';

const MS_PER_DAY = 86_400_000;

export function numberValue(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function money(value: unknown): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(numberValue(value));
}

export function dateLabel(value: unknown, includeTime = false): string {
  if (!value) return '–';
  const raw = String(value);
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('de-DE', includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

function isoUtc(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function rentalDays(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 0;
  const startTime = isoUtc(start);
  const endTime = isoUtc(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;
  return Math.max(Math.floor((endTime - startTime) / MS_PER_DAY) + 1, 0);
}

export function lateDays(actual: string | null | undefined, planned: string | null | undefined): number {
  if (!actual || !planned) return 0;
  const actualTime = isoUtc(actual);
  const plannedTime = isoUtc(planned);
  if (!Number.isFinite(actualTime) || !Number.isFinite(plannedTime)) return 0;
  return Math.max(Math.ceil((actualTime - plannedTime) / MS_PER_DAY), 0);
}

export function addCalendarDay(value: string): string {
  const time = isoUtc(value);
  if (!Number.isFinite(time)) return '';
  return new Date(time + MS_PER_DAY).toISOString().slice(0, 10);
}

export function localIsoDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function assetPath(value: string | null | undefined): string {
  if (!value) return '/img/logo.png';
  if (/^(https?:|blob:|data:)/i.test(value)) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

export function safeCheckoutUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function itemStatus(item: AdminOrderItem): string {
  return String(item.itemStatus ?? item.item_status ?? 'active').toLowerCase();
}

export function deriveOrderStatus(order: AdminOrder): string {
  const items = order.items ?? [];
  if (items.length === 0) return String(order.status ?? 'unknown');

  let cancelled = 0;
  let returned = 0;
  let damaged = 0;
  for (const item of items) {
    const status = itemStatus(item);
    if (status === 'cancelled') cancelled += 1;
    if (status.startsWith('returned_')) returned += 1;
    if (status === 'returned_damaged' || status === 'returned_late_damaged') damaged += 1;
  }

  if (cancelled === items.length) return 'cancelled';
  if (cancelled + returned === items.length && returned > 0 && damaged > 0) return 'completed_with_issues';
  if (cancelled + returned === items.length && returned > 0) return 'returned';
  if (returned > 0) return 'partially_returned';
  if (cancelled > 0) return 'partially_cancelled';
  return String(order.status ?? 'active');
}

export function textValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const message = record.message ?? record.reason ?? record.text;
    return typeof message === 'string' ? message : JSON.stringify(value);
  }
  return String(value);
}

export function paymentTypeLabel(type: string | null | undefined): string {
  const labels: Record<string, string> = {
    initial_payment: 'Initialzahlung',
    rental: 'Miete',
    deposit: 'Kaution',
    rental_adjustment: 'Nachzahlung Mietzeitraum',
    return_additional_charge: 'Nachzahlung Rückgabe',
    deposit_refund: 'Kautionsrückerstattung',
    order_cancellation_refund: 'Storno-Rückerstattung',
    duplicate_payment_refund: 'Erstattung einer Doppelzahlung',
  };
  return type ? labels[type] ?? type.replaceAll('_', ' ') : '–';
}

export function depositDecisionLabel(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    pending: 'Noch offen',
    full_refund: 'Vollständige Rückzahlung',
    partial_refund: 'Teilweise Rückzahlung',
    no_refund: 'Keine Rückzahlung',
  };
  return value ? labels[value] ?? value : '–';
}

export function financials(item: AdminOrderItem) {
  const originalDays = rentalDays(item.rentalStart, item.rentalEnd);
  const effectiveStart = item.adjustedRentalStart || item.rentalStart;
  const effectiveEnd = item.adjustedRentalEnd || item.rentalEnd;
  const effectiveDays = rentalDays(effectiveStart, effectiveEnd);
  const pricePerDay = numberValue(item.adjustedPricePerDay || item.pricePerDay);
  const originalRental = originalDays * numberValue(item.pricePerDay);
  const rentalTotal = effectiveDays * pricePerDay;
  const deposit = numberValue(item.deposit);
  const daysLate = lateDays(item.actualReturnDate, item.adjustedRentalEnd || item.rentalEnd);
  const lateFee = daysLate * pricePerDay;
  const returned = itemStatus(item).startsWith('returned_') || Boolean(item.returnedAt);
  const depositRefund = returned ? numberValue(item.depositRefundAmount) : 0;
  const depositRetained = returned ? Math.max(deposit - depositRefund, 0) : 0;
  const repairCharge = numberValue(item.additionalChargeAmount);

  return {
    originalDays,
    effectiveDays,
    pricePerDay,
    originalRental,
    rentalTotal,
    rentalAdjustment: rentalTotal - originalRental,
    deposit,
    daysLate,
    lateFee,
    repairCharge,
    additionalCharge: lateFee + repairCharge,
    depositRefund,
    depositRetained,
    totalWithDeposit: rentalTotal + deposit,
  };
}

export function latestPayments(payments: AdminPayment[], types: Set<string>): AdminPayment[] {
  const byTarget = new Map<string, AdminPayment>();
  [...payments]
    .sort((a, b) => numberValue(a.id) - numberValue(b.id))
    .forEach((payment) => {
      if (!payment.paymentType || !types.has(payment.paymentType)) return;
      const key = [payment.paymentType, payment.orderItemId ?? 'order', payment.molliePaymentId ?? payment.paymentMethod ?? 'unknown'].join(':');
      byTarget.set(key, payment);
    });
  return [...byTarget.values()];
}
