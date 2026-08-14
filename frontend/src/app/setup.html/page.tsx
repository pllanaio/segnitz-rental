import type { Metadata } from 'next';
import { SetupForm } from '@/features/auth/setup-form';

export const metadata: Metadata = {
  title: { absolute: 'Segnitz Rental – Ersteinrichtung' },
  referrer: 'no-referrer',
  robots: {
    follow: false,
    index: false,
  },
};

export default function SetupPage() {
  return <SetupForm />;
}
