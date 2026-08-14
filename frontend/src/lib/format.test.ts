import { describe, expect, it } from 'vitest';
import { calculateRentalDays, formatCurrency, imageSource, localIsoDate, safeCheckoutUrl } from './format';

describe('format helpers', () => {
  it('berechnet Miettage inklusive Start- und Enddatum', () => {
    expect(calculateRentalDays('2026-08-13', '2026-08-13')).toBe(1);
    expect(calculateRentalDays('2026-08-13', '2026-08-15')).toBe(3);
    expect(calculateRentalDays('2026-08-15', '2026-08-13')).toBe(0);
  });

  it('formatiert lokale Kalenderdaten ohne UTC-Verschiebung', () => {
    expect(localIsoDate(new Date(2026, 0, 2, 23, 30))).toBe('2026-01-02');
  });

  it('normalisiert Bildpfade und Beträge', () => {
    expect(imageSource('img/products/test.jpg')).toBe('/img/products/test.jpg');
    expect(imageSource('/img/test.jpg')).toBe('/img/test.jpg');
    expect(formatCurrency('12.5')).toMatch(/12,50\s?€/);
  });

  it('erlaubt nur lokale oder HTTPS-Checkout-URLs', () => {
    expect(safeCheckoutUrl('/orders/1')).toBe(`${window.location.origin}/orders/1`);
    expect(safeCheckoutUrl('https://payments.example/checkout')).toBe('https://payments.example/checkout');
    expect(safeCheckoutUrl('http://payments.example/checkout')).toBeNull();
    expect(safeCheckoutUrl('javascript:alert(1)')).toBeNull();
  });
});

