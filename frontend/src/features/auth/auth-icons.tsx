import type { SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

const sharedProps = {
  'aria-hidden': true,
  focusable: false,
  fill: 'none',
  viewBox: '0 0 24 24',
  xmlns: 'http://www.w3.org/2000/svg',
} as const;

export function ArrowLeftCircleIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="m12.5 8-4 4 4 4M8.7 12H16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <circle cx="12" cy="12" r="9" fill="currentColor" />
      <path d="m7.8 12.2 2.7 2.7 5.8-6" stroke="white" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

export function EnvelopeCheckIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="M4.5 6.5h15v11h-15z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="m5 7 7 5 7-5M14.7 15.1l1.4 1.4 2.8-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

export function PersonPlusIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.8 18.5c.5-3 2.4-4.7 5.2-4.7 2.2 0 3.8 1 4.7 2.8M17.5 9.5v6M14.5 12.5h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

export function ShieldLockIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="M12 3.2 19 6v5.1c0 4.3-2.7 7.8-7 9.7-4.3-1.9-7-5.4-7-9.7V6l7-2.8Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.6" width="6" x="9" y="11" />
      <path d="M10.5 11V9.8a1.5 1.5 0 0 1 3 0V11" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

export function UserCheckIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.8 18.5c.5-3 2.4-4.7 5.2-4.7 1.5 0 2.7.4 3.6 1.2M15 15.5l1.7 1.7 3.5-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

export function UserLockIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.8 18.5c.5-3 2.4-4.7 5.2-4.7 1.2 0 2.3.3 3.1.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <rect height="5.5" rx="1" stroke="currentColor" strokeWidth="1.6" width="6" x="14" y="13.5" />
      <path d="M15.5 13.5v-1a1.5 1.5 0 0 1 3 0v1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}
