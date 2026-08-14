import type { Metadata } from 'next';
import { VerifyEmailPanel } from '@/features/auth/verify-email-panel';

export const metadata: Metadata = {
  title: { absolute: 'E-Mail bestätigen – Segnitz Rental' },
  referrer: 'no-referrer',
  robots: {
    follow: false,
    index: false,
  },
};

export default function VerifyEmailPage() {
  return <VerifyEmailPanel />;
}
