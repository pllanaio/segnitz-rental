import type { Metadata } from 'next';
import { LoginForm } from '@/features/auth/login-form';

export const metadata: Metadata = {
  title: { absolute: 'Segnitz Rental' },
  referrer: 'no-referrer',
};

export default function LoginPage() {
  return <LoginForm />;
}
