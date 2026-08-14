'use client';

import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { apiGet } from '@/lib/api/client';

export function AppProviders({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SWRConfig
      value={{
        fetcher: apiGet,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 2_000,
        shouldRetryOnError: false,
      }}
    >
      {children}
    </SWRConfig>
  );
}
