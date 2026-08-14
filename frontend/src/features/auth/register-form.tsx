'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { apiJson } from '@/lib/api/client';
import { AuthFormField } from './auth-form-field';
import {
  ArrowLeftCircleIcon,
  EnvelopeCheckIcon,
  PersonPlusIcon,
  UserLockIcon,
} from './auth-icons';
import { AuthShell, LinkButton } from './auth-shell';
import { Feedback, LoadingSpinner, type FeedbackTone } from './auth-ui';
import {
  EMAIL_PATTERN,
  errorMessage,
  isCustomerPasswordValid,
} from './auth-utils';
import styles from './auth.module.css';

interface RegistrationValues {
  address: string;
  city: string;
  company: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  passwordRepeat: string;
  phone: string;
  zip: string;
}

type RegistrationField = keyof RegistrationValues;
type RegistrationErrors = Partial<Record<RegistrationField, string>>;

const INITIAL_VALUES: RegistrationValues = {
  address: '',
  city: '',
  company: '',
  email: '',
  firstName: '',
  lastName: '',
  password: '',
  passwordRepeat: '',
  phone: '',
  zip: '',
};

const REQUIRED_FIELDS: RegistrationField[] = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'address',
  'zip',
  'city',
  'password',
  'passwordRepeat',
];

const ADDRESS_PATTERN = /^[a-zA-Z0-9äöüÄÖÜß\s]+$/u;
const DIGITS_PATTERN = /^[0-9]+$/u;

