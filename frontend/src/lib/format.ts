export const currencyFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
});

export function formatCurrency(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  return currencyFormatter.format(Number.isFinite(amount) ? amount : 0);
}

export function calculateRentalDays(start: string, end: string): number {
  const startDate = Date.parse(`${start}T00:00:00Z`);
  const endDate = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startDate) || !Number.isFinite(endDate) || endDate < startDate) return 0;
  return Math.round((endDate - startDate) / 86_400_000) + 1;
}

export function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '–';
  const dateOnly = value.slice(0, 10);
  const [year, month, day] = dateOnly.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('de-DE').format(new Date(Date.UTC(year, month - 1, day)));
}

export function imageSource(path: string | null | undefined): string {
  if (!path) return '/img/logo.png';
  if (path.startsWith('/')) return path;
  return `/${path}`;
}

export function safeCheckoutUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'https:' || url.origin === window.location.origin ? url.href : null;
  } catch {
    return null;
  }
}
