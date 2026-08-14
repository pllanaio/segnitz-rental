import { describe, expect, it } from 'vitest';
import type { CartItem } from '@/lib/api/types';
import { calculateCartTotals } from './cart-view';

const items: CartItem[] = [
  {
    id: 1,
    productId: 11,
    rentalStart: '2026-08-13',
    rentalEnd: '2026-08-15',
    quantity: 1,
    productKey: 'A',
    title: 'Artikel A',
    description: '',
    pricePerDay: '11.90',
    deposit: '50.00',
    imagePath: null,
  },
  {
    id: 2,
    productId: 12,
    rentalStart: '2026-08-13',
    rentalEnd: '2026-08-13',
    quantity: 1,
    productKey: 'B',
    title: 'Artikel B',
    description: '',
    pricePerDay: 23.8,
    deposit: 100,
    imagePath: null,
  },
];

describe('cart totals', () => {
  it('trennt Netto, Umsatzsteuer, Mietpreis und Kaution', () => {
    const totals = calculateCartTotals(items);
    expect(totals.rentalGross).toBeCloseTo(59.5);
    expect(totals.rentalNet).toBeCloseTo(50);
    expect(totals.vat).toBeCloseTo(9.5);
    expect(totals.deposit).toBe(150);
    expect(totals.grandTotal).toBeCloseTo(209.5);
  });
});

