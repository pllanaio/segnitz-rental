'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './icon';
import styles from './dialog.module.css';

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  size?: 'small' | 'medium' | 'large';
}

export function Dialog({ open, title, description, children, footer, onClose, size = 'medium' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      previousFocus.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[autofocus], input:not([disabled]), button:not([disabled]), a[href]')
        ?.focus();
    }
    if (!open && dialog.open) {
      dialog.close();
      previousFocus.current?.focus();
      previousFocus.current = null;
    }

    return () => {
      if (dialog.open) dialog.close();
      previousFocus.current?.focus();
      previousFocus.current = null;
    };
  }, [open]);

  return (
    <dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className={`${styles.dialog} ${styles[size]}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      ref={ref}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button aria-label="Dialog schließen" className="iconButton" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </dialog>
  );
}
