'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { apiJson } from '@/lib/api/client';
import { EnvelopeCheckIcon } from './auth-icons';
import { CenteredAuthCard, LinkButton } from './auth-shell';
import { LoadingSpinner } from './auth-ui';
import { errorMessage, HEX_TOKEN_PATTERN, safeLocalRedirect } from './auth-utils';
import styles from './auth.module.css';

interface VerifyEmailResponse {
  redirectTo?: string;
}

interface VerificationCapture {
  captured: boolean;
  token: string;
}

const EMPTY_VERIFICATION_CAPTURE: VerificationCapture = Object.freeze({
  captured: false,
  token: '',
});

function captureVerificationToken(): VerificationCapture {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token') || '';
  window.history.replaceState({}, document.title, '/verify-email.html');
  return { captured: true, token };
}

let capturedVerification = EMPTY_VERIFICATION_CAPTURE;
if (typeof window !== 'undefined') {
  capturedVerification = captureVerificationToken();
}

function subscribeToVerificationUrl() {
  return () => undefined;
}

function useVerificationCapture(): VerificationCapture {
  return useSyncExternalStore(
    subscribeToVerificationUrl,
    () => capturedVerification,
    () => EMPTY_VERIFICATION_CAPTURE,
  );
}

export function VerifyEmailPanel() {
  const capture = useVerificationCapture();
  const tokenIsValid = HEX_TOKEN_PATTERN.test(capture.token);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (capture.captured) {
      window.history.replaceState({}, document.title, '/verify-email.html');
    }
  }, [capture.captured]);

  const visibleMessage = message || (
    capture.captured && !tokenIsValid
      ? 'Der Bestätigungslink ist ungültig oder unvollständig.'
      : 'Klicken Sie auf „E-Mail bestätigen“, um die Registrierung abzuschließen.'
  );

  const completeVerification = async () => {
    if (!tokenIsValid || submitting) return;

    setSubmitting(true);
    setMessage('Die E-Mail-Adresse wird bestätigt …');
    try {
      const result = await apiJson<VerifyEmailResponse>('/verify-email/complete', 'POST', {
        token: capture.token,
      });
      const redirectTo = safeLocalRedirect(result.redirectTo, '');
      if (!redirectTo) {
        throw new Error('Die Bestätigung lieferte kein gültiges Weiterleitungsziel.');
      }
      window.location.assign(redirectTo);
    } catch (error) {
      setMessage(errorMessage(error, 'Die E-Mail-Adresse konnte nicht bestätigt werden.'));
      setSubmitting(false);
    }
  };

  return (
    <CenteredAuthCard labelledBy="verificationHeading">
      <EnvelopeCheckIcon className={styles.statusIcon} />
      <h1 className={styles.cardHeading} id="verificationHeading">E-Mail-Adresse bestätigen</h1>
      <p aria-live="polite" className={styles.centeredCopy} id="verificationMessage">
        {visibleMessage}
      </p>
      <div className={styles.centeredActions}>
        <button
          className={styles.buttonPrimary}
          disabled={!tokenIsValid || submitting}
          id="completeVerification"
          onClick={completeVerification}
          type="button"
        >
          {submitting ? <LoadingSpinner /> : null}
          {submitting ? 'E-Mail wird bestätigt...' : 'E-Mail bestätigen'}
        </button>
        <LinkButton href="/index.html" variant="secondary">Zur Startseite</LinkButton>
      </div>
    </CenteredAuthCard>
  );
}
