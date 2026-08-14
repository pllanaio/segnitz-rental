import Image from 'next/image';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a aria-label="Segnitz Rental – Startseite" href="/index.html" style={{ color: 'inherit', textDecoration: 'none' }}>
      <Image
        alt="Segnitz Rental"
        height={compact ? 52 : 85}
        priority
        src="/img/logo.png"
        style={{ height: compact ? 52 : 'auto', objectFit: 'contain', width: compact ? 156 : 210 }}
        width={compact ? 156 : 255}
      />
    </a>
  );
}

