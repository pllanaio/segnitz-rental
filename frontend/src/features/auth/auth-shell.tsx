import Image from 'next/image';
import type { ReactNode } from 'react';
import styles from './auth.module.css';

interface AuthShellProps {
  children: ReactNode;
  navigation: ReactNode;
  width?: 'narrow' | 'wide';
}

interface LinkButtonProps {
  children: ReactNode;
  href: string;
  variant?: 'accent' | 'outline' | 'secondary';
}

interface CenteredAuthCardProps {
  children: ReactNode;
  labelledBy: string;
}

export function BrandLogo({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <Image
      alt="Segnitz Rental"
      className={compact ? styles.logoCompact : styles.logo}
      height={85}
      priority
      src="/img/logo.png"
      width={255}
    />
  );
}

export function LinkButton({ children, href, variant = 'accent' }: Readonly<LinkButtonProps>) {
  const variantClass = variant === 'outline'
    ? styles.linkButtonOutline
    : variant === 'secondary'
      ? styles.linkButtonSecondary
      : styles.linkButtonAccent;

  return (
    <a className={`${styles.linkButton} ${variantClass}`} href={href}>
      {children}
    </a>
  );
}

export function AuthShell({ children, navigation, width = 'narrow' }: Readonly<AuthShellProps>) {
  return (
    <div className={styles.authPage}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <BrandLogo />
          <p className={styles.brandTitle}>Vermietung</p>
        </div>
        <nav aria-label="Seitennavigation" className={styles.sidebarNavigation}>
          {navigation}
        </nav>
      </aside>
      <main className={styles.main}>
        <div className={styles.formSurface}>
          <div className={width === 'wide' ? styles.contentWide : styles.contentNarrow}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

export function CenteredAuthCard({ children, labelledBy }: Readonly<CenteredAuthCardProps>) {
  return (
    <main className={styles.centeredPage}>
      <section aria-labelledby={labelledBy} className={styles.centeredCard}>
        {children}
      </section>
    </main>
  );
}
