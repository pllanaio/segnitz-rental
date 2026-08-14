import { describe, expect, it } from 'vitest';
import { normalizeProduct, normalizeProducts } from './adapters';

describe('product adapters', () => {
  it('normalisiert gemischte SQL-/JSON-Werte in ein stabiles UI-Modell', () => {
    const result = normalizeProduct({
      id: '42',
      product_key: 'BAG-42',
      title: 'Rüttelplatte',
      description: null,
      price_per_day: '29.90',
      deposit: '100.00',
      is_active: 1,
      average_rating: '4.6',
      review_count: '7',
      image_path: 'fallback.jpg',
      images: [{ id: 2, path: 'first.jpg' }],
      categories: [{ id: 1, name: 'Baugeräte', slug: 'baugeraete' }],
    });

    expect(result).toMatchObject({
      id: 42,
      key: 'BAG-42',
      description: '',
      pricePerDay: 29.9,
      deposit: 100,
      imagePath: 'first.jpg',
      isActive: true,
      rating: 4.6,
      reviewCount: 7,
    });
  });

  it('behandelt fehlende Listen defensiv', () => {
    expect(normalizeProducts(undefined)).toEqual([]);
  });
});

