'use client';

import { useCallback, useRef, useState } from 'react';
import type { AlertTone, AppAlert } from '@/components/ui/alert-region';

export function useAlerts() {
  const counter = useRef(0);
  const [alerts, setAlerts] = useState<AppAlert[]>([]);

  const dismiss = useCallback((id: number) => {
    setAlerts((current) => current.filter((alert) => alert.id !== id));
  }, []);

  const notify = useCallback((message: string, tone: AlertTone = 'info', duration = 6000) => {
    counter.current += 1;
    const id = counter.current;
    setAlerts((current) => [...current.slice(-3), { id, message, tone }]);
    if (duration > 0) window.setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  return { alerts, dismiss, notify };
}

