'use client';

import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/ui/icon';
import { ApiError, apiJson } from '@/lib/api/client';
import type { EditableProfile, ProfileRecord } from './profile-types';
import styles from './profile.module.css';

interface ProfileDetailsProps {
  profile: ProfileRecord;
  notify: (message: string, tone?: 'success' | 'danger' | 'info' | 'warning') => void;
  onSaved: (profile: ProfileRecord) => void;
}

interface PasswordDraft {
  currentPassword: string;
  newPassword: string;
  newPasswordConfirm: string;
}

const EMPTY_PASSWORD: PasswordDraft = {
  currentPassword: '',
  newPassword: '',
  newPasswordConfirm: '',
};

function initialEditableProfile(profile: ProfileRecord): EditableProfile {
  return {
    firstName: profile.firstName || '',
    lastName: profile.lastName || '',
    company: profile.company || '',
    phone: profile.phone || '',
    address: profile.address || '',
    zip: profile.zip || '',
    city: profile.city || '',
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

export function ProfileDetails({ profile, notify, onSaved }: ProfileDetailsProps) {
  const [draft, setDraft] = useState<EditableProfile>(() => initialEditableProfile(profile));
  const [password, setPassword] = useState<PasswordDraft>(EMPTY_PASSWORD);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  function updateProfileField(field: keyof EditableProfile, value: string) {
    let sanitized = value;
    if (field === 'phone' || field === 'zip') sanitized = value.replace(/[^0-9]/g, '');
    if (field === 'address') sanitized = value.replace(/[^a-zA-Z0-9äöüÄÖÜß\s]/g, '');
    setDraft((current) => ({ ...current, [field]: sanitized }));
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft.phone || !draft.zip || !draft.address || !draft.firstName || !draft.lastName || !draft.city) {
      notify('Bitte füllen Sie alle Pflichtfelder aus.', 'warning');
      return;
    }

    setSavingProfile(true);
    try {
      const result = await apiJson<{ message?: string }>('/my-profile', 'PUT', draft);
      onSaved({ ...profile, ...draft });
      notify(result.message || 'Profildaten wurden gespeichert.', 'success');
    } catch (error) {
      notify(errorMessage(error, 'Profildaten konnten nicht gespeichert werden.'), 'danger');
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.newPassword !== password.newPasswordConfirm) {
      notify('Die neuen Passwörter stimmen nicht überein.', 'warning');
      return;
    }

    const newPasswordBytes = new TextEncoder().encode(password.newPassword).length;
    if (
      password.newPassword.length < 8 ||
      newPasswordBytes > 72 ||
      !/[0-9]/.test(password.newPassword) ||
      !/[^A-Za-z0-9]/.test(password.newPassword)
    ) {
      notify('Das neue Passwort muss 8 bis 72 Bytes, eine Zahl und ein Sonderzeichen enthalten.', 'warning');
      return;
    }

    setSavingPassword(true);
    try {
      const result = await apiJson<{ message?: string }>('/my-profile/password', 'PUT', password);
      setPassword(EMPTY_PASSWORD);
      notify(result.message || 'Passwort wurde geändert.', 'success');
    } catch (error) {
      notify(errorMessage(error, 'Passwort konnte nicht geändert werden.'), 'danger');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <section aria-labelledby="profile-heading" className={styles.section} id="profileView">
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>Kundenkonto</p>
          <h1 id="profile-heading">Meine Daten</h1>
          <p>Halten Sie Ihre Kontaktdaten aktuell und verwalten Sie Ihr Passwort.</p>
        </div>
        <span className={`${styles.verification} ${profile.emailVerified ? styles.verified : styles.unverified}`}>
          <Icon name={profile.emailVerified ? 'check' : 'info'} size={17} />
          E-Mail {profile.emailVerified ? 'bestätigt' : 'nicht bestätigt'}
        </span>
      </header>

      <div className={styles.profileColumns}>
        <form className={`${styles.panel} ${styles.formPanel}`} onSubmit={saveProfile}>
          <div className={styles.panelHeading}>
            <span className={styles.headingIcon}><Icon name="user" /></span>
            <div>
              <h2>Persönliche Angaben</h2>
              <p>Diese Angaben werden für Ihre Mietaufträge verwendet.</p>
            </div>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Kundennummer</span>
              <input className={styles.input} id="customerNo" readOnly value={profile.customerNo || '–'} />
            </label>
            <label className={styles.field}>
              <span>E-Mail</span>
              <input className={styles.input} id="email" readOnly type="email" value={profile.email || ''} />
            </label>
            <label className={styles.field}>
              <span>Vorname *</span>
              <input
                autoComplete="given-name"
                className={styles.input}
                id="profileFirstName"
                maxLength={100}
                onChange={(event) => updateProfileField('firstName', event.target.value)}
                required
                value={draft.firstName}
              />
            </label>
            <label className={styles.field}>
              <span>Nachname *</span>
              <input
                autoComplete="family-name"
                className={styles.input}
                id="profileLastName"
                maxLength={100}
                onChange={(event) => updateProfileField('lastName', event.target.value)}
                required
                value={draft.lastName}
              />
            </label>
            <label className={`${styles.field} ${styles.fullField}`}>
              <span>Firma</span>
              <input
                autoComplete="organization"
                className={styles.input}
                id="profileCompany"
                maxLength={255}
                onChange={(event) => updateProfileField('company', event.target.value)}
                value={draft.company}
              />
            </label>
            <label className={`${styles.field} ${styles.fullField}`}>
              <span>Telefon *</span>
              <input
                autoComplete="tel"
                className={styles.input}
                id="profilePhone"
                inputMode="numeric"
                maxLength={50}
                onChange={(event) => updateProfileField('phone', event.target.value)}
                pattern="[0-9]+"
                required
                value={draft.phone}
              />
            </label>
            <label className={`${styles.field} ${styles.fullField}`}>
              <span>Adresse *</span>
              <input
                autoComplete="street-address"
                className={styles.input}
                id="profileAddress"
                maxLength={255}
                onChange={(event) => updateProfileField('address', event.target.value)}
                required
                value={draft.address}
              />
            </label>
            <label className={styles.field}>
              <span>PLZ *</span>
              <input
                autoComplete="postal-code"
                className={styles.input}
                id="profileZip"
                inputMode="numeric"
                maxLength={20}
                onChange={(event) => updateProfileField('zip', event.target.value)}
                pattern="[0-9]+"
                required
                value={draft.zip}
              />
            </label>
            <label className={styles.field}>
              <span>Ort *</span>
              <input
                autoComplete="address-level2"
                className={styles.input}
                id="profileCity"
                maxLength={100}
                onChange={(event) => updateProfileField('city', event.target.value)}
                required
                value={draft.city}
              />
            </label>
          </div>

          <div className={styles.formActions}>
            <button className="button" disabled={savingProfile} type="submit">
              <Icon name={savingProfile ? 'refresh' : 'check'} />
              {savingProfile ? 'Wird gespeichert …' : 'Daten speichern'}
            </button>
          </div>
        </form>

        <form className={`${styles.panel} ${styles.passwordPanel}`} onSubmit={changePassword}>
          <div className={styles.panelHeading}>
            <span className={styles.headingIcon}><Icon name="lock" /></span>
            <div>
              <h2>Passwort ändern</h2>
              <p>Verwenden Sie mindestens 8 Zeichen, eine Zahl und ein Sonderzeichen.</p>
            </div>
          </div>
          <div className={styles.passwordFields}>
            <label className={styles.field}>
              <span>Aktuelles Passwort</span>
              <input
                autoComplete="current-password"
                className={styles.input}
                id="currentPassword"
                maxLength={128}
                onChange={(event) => setPassword((current) => ({ ...current, currentPassword: event.target.value }))}
                required
                type="password"
                value={password.currentPassword}
              />
            </label>
            <label className={styles.field}>
              <span>Neues Passwort</span>
              <input
                autoComplete="new-password"
                className={styles.input}
                id="newPassword"
                onChange={(event) => setPassword((current) => ({ ...current, newPassword: event.target.value }))}
                required
                type="password"
                value={password.newPassword}
              />
            </label>
            <label className={styles.field}>
              <span>Neues Passwort wiederholen</span>
              <input
                autoComplete="new-password"
                className={styles.input}
                id="newPasswordConfirm"
                onChange={(event) => setPassword((current) => ({ ...current, newPasswordConfirm: event.target.value }))}
                required
                type="password"
                value={password.newPasswordConfirm}
              />
            </label>
          </div>
          <button className="button buttonAccent" disabled={savingPassword} type="submit">
            <Icon name={savingPassword ? 'refresh' : 'lock'} />
            {savingPassword ? 'Wird geändert …' : 'Passwort ändern'}
          </button>
        </form>
      </div>
    </section>
  );
}
