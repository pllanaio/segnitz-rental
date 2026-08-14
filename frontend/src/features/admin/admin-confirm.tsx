'use client';

import { useCallback, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';

export interface ConfirmationState {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

export function useAdminConfirm() {
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);

  const requestConfirmation = useCallback((next: ConfirmationState) => {
    resolver.current?.(false);
    setConfirmation(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setConfirmation(null);
  }, []);

  return { confirmation, requestConfirmation, settle };
}

export function AdminConfirmDialog({
  confirmation,
  settle,
}: {
  confirmation: ConfirmationState | null;
  settle: (confirmed: boolean) => void;
}) {
  return (
    <Dialog
      footer={(
        <>
          <button className="button buttonSecondary" onClick={() => settle(false)} type="button">Abbrechen</button>
          <button
            className={`button ${confirmation?.danger === false ? '' : 'buttonDanger'}`}
            onClick={() => settle(true)}
            type="button"
          >
            {confirmation?.confirmLabel ?? 'Bestätigen'}
          </button>
        </>
      )}
      onClose={() => settle(false)}
      open={Boolean(confirmation)}
      size="small"
      title={confirmation?.title ?? 'Aktion bestätigen'}
    >
      <p>{confirmation?.message}</p>
    </Dialog>
  );
}
