import { describe, expect, it } from 'vitest';
import {
  assetPath,
  deriveOrderStatus,
  financials,
  lateDays,
  rentalDays,
  safeCheckoutUrl,
} from './admin-utils';

describe('admin date and money helpers', () => {
  it('counts rental days inclusively without DST-dependent local dates', () => {
    expect(rentalDays('2026-03-28', '2026-03-30')).toBe(3);
    expect(rentalDays('2026-10-24', '2026-10-26')).toBe(3);
    expect(lateDays('2026-03-31', '2026-03-30')).toBe(1);
  });

  it('calculates adjusted item financials', () => {
    expect(financials({
      id: 7,
      rentalStart: '2026-08-01',
      rentalEnd: '2026-08-02',
      adjustedRentalEnd: '2026-08-04',
      pricePerDay: '20',
      deposit: '100',
      itemStatus: 'returned_late',
      actualReturnDate: '2026-08-05',
      depositRefundAmount: '70',
    })).toMatchObject({
      originalDays: 2,
      effectiveDays: 4,
      originalRental: 40,
      rentalTotal: 80,
      rentalAdjustment: 40,
      depositRefund: 70,
      depositRetained: 30,
      daysLate: 1,
      lateFee: 20,
    });
  });
});

describe('admin display safety', () => {
  it('derives aggregate states from item states', () => {
    expect(deriveOrderStatus({
      id: 4,
      status: 'picked_up',
      items: [
        { id: 1, itemStatus: 'returned_ok' },
        { id: 2, itemStatus: 'cancelled' },
      ],
    })).toBe('returned');

    expect(deriveOrderStatus({
      id: 5,
      status: 'picked_up',
      items: [
        { id: 1, itemStatus: 'returned_damaged' },
        { id: 2, itemStatus: 'returned_ok' },
      ],
    })).toBe('completed_with_issues');
  });

  it('only permits https checkout links and normalizes same-origin assets', () => {
    expect(safeCheckoutUrl('https://www.mollie.com/checkout/abc')).toBe('https://www.mollie.com/checkout/abc');
    expect(safeCheckoutUrl('javascript:alert(1)')).toBeNull();
    expect(safeCheckoutUrl('http://example.test/checkout')).toBeNull();
    expect(assetPath('img/returns/proof.jpg')).toBe('/img/returns/proof.jpg');
  });
});
