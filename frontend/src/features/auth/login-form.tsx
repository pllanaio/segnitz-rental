'use client';

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { apiJson } from '@/lib/api/client';
import { AuthFormField } from './auth-form-field';
import { ArrowLeftCircleIcon } from './auth-icons';
import { AuthShell, LinkButton } from './auth-shell';
import { Dialog, Feedback, LoadingSpinner, type FeedbackTone } from './auth-ui';
import { errorMessage, isCustomerPasswordValid, safeLocalRedirect } from './auth-utils';
import styles from './auth.module.css';

interface LoginResponse {
  csrfToken?: string;
  message?: string;
  redirectTo?: string;
}

interface LoginUrlCapture {
  resetToken: string;
}

type DialogMode = 'request' | 'reset';

const EMPTY_LOGIN_CAPTURE: LoginUrlCapture = Object.freeze({ resetToken: '' });

function captureLoginToken(): LoginUrlCapture {
  const queryParams = new URLSearchParams(window.location.search);
  const fragmentParams = new URLSearchParams(window.location.hash.slice(1));
  const resetToken = fragmentParams.get('resetToken') || queryParams.get('resetToken') || '';

  if (resetToken) {
    window.history.replaceState({}, document.title, '/login.html');
  }

  return resetToken ? { resetToken } : EMPTY_LOGIN_CAPTURE;
}

let capturedLoginUrl = EMPTY_LOGIN_CAPTURE;
if (typeof window !== 'undefined') {
  capturedLoginUrl = captureLoginToken();
}

function subscribeToLoginUrl() {
  return () => undefined;
}

function useCapturedLoginUrl(): LoginUrlCapture {
  return useSyncExternalStore(
    subscribeToLoginUrl,
    () => capturedLoginUrl,
    () => EMPTY_LOGIN_CAPTURE,
  );
}

