'use client';

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { CloseIcon } from './auth-icons';
import styles from './auth.module.css';

export type FeedbackTone = 'danger' | 'info' | 'success' | 'warning';

interface FeedbackProps {
  id?: string;
  message: string;
  onDismiss?: () => void;
  tone?: FeedbackTone;
}

interface DialogProps {
  children: ReactNode;
  description?: string;
  id?: string;
  onClose: () => void;
  open: boolean;
  title: string;
}

export function Feedback({ id, message, onDismiss, tone = 'info' }: Readonly<FeedbackProps>) {
  if (!message) return null;

  const toneClass = {
    danger: styles.feedbackDanger,
    info: styles.feedbackInfo,
    success: styles.feedbackSuccess,
    warning: styles.feedbackWarning,
  }[tone];

  return (
    <div
      className={`${styles.feedback} ${toneClass}`}
      id={id}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <span>{message}</span>
      {onDismiss ? (
        <button aria-label="Hinweis schließen" className={styles.feedbackClose} onClick={onDismiss} type="button">
          <CloseIcon />
        </button>
      ) : null}
    </div>
  );
}

export function LoadingSpinner() {
  return <span aria-hidden="true" className={styles.spinner} />;
}

export function Dialog({ children, description, id, onClose, open, title }: Readonly<DialogProps>) {
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descriptionId = `${generatedId}-description`;
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      dialogRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
    focusable?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
      activeElement?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.dialog}
        id={id}
        onKeyDown={trapFocus}
        ref={dialogRef}
        role="dialog"
      >
        <header className={styles.dialogHeader}>
          <h2 id={titleId}>{title}</h2>
          <button aria-label="Dialog schließen" className={styles.dialogClose} onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <div className={styles.dialogBody}>
          {description ? <p className={styles.dialogDescription} id={descriptionId}>{description}</p> : null}
          {children}
        </div>
      </div>
    </div>
  );
}
