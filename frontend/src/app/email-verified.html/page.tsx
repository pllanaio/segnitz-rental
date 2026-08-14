import type { Metadata } from 'next';
import { CheckCircleIcon, UserLockIcon } from '@/features/auth/auth-icons';
import { CenteredAuthCard, LinkButton } from '@/features/auth/auth-shell';
import styles from '@/features/auth/auth.module.css';

export const metadata: Metadata = {
  title: { absolute: 'E-Mail bestätigt - Segnitz Rental' },
  referrer: 'no-referrer',
};

export default function EmailVerifiedPage() {
  return (
    <CenteredAuthCard labelledBy="emailVerifiedHeading">
      <CheckCircleIcon className={styles.statusIconSuccess} />
      <h1 className={styles.cardHeading} id="emailVerifiedHeading">
        E-Mail erfolgreich bestätigt
      </h1>
      <p className={styles.centeredCopy}>
        Ihre E-Mail-Adresse wurde erfolgreich bestätigt. Sie können sich jetzt mit Ihrem Kundenkonto einloggen.
      </p>
      <div className={styles.centeredActions}>
        <LinkButton href="/login.html">
          <UserLockIcon />
          Jetzt einloggen
        </LinkButton>
        <LinkButton href="/index.html" variant="secondary">Zur Startseite</LinkButton>
      </div>
    </CenteredAuthCard>
  );
}
