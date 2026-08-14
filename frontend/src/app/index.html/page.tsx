import type { Metadata } from 'next';
import { ShopApp } from '@/features/shop/shop-app';

export const metadata: Metadata = {
  title: 'Werkzeuge mieten',
};

export default function ShopPage() {
  return <ShopApp />;
}
