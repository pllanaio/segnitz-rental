'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { apiGet, apiJson } from '@/lib/api/client';
import { errorMessage } from './admin-utils';
import type { AdminMessageResponse, AdminOpeningHour, Notify } from './types';
import styles from './admin.module.css';

const DAYS = [
  { weekday: 1, label: 'Montag' },
  { weekday: 2, label: 'Dienstag' },
  { weekday: 3, label: 'Mittwoch' },
  { weekday: 4, label: 'Donnerstag' },
  { weekday: 5, label: 'Freitag' },
  { weekday: 6, label: 'Samstag' },
  { weekday: 0, label: 'Sonntag' },
];

function normalizeHours(hours: AdminOpeningHour[]): AdminOpeningHour[] {
  return DAYS.map(({ weekday }) => hours.find((entry) => Number(entry.weekday) === weekday) ?? {
    weekday,
    is_open: 0,
    open_time: null,
    close_time: null,
  });
}

export function OpeningHoursView({ notify }: { notify: Notify }) {
  const [hours, setHours] = useState<AdminOpeningHour[]>(() => normalizeHours([]));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadHours = useCallback(async () => {
    setLoading(true);
    try {
      setHours(normalizeHours(await apiGet<AdminOpeningHour[]>('/admin/opening-hours')));
    } catch (error) {
      notify(errorMessage(error, 'Öffnungszeiten konnten nicht geladen werden.'), 'danger');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadHours(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadHours]);

  function updateHour(weekday: number, patch: Partial<AdminOpeningHour>) {
    setHours((current) => current.map((entry) => entry.weekday === weekday ? { ...entry, ...patch } : entry));
  }

  async function saveHours() {
    const incomplete = hours.find((entry) => Boolean(entry.is_open) && (!entry.open_time || !entry.close_time));
    if (incomplete) {
      notify('Für jeden geöffneten Tag müssen Öffnungs- und Schließzeit eingetragen sein.', 'warning');
      return;
    }
    const invalidRange = hours.find((entry) => Boolean(entry.is_open) && entry.open_time! >= entry.close_time!);
    if (invalidRange) {
      const day = DAYS.find((candidate) => candidate.weekday === invalidRange.weekday)?.label;
      notify(`Am ${day ?? 'gewählten Tag'} muss die Schließzeit nach der Öffnungszeit liegen.`, 'warning');
      return;
    }
    setSaving(true);
    try {
      const result = await apiJson<AdminMessageResponse>('/admin/opening-hours', 'PUT', {
        openingHours: hours.map((entry) => ({
          weekday: entry.weekday,
          is_open: entry.is_open ? 1 : 0,
          open_time: entry.is_open ? entry.open_time || null : null,
          close_time: entry.is_open ? entry.close_time || null : null,
        })),
      });
      notify(result.message ?? 'Öffnungszeiten wurden gespeichert.', 'success');
      await loadHours();
    } catch (error) {
      notify(errorMessage(error, 'Öffnungszeiten konnten nicht gespeichert werden.'), 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="opening-hours-heading" className={styles.view}>
      <div className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>Verfügbarkeit</span>
          <h1 id="opening-hours-heading">Öffnungszeiten</h1>
          <p>Abhol- und Rückgabezeiten für alle Wochentage festlegen.</p>
        </div>
        <button className="button buttonSecondary" disabled={loading} onClick={() => void loadHours()} type="button"><Icon name="refresh" /> Neu laden</button>
      </div>

      <div className={`card ${styles.hoursCard}`}>
        <div className={styles.hoursHeader}>
          <span>Wochentag</span>
          <span>Status</span>
          <span>Öffnet</span>
          <span>Schließt</span>
        </div>
        {loading ? (
          <div className={styles.hoursLoading}>Öffnungszeiten werden geladen …</div>
        ) : hours.map((entry) => {
          const day = DAYS.find((candidate) => candidate.weekday === entry.weekday);
          const open = entry.is_open === true || Number(entry.is_open) === 1;
          return (
            <div className={styles.hoursRow} data-weekday={entry.weekday} key={entry.weekday}>
              <strong>{day?.label}</strong>
              <label className={styles.switchField}>
                <input checked={open} className="opening-is-open" onChange={(event) => updateHour(entry.weekday, { is_open: event.target.checked ? 1 : 0 })} type="checkbox" />
                <span aria-hidden="true" className={styles.switchTrack}><span /></span>
                <span>{open ? 'Geöffnet' : 'Geschlossen'}</span>
              </label>
              <label className="field">
                <span className="srOnly">Öffnungszeit {day?.label}</span>
                <input className="input opening-open-time" disabled={!open} onChange={(event) => updateHour(entry.weekday, { open_time: event.target.value || null })} type="time" value={entry.open_time ?? ''} />
              </label>
              <label className="field">
                <span className="srOnly">Schließzeit {day?.label}</span>
                <input className="input opening-close-time" disabled={!open} onChange={(event) => updateHour(entry.weekday, { close_time: event.target.value || null })} type="time" value={entry.close_time ?? ''} />
              </label>
            </div>
          );
        })}
        <div className={styles.hoursFooter}>
          <p><Icon name="info" size={18} /> Geschlossene Tage werden im Checkout automatisch berücksichtigt.</p>
          <button className="button" disabled={loading || saving} id="saveOpeningHoursButton" onClick={() => void saveHours()} type="button">
            {saving ? 'Wird gespeichert …' : 'Öffnungszeiten speichern'}
          </button>
        </div>
      </div>
    </section>
  );
}
