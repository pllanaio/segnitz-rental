import { describe, expect, it } from 'vitest';
import {
  buildOrdersUrl,
  calculateItemFinancials,
  deriveOrderReturnStatus,
  safePrivateImagePath,
} from './profile-utils';

describe('profile order utilities', () => {
  it('serializes only active order filters', () => {
    expect(buildOrdersUrl(2, {
      year: '2026',
      month: '08',
      status: '',
      returnStatus: 'returned_ok',
      paymentStatus: '',
    })).toBe('/my-orders?page=2&limit=10&year=2026&month=08&returnStatus=returned_ok');
  });

  it('does not serialize a month without a year', () => {
    expect(buildOrdersUrl(1, {
      year: '',
      month: '08',
      status: 'confirmed',
      returnStatus: '',
      paymentStatus: '',
    })).toBe('/my-orders?page=1&limit=10&status=confirmed');
  });

  it('does not claim a deposit refund before the item was returned', () => {
    const result = calculateItemFinancials({
      id: 11,
      rentalStart: '2026-09-01',
      rentalEnd: '2026-09-02',
      pricePerDay: 49.9,
      deposit: 150,
      itemStatus: 'active',
      depositRefundAmount: 150,
    });

    expect(result.rentalTotal).toBe(99.8);
    expect(result.depositRefund).toBe(0);
    expect(result.depositRetained).toBe(0);
  });

  it('combines late and damaged returns across an order', () => {
    expect(deriveOrderReturnStatus({
      id: 1,
      items: [
        { id: 10, returnStatus: 'returned_late' },
        { id: 11, returnStatus: 'returned_damaged' },
      ],
    })).toBe('returned_late_damaged');
  });

  it('accepts only the private same-origin return image route', () => {
    expect(safePrivateImagePath('img/returns/return_item_1.jpg')).toBe('/img/returns/return_item_1.jpg');
    expect(safePrivateImagePath('/img/returns/return_item_1.webp')).toBe('/img/returns/return_item_1.webp');
    expect(safePrivateImagePath('../private.jpg')).toBeNull();
    expect(safePrivateImagePath('https://example.com/image.jpg')).toBeNull();
  });
});
