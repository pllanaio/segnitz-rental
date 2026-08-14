import type { Metadata } from 'next';
import { ProfileApp } from '@/features/profile/profile-app';

export const metadata: Metadata = {
  title: 'Mein Bereich',
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return <ProfileApp />;
}
