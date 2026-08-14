import type { Metadata } from 'next';
import { RegisterForm } from '@/features/auth/register-form';

export const metadata: Metadata = {
  title: { absolute: 'Segnitz Rental - Registrierung' },
  referrer: 'no-referrer',
};

export default function RegisterPage() {
  return <RegisterForm />;
}
