'use client';

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { apiGet, apiJson } from '@/lib/api/client';
import { AuthFormField } from './auth-form-field';
import { ShieldLockIcon, UserCheckIcon } from './auth-icons';
import { BrandLogo } from './auth-shell';
import { Feedback, LoadingSpinner, type FeedbackTone } from './auth-ui';
import {
  EMAIL_PATTERN,
  errorMessage,
  isAdminPasswordValid,
  safeLocalRedirect,
} from './auth-utils';
import styles from './auth.module.css';

interface SetupStatusResponse {
  setupRequired: boolean;
}

interface SetupResponse {
  message?: string;
  redirectTo?: string;
}

interface SetupValues {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  passwordRepeat: string;
  setupToken: string;
}

type SetupField = keyof SetupValues;
type SetupErrors = Partial<Record<SetupField, string>>;

const INITIAL_VALUES: SetupValues = {
  email: '',
  firstName: '',
  lastName: '',
  password: '',
  passwordRepeat: '',
  setupToken: '',
};

const REQUIRED_FIELDS: SetupField[] = [
  'setupToken',
  'firstName',
  'lastName',
  'email',
  'password',
  'passwordRepeat',
];

function validateSetup(values: SetupValues): SetupErrors {
  const errors: SetupErrors = {};
  for (const field of REQUIRED_FIELDS) {
    if (!values[field].trim()) errors[field] = 'Bitte dieses Pflichtfeld ausfüllen.';
  }

  const email = values.email.trim();
  if (email && (!EMAIL_PATTERN.test(email) || email.length > 254)) {
    errors.email = 'Bitte eine gültige E-Mail-Adresse eingeben.';
  }

  if (values.password && !isAdminPasswordValid(values.password)) {
    errors.password =
      'Mindestens 12 Zeichen, höchstens 72 Bytes, Groß- und Kleinbuchstaben, Zahl und Sonderzeichen erforderlich.';
  }

  if (
    values.password &&
    values.passwordRepeat &&
    values.password !== values.passwordRepeat
  ) {
    errors.passwordRepeat = 'Die Passwörter stimmen nicht überein.';
  }

  return errors;
}