function validateRegistration(values: RegistrationValues): RegistrationErrors {
  const errors: RegistrationErrors = {};

  for (const field of REQUIRED_FIELDS) {
    if (!values[field].trim()) errors[field] = 'Dieses Pflichtfeld muss ausgefüllt werden.';
  }

  const email = values.email.trim();
  if (email && (!EMAIL_PATTERN.test(email) || email.length > 254)) {
    errors.email = 'Bitte geben Sie eine gültige E-Mail-Adresse ein.';
  }

  const phone = values.phone.trim();
  if (phone && !DIGITS_PATTERN.test(phone)) {
    errors.phone = 'Die Telefonnummer darf nur Ziffern enthalten.';
  }

  const zip = values.zip.trim();
  if (zip && !DIGITS_PATTERN.test(zip)) {
    errors.zip = 'Die Postleitzahl darf nur Ziffern enthalten.';
  }

  const address = values.address.trim();
  if (address && !ADDRESS_PATTERN.test(address)) {
    errors.address = 'Die Adresse darf nur Buchstaben, Ziffern und Leerzeichen enthalten.';
  }

  if (values.password && !isCustomerPasswordValid(values.password)) {
    errors.password = 'Das Passwort muss 8 bis 72 Bytes, eine Zahl und ein Sonderzeichen enthalten.';
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

export function RegisterForm() {
  const [values, setValues] = useState<RegistrationValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [feedback, setFeedback] = useState<{ message: string; tone: FeedbackTone }>({
    message: '',
    tone: 'info',
  });
  const [submitting, setSubmitting] = useState(false);

  const updateField = (event: ChangeEvent<HTMLInputElement>) => {
    const field = event.currentTarget.name as RegistrationField;
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
    if (submitting) return;

    const validationErrors = validateRegistration(values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setFeedback({
        message: 'Bitte füllen Sie alle rot markierten Pflichtfelder aus.',
        tone: 'danger',
      });
      const firstInvalidField = REQUIRED_FIELDS.find((field) => validationErrors[field]) ??
        (Object.keys(validationErrors)[0] as RegistrationField | undefined);
      const element = firstInvalidField
        ? event.currentTarget.elements.namedItem(firstInvalidField)
        : null;
      if (element instanceof HTMLElement) element.focus();
      return;
    }

    setSubmitting(true);
    setFeedback((current) => ({ ...current, message: '' }));
    try {
      await apiJson('/register-customer', 'POST', {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        company: values.company.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        address: values.address.trim(),
        zip: values.zip.trim(),
        city: values.city.trim(),
        password: values.password,
      });

      setFeedback({
        message: 'Registrierung erfolgreich! Bitte E-Mail bestätigen.',
        tone: 'success',
      });
      setValues(INITIAL_VALUES);
      setErrors({});
    } catch (error) {
      setFeedback({
        message: errorMessage(
          error,
          'Die Registrierung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.',
        ),
        tone: 'danger',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className={styles.feedbackStack} id="globalAlertContainer" />
      <AuthShell
        navigation={(
          <>
            <LinkButton href="/index.html">
              <ArrowLeftCircleIcon />
              Zurück zur Startseite
            </LinkButton>
            <LinkButton href="/login.html" variant="outline">
              <UserLockIcon />
              Zum Login
            </LinkButton>
          </>
        )}
        width="wide"
      >
        <div id="steps-container">
          <div>
            <header className={styles.headingRow}>
              <div>
                <h1 className={styles.pageHeading}>Konto erstellen</h1>
                <p className={styles.lead}>
                  Erstellen Sie Ihr Kundenkonto für schnellere Bestellungen und Zugriff auf Ihre Mietvorgänge.
                </p>
              </div>
              <span className={styles.verificationBadge}>
                <EnvelopeCheckIcon />
                E-Mail bestätigen
              </span>
            </header>

            <Feedback id="msg" message={feedback.message} tone={feedback.tone} />

            <div className={styles.formCard}>
              <div className={styles.formCardBody}>
                <form
                  aria-busy={submitting}
                  className={styles.formGrid}
                  id="registerForm"
                  noValidate
                  onSubmit={handleSubmit}
                >
                  <AuthFormField
                    autoComplete="given-name"
                    data-autofocus
                    error={errors.firstName}
                    id="firstName"
                    label="Vorname"
                    maxLength={100}
                    onChange={updateField}
                    placeholder="Vorname"
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
                    placeholder="Nachname"
                    required
                    value={values.lastName}
                    width="half"
                  />
                  <AuthFormField
                    autoComplete="organization"
                    error={errors.company}
                    id="company"
                    label="Firma"
                    maxLength={255}
                    onChange={updateField}
                    placeholder="Firma"
                    value={values.company}
                  />
                  <AuthFormField
                    autoComplete="email"
                    error={errors.email}
                    id="email"
                    label="E-Mail"
                    maxLength={254}
                    onChange={updateField}
                    placeholder="name@beispiel.de"
                    required
                    type="email"
                    value={values.email}
                    width="half"
                  />
                  <AuthFormField
                    autoComplete="tel"
                    error={errors.phone}
                    id="phone"
                    inputMode="numeric"
                    label="Telefon"
                    maxLength={50}
                    onChange={updateField}
                    pattern="[0-9]+"
                    placeholder="Telefon"
                    required
                    type="tel"
                    value={values.phone}
                    width="half"
                  />
                  <AuthFormField
                    autoComplete="street-address"
                    error={errors.address}
                    id="address"
                    label="Adresse"
                    maxLength={255}
                    onChange={updateField}
                    placeholder="Adresse"
                    required
                    value={values.address}
                  />
                  <AuthFormField
                    autoComplete="postal-code"
                    error={errors.zip}
                    id="zip"
                    inputMode="numeric"
                    label="PLZ"
                    maxLength={20}
                    onChange={updateField}
                    pattern="[0-9]+"
                    placeholder="PLZ"
                    required
                    value={values.zip}
                    width="third"
                  />
                  <AuthFormField
                    autoComplete="address-level2"
                    error={errors.city}
                    id="city"
                    label="Ort"
                    maxLength={100}
                    onChange={updateField}
                    placeholder="Ort"
                    required
                    value={values.city}
                    width="twoThirds"
                  />

                  <hr className={styles.formDivider} />

                  <AuthFormField
                    autoComplete="new-password"
                    error={errors.password}
                    help="Mindestens 8 Zeichen, eine Zahl und ein Sonderzeichen; maximal 72 Bytes."
                    id="password"
                    label="Passwort"
                    maxLength={72}
                    minLength={8}
                    onChange={updateField}
                    placeholder="Passwort"
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
                    maxLength={72}
                    minLength={8}
                    onChange={updateField}
                    placeholder="Passwort wiederholen"
                    required
                    type="password"
                    value={values.passwordRepeat}
                    width="half"
                  />
                  <div className={styles.formActions}>
                    <button
                      className={styles.buttonPrimary}
                      disabled={submitting}
                      id="registerSubmitButton"
                      type="submit"
                    >
                      {submitting ? <LoadingSpinner /> : <PersonPlusIcon />}
                      {submitting ? 'Registrierung läuft...' : 'Registrieren'}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <p className={styles.loginPrompt}>
              Bereits registriert?{' '}
              <a className={styles.textLink} href="/login.html">Zum Login</a>
            </p>
          </div>
        </div>
      </AuthShell>
    </>
  );
}
