import type { Metadata } from 'next';
import { AdminApp } from '@/features/admin/admin-app';

export const metadata: Metadata = {
  title: 'Administration',
  description: 'Produkte, Bestellungen und Öffnungszeiten verwalten.',
  robots: { index: false, follow: false },
};

export default function BackendPage() {
  return <AdminApp />;
}