export function SetupForm() {
  const [values, setValues] = useState<SetupValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<SetupErrors>({});
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; tone: FeedbackTone }>({
    message: '',
    tone: 'info',
  });

  useEffect(() => {
    let active = true;

    void apiGet<SetupStatusResponse>('/setup-status')
      .then((status) => {
        if (!active) return;
        if (!status.setupRequired) {
          window.location.replace('/login.html');
          return;
        }
        setCheckingStatus(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFeedback({
          message: errorMessage(error, 'Installationsstatus konnte nicht geladen werden.'),
          tone: 'danger',
        });
        setStatusUnavailable(true);
        setCheckingStatus(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const updateField = (event: ChangeEvent<HTMLInputElement>) => {
    const field = event.currentTarget.name as SetupField;
    const value = event.currentTarget.value;
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field] && field !== 'password') return current;
      const next = { ...current };
      delete next[field];
      if (
        (field === 'password' || field === 'passwordRepeat') &&
        (field === 'password' ? value : values.password) ===
          (field === 'passwordRepeat' ? value : values.passwordRepeat)
      ) {
        delete next.passwordRepeat;
      }
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || checkingStatus || statusUnavailable || redirecting) return;

    const validationErrors = validateSetup(values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      const passwordMismatch = validationErrors.passwordRepeat === 'Die Passwörter stimmen nicht überein.';
      setFeedback({
        message: passwordMismatch
          ? 'Die Passwörter stimmen nicht überein.'
          : validationErrors.password
            ? 'Das Passwort benötigt mindestens 12 Zeichen, Groß- und Kleinbuchstaben, eine Zahl und ein Sonderzeichen.'
            : 'Bitte alle Pflichtfelder korrekt ausfüllen.',
        tone: 'danger',
      });
      const firstInvalidField = REQUIRED_FIELDS.find((field) => validationErrors[field]);
      const element = firstInvalidField
        ? event.currentTarget.elements.namedItem(firstInvalidField)
        : null;
      if (element instanceof HTMLElement) element.focus();
      return;
    }

    setSubmitting(true);
    setFeedback((current) => ({ ...current, message: '' }));
    try {
      const result = await apiJson<SetupResponse>('/setup-admin', 'POST', {
        setupToken: values.setupToken,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim(),
        password: values.password,
      });

      setFeedback({
        message: result.message || 'Adminkonto wurde erstellt. Die Installation ist betriebsbereit.',
        tone: 'success',
      });
      setRedirecting(true);
      window.setTimeout(() => {
        window.location.replace(safeLocalRedirect(result.redirectTo, '/backend.html'));
      }, 500);
    } catch (error) {
      setFeedback({
        message: errorMessage(error, 'Die Ersteinrichtung ist fehlgeschlagen.'),
        tone: 'danger',
      });
      setSubmitting(false);
    }
  };

  const formDisabled = checkingStatus || statusUnavailable || submitting || redirecting;

  return (
    <main className={styles.setupPage}>
      <div className={styles.setupContainer}>
        <header className={styles.setupHeader}>
          <BrandLogo compact />
          <h1>Ersteinrichtung</h1>
          <p className={styles.setupIntro}>
            Die Datenbank ist bereit. Erstellen Sie jetzt das erste globale Adminkonto.
          </p>
        </header>

        <Feedback id="setupMessage" message={feedback.message} tone={feedback.tone} />

        <div className={styles.setupCard}>
          <div className={styles.setupCardBody}>
            <div className={styles.setupInfo}>
              <ShieldLockIcon />
              <div>
                <strong>Einmalig abgesichert</strong>
                <p>
                  Den Einrichtungs-Code finden Sie im Deployment-Log oder im Wert von{' '}
                  <code>ADMIN_SETUP_TOKEN</code>.
                </p>
              </div>
            </div>

            <form
              aria-busy={checkingStatus || submitting || redirecting}
              className={styles.formGrid}
              id="setupForm"
              noValidate
              onSubmit={handleSubmit}
            >
              <fieldset className={styles.fieldset} disabled={formDisabled}>
                <AuthFormField
                  autoComplete="one-time-code"
                  data-autofocus
                  error={errors.setupToken}
                  id="setupToken"
                  label="Einrichtungs-Code"
                  maxLength={512}
                  onChange={updateField}
                  required
                  type="password"
                  value={values.setupToken}
                />
                <AuthFormField
                  autoComplete="given-name"
                  error={errors.firstName}
                  id="firstName"
                  label="Vorname"
                  maxLength={100}
                  onChange={updateField}
                  required
                  value={values.firstName}
                  width="half"
                />
                <AuthFormField
                  autoComplete="family-name"
                  error={errors.lastName}
                  id="lastName"
                  label="Nachname"
                  maxLength={100}
                  onChange={updateField}
                  required
                  value={values.lastName}
                  width="half"
                />
                <AuthFormField
                  autoComplete="username"
                  error={errors.email}
                  id="email"
                  label="Admin-E-Mail-Adresse"
                  maxLength={254}
                  onChange={updateField}
                  required
                  type="email"
                  value={values.email}
                />
                <AuthFormField
                  autoComplete="new-password"
                  error={errors.password}
                  id="password"
                  label="Passwort"
                  maxLength={128}
                  minLength={12}
                  onChange={updateField}
                  required
                  type="password"
                  value={values.password}
                  width="half"
                />
                <AuthFormField
                  autoComplete="new-password"
                  error={errors.passwordRepeat}
                  id="passwordRepeat"
                  label="Passwort wiederholen"
                  maxLength={128}
                  minLength={12}
                  onChange={updateField}
                  required
                  type="password"
                  value={values.passwordRepeat}
                  width="half"
                />
                <p className={`${styles.fieldHelp} ${styles.formActions}`}>
                  Mindestens 12 Zeichen mit Groß- und Kleinbuchstaben, Zahl und Sonderzeichen.
                </p>
                <div className={styles.formActions}>
                  <button
                    className={styles.buttonPrimary}
                    disabled={formDisabled}
                    id="setupSubmit"
                    type="submit"
                  >
                    {submitting || redirecting ? <LoadingSpinner /> : <UserCheckIcon />}
                    {checkingStatus
                      ? 'Installationsstatus wird geprüft...'
                      : submitting || redirecting
                        ? 'Einrichtung läuft...'
                        : 'Adminkonto erstellen'}
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
