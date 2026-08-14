import { calculateRentalDays } from '@/lib/format';
import type {
  CustomerOrderItem,
  CustomerOrderSummary,
  ItemFinancials,
  OrderFilters,
  PaymentRecord,
} from './profile-types';

export const EMPTY_FILTERS: Readonly<OrderFilters> = Object.freeze({
  year: '',
  month: '',
  status: '',
  returnStatus: '',
  paymentStatus: '',
});

export const MONTHS: Readonly<Record<string, string>> = Object.freeze({
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
});

export function buildOrdersUrl(page: number, filters: OrderFilters): string {
  const params = new URLSearchParams({ page: String(page), limit: '10' });

  for (const [key, value] of Object.entries(filters)) {
    if (key === 'month' && !filters.year) continue;
    if (value) params.set(key, value);
  }

  return `/my-orders?${params.toString()}`;
}

export function deriveOrderReturnStatus(order: CustomerOrderSummary): string {
  const items = (order.items ?? []).filter((item) => {
    const itemStatus = String(item.itemStatus ?? '').toLowerCase();
    return !['cancelled', 'expired'].includes(itemStatus) && item.returnStatus !== 'not_required';
  });

  if (items.length === 0) return 'not_required';

  const statuses = new Set(items.map((item) => item.returnStatus));
  const late = statuses.has('returned_late') || statuses.has('returned_late_damaged');
  const damaged = statuses.has('returned_damaged') || statuses.has('returned_late_damaged');

  if (late && damaged) return 'returned_late_damaged';
  if (damaged) return 'returned_damaged';
  if (late) return 'returned_late';
  if (items.every((item) => item.returnStatus === 'returned_ok')) return 'returned_ok';
  return 'pending';
}

function calculateLateDays(actualReturnDate: string | null | undefined, plannedReturnDate: string | null | undefined): number {
  if (!actualReturnDate || !plannedReturnDate) return 0;
  const actual = Date.parse(`${actualReturnDate.slice(0, 10)}T00:00:00Z`);
  const planned = Date.parse(`${plannedReturnDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(actual) || !Number.isFinite(planned) || actual <= planned) return 0;
  return Math.ceil((actual - planned) / 86_400_000);
}

export function calculateItemFinancials(item: CustomerOrderItem): ItemFinancials {
  const originalStart = item.rentalStart ?? '';
  const originalEnd = item.rentalEnd ?? '';
  const originalDays = calculateRentalDays(originalStart, originalEnd);
  const effectiveStart = item.adjustedRentalStart || originalStart;
  const effectiveEnd = item.adjustedRentalEnd || originalEnd;
  const effectiveDays = calculateRentalDays(effectiveStart, effectiveEnd);
  const extendedDays = Math.max(calculateRentalDays(originalStart, effectiveEnd) - originalDays, 0);
  const pricePerDay = Number(item.adjustedPricePerDay || item.pricePerDay || 0);
  const originalPricePerDay = Number(item.pricePerDay || 0);
  const lateDays = calculateLateDays(item.actualReturnDate, effectiveEnd);
  const lateFee = lateDays * pricePerDay;
  const rentalTotal = effectiveDays * pricePerDay;
  const originalRentalTotal = originalDays * originalPricePerDay;
  const rentalAdjustment = rentalTotal - originalRentalTotal;
  const deposit = Number(item.deposit || 0);
  const isReturned = String(item.itemStatus || '').startsWith('returned_') || Boolean(item.returnedAt);
  const depositRefund = isReturned ? Number(item.depositRefundAmount || 0) : 0;
  const depositRetained = isReturned ? Math.max(deposit - depositRefund, 0) : 0;
  const repairCharge = Number(item.additionalChargeAmount || 0);
  const additionalCharge = repairCharge + lateFee;

  return {
    originalDays,
    effectiveDays,
    extendedDays,
    pricePerDay,
    rentalTotal,
    deposit,
    depositRefund,
    depositRetained,
    additionalCharge,
    grossTotalWithDeposit: rentalTotal + deposit,
    customerAdditionalDue: Math.max(additionalCharge - deposit, 0),
    customerCredit: depositRefund,
    originalRentalTotal,
    rentalAdjustment,
    lateDays,
    lateFee,
    repairCharge,
    additionalChargeReason: item.additionalChargeReason || '',
  };
}

export function sumPayments(
  payments: PaymentRecord[],
  predicate: (payment: PaymentRecord) => boolean,
  absolute = false,
): number {
  return payments.reduce((sum, payment) => {
    if (!predicate(payment)) return sum;
    const amount = Number(payment.amount || 0);
    return sum + (absolute ? Math.abs(amount) : amount);
  }, 0);
}

export function latestCancellationRefunds(payments: PaymentRecord[]): PaymentRecord[] {
  const latestByTarget = new Map<string, PaymentRecord>();
  payments
    .filter((payment) => ['order_cancellation_refund', 'duplicate_payment_refund'].includes(payment.paymentType || ''))
    .toSorted((a, b) => Number(a.id || 0) - Number(b.id || 0))
    .forEach((payment) => {
      latestByTarget.set(`${payment.refundGroupKey || payment.paymentType}:${payment.orderItemId || 'order'}`, payment);
    });
  return [...latestByTarget.values()];
}

export function safePrivateImagePath(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null;
  const normalized = path.trim().replace(/^\/+/, '');
  if (!/^img\/returns\/[A-Za-z0-9._-]+$/.test(normalized)) return null;
  return `/${normalized}`;
}

export function formatTextValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value !== 'object') return String(value);
  const record = value as { message?: unknown; reason?: unknown; text?: unknown };
  const candidate = record.message ?? record.reason ?? record.text;
  if (typeof candidate === 'string') return candidate;
  try {
    return JSON.stringify(value);
  } catch {
    return '–';
  }
}