export function LoginForm() {
  const urlCapture = useCapturedLoginUrl();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [dialogMode, setDialogMode] = useState<DialogMode>('request');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [capturedDialogDismissed, setCapturedDialogDismissed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; tone: FeedbackTone }>({
    message: '',
    tone: 'info',
  });

  const capturedResetOpen = Boolean(urlCapture.resetToken) && !capturedDialogDismissed;
  const activeDialogMode: DialogMode = capturedResetOpen ? 'reset' : dialogMode;
  const isDialogOpen = capturedResetOpen || dialogOpen;

  useEffect(() => {
    if (urlCapture.resetToken) {
      window.history.replaceState({}, document.title, '/login.html');
    }
  }, [urlCapture.resetToken]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setCapturedDialogDismissed(true);
  }, []);

  const showFeedback = (message: string, tone: FeedbackTone) => {
    setFeedback({ message, tone });
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      showFeedback('Benutzername und Passwort sind erforderlich.', 'warning');
      const field = event.currentTarget.elements.namedItem(
        normalizedUsername ? 'password' : 'username',
      );
      if (field instanceof HTMLElement) field.focus();
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiJson<LoginResponse>('/login', 'POST', {
        username: normalizedUsername,
        password,
      });
      window.location.assign(safeLocalRedirect(result.redirectTo, '/index.html'));
    } catch (error) {
      showFeedback(errorMessage(error, 'Login fehlgeschlagen.'), 'danger');
      setSubmitting(false);
    }
  };

  const openResetRequest = () => {
    setCapturedDialogDismissed(true);
    setDialogMode('request');
    setDialogOpen(true);
  };

  const handleResetRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resetSubmitting) return;

    const email = resetEmail.trim();
    if (!email) {
      showFeedback('Bitte geben Sie Ihre E-Mail-Adresse ein.', 'warning');
      const field = event.currentTarget.elements.namedItem('resetEmail');
      if (field instanceof HTMLElement) field.focus();
      return;
    }

    setResetSubmitting(true);
    try {
      const message = await apiJson<string>('/password-reset-request', 'POST', { email });
      showFeedback(message || 'Wenn die E-Mail existiert, wurde ein Link versendet.', 'success');
      closeDialog();
      setResetEmail('');
    } catch (error) {
      showFeedback(errorMessage(error, 'Reset-Link konnte nicht angefordert werden.'), 'danger');
    } finally {
      setResetSubmitting(false);
    }
  };

  const handlePasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resetSubmitting) return;

    if (!resetPassword || !resetPasswordConfirm) {
      showFeedback('Bitte beide Passwortfelder ausfüllen.', 'warning');
      const field = event.currentTarget.elements.namedItem(
        resetPassword ? 'resetNewPasswordConfirm' : 'resetNewPassword',
      );
      if (field instanceof HTMLElement) field.focus();
      return;
    }

    if (resetPassword !== resetPasswordConfirm) {
      showFeedback('Die Passwörter stimmen nicht überein.', 'warning');
      const field = event.currentTarget.elements.namedItem('resetNewPasswordConfirm');
      if (field instanceof HTMLElement) field.focus();
      return;
    }

    if (!isCustomerPasswordValid(resetPassword)) {
      showFeedback(
        'Das Passwort muss 8 bis 72 Bytes, eine Zahl und ein Sonderzeichen enthalten.',
        'warning',
      );
      const field = event.currentTarget.elements.namedItem('resetNewPassword');
      if (field instanceof HTMLElement) field.focus();
      return;
    }

    setResetSubmitting(true);
    try {
      await apiJson<string>('/password-reset', 'POST', {
        token: urlCapture.resetToken,
        password: resetPassword,
      });
      showFeedback(
        'Passwort wurde erfolgreich geändert. Sie können sich jetzt einloggen.',
        'success',
      );
      setResetPassword('');
      setResetPasswordConfirm('');
      closeDialog();
      window.history.replaceState({}, document.title, '/login.html');
    } catch (error) {
      showFeedback(errorMessage(error, 'Passwort konnte nicht zurückgesetzt werden.'), 'danger');
    } finally {
      setResetSubmitting(false);
    }
  };

  return (
    <>
      <div className={styles.feedbackStack} id="globalAlertContainer">
        <Feedback
          message={feedback.message}
          onDismiss={() => setFeedback((current) => ({ ...current, message: '' }))}
          tone={feedback.tone}
        />
      </div>

      <AuthShell
        navigation={(
          <LinkButton href="/index.html">
            <ArrowLeftCircleIcon />
            Zurück zur Startseite
          </LinkButton>
        )}
      >
        <div id="steps-container">
          <div id="login">
            <h1 className={styles.pageHeading}>Einloggen</h1>
            <form
              aria-busy={submitting}
              className={styles.form}
              id="loginForm"
              method="post"
              name="loginForm"
              noValidate
              onSubmit={handleLogin}
            >
              <AuthFormField
                autoComplete="username"
                data-autofocus
                id="username"
                label="Benutzername"
                maxLength={254}
                onChange={(event) => setUsername(event.currentTarget.value)}
                placeholder="Benutzername eingeben"
                required
                type="email"
                value={username}
              />
              <AuthFormField
                autoComplete="current-password"
                id="password"
                label="Passwort"
                maxLength={128}
                onChange={(event) => setPassword(event.currentTarget.value)}
                placeholder="Passwort eingeben"
                required
                type="password"
                value={password}
              />
              <button className={styles.buttonPrimary} disabled={submitting} type="submit">
                {submitting ? <LoadingSpinner /> : null}
                {submitting ? 'Anmeldung läuft...' : 'Einloggen'}
              </button>
            </form>
            <p className={styles.textLinkRow}>
              <button
                className={styles.textLink}
                id="forgotPasswordLink"
                onClick={openResetRequest}
                type="button"
              >
                Passwort vergessen?
              </button>
            </p>
          </div>
        </div>
      </AuthShell>

      <Dialog
        id="passwordResetModal"
        onClose={closeDialog}
        open={isDialogOpen}
        title="Passwort zurücksetzen"
      >
        {activeDialogMode === 'request' ? (
          <form
            aria-busy={resetSubmitting}
            className={styles.form}
            id="passwordResetRequestForm"
            noValidate
            onSubmit={handleResetRequest}
          >
            <AuthFormField
              autoComplete="email"
              data-autofocus
              id="resetEmail"
              label="E-Mail-Adresse"
              maxLength={254}
              onChange={(event) => setResetEmail(event.currentTarget.value)}
              required
              type="email"
              value={resetEmail}
            />
            <button className={styles.buttonPrimary} disabled={resetSubmitting} type="submit">
              {resetSubmitting ? <LoadingSpinner /> : null}
              {resetSubmitting ? 'Anfrage läuft...' : 'Reset-Link anfordern'}
            </button>
          </form>
        ) : (
          <form
            aria-busy={resetSubmitting}
            className={styles.form}
            id="passwordResetForm"
            noValidate
            onSubmit={handlePasswordReset}
          >
            <input id="resetToken" readOnly type="hidden" value={urlCapture.resetToken} />
            <AuthFormField
              autoComplete="new-password"
              data-autofocus
              help="Mindestens 8 Zeichen, eine Zahl und ein Sonderzeichen; maximal 72 Bytes."
              id="resetNewPassword"
              label="Neues Passwort"
              maxLength={72}
              minLength={8}
              onChange={(event) => setResetPassword(event.currentTarget.value)}
              required
              type="password"
              value={resetPassword}
            />
            <AuthFormField
              autoComplete="new-password"
              id="resetNewPasswordConfirm"
              label="Neues Passwort wiederholen"
              maxLength={72}
              minLength={8}
              onChange={(event) => setResetPasswordConfirm(event.currentTarget.value)}
              required
              type="password"
              value={resetPasswordConfirm}
            />
            <button className={styles.buttonPrimary} disabled={resetSubmitting} type="submit">
              {resetSubmitting ? <LoadingSpinner /> : null}
              {resetSubmitting ? 'Passwort wird gespeichert...' : 'Passwort speichern'}
            </button>
          </form>
        )}
      </Dialog>

      <noscript>
        <p>
          Für die Anmeldung wird JavaScript benötigt. <a href="/index.html">Zur Startseite</a>
        </p>
      </noscript>
    </>
  );
}
