import type { Product, ProductDto } from './types';

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeProduct(product: ProductDto): Product {
  const imagePath = product.images?.[0]?.path ?? product.image_path ?? null;
  const categories = Array.isArray(product.categories) ? product.categories : [];

  return {
    id: finiteNumber(product.id),
    key: String(product.product_key ?? ''),
    title: String(product.title ?? 'Unbenanntes Produkt'),
    description: String(product.description ?? ''),
    pricePerDay: finiteNumber(product.price_per_day),
    deposit: finiteNumber(product.deposit),
    imagePath,
    isActive: product.is_active === undefined ? true : Boolean(product.is_active),
    rating: finiteNumber(product.average_rating),
    reviewCount: finiteNumber(product.review_count),
    images: Array.isArray(product.images) ? product.images : [],
    categories,
  };
}

export function normalizeProducts(products: ProductDto[] | undefined): Product[] {
  return Array.isArray(products) ? products.map(normalizeProduct) : [];
}
