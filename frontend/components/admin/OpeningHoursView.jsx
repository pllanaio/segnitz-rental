import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { showAlert } from '../../lib/alerts';

const WEEKDAY_LABELS = { 1: 'Montag', 2: 'Dienstag', 3: 'Mittwoch', 4: 'Donnerstag', 5: 'Freitag', 6: 'Samstag', 0: 'Sonntag' };

function normalizeHours(hours) {
    return [1, 2, 3, 4, 5, 6, 0].map(weekday => {
        const day = hours.find(entry => Number(entry.weekday) === weekday) || { weekday, is_open: 0, open_time: '', close_time: '' };
        return { weekday, isOpen: Number(day.is_open) === 1, openTime: day.open_time || '', closeTime: day.close_time || '' };
    });
}

const OpeningHoursView = forwardRef(function OpeningHoursView({ visible }, ref) {
    const [state, setState] = useState({ status: 'idle', days: [], error: '' });

    const load = async () => {
        try {
            const response = await fetch('/admin/opening-hours');
            const result = await response.json();
            if (!response.ok) {
                setState({ status: 'error', days: [], error: result.error || 'Öffnungszeiten konnten nicht geladen werden.' });
                return;
            }
            setState({ status: 'loaded', days: normalizeHours(result), error: '' });
        } catch (error) {
            console.error('Fehler beim Laden der Öffnungszeiten:', error);
            setState({ status: 'error', days: [], error: 'Öffnungszeiten konnten nicht geladen werden.' });
        }
    };

    useEffect(() => { load(); }, []);
    useImperativeHandle(ref, () => ({ load }));

    const updateDay = (weekday, changes) => setState(current => ({
        ...current,
        days: current.days.map(day => day.weekday === weekday ? { ...day, ...changes } : day)
    }));

    const save = async () => {
        const openingHours = state.days.map(day => ({
            weekday: day.weekday,
            is_open: day.isOpen ? 1 : 0,
            open_time: day.openTime || null,
            close_time: day.closeTime || null
        }));

        try {
            const response = await fetch('/admin/opening-hours', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ openingHours })
            });
            const result = await response.json();
            if (!response.ok) {
                showAlert(result.error || 'Öffnungszeiten konnten nicht gespeichert werden.', 'danger');
                return;
            }
            showAlert(result.message || 'Öffnungszeiten gespeichert.', 'success');
            await load();
        } catch (error) {
            console.error('Fehler beim Speichern der Öffnungszeiten:', error);
            showAlert('Öffnungszeiten konnten nicht gespeichert werden.', 'danger');
        }
    };

    return (
        <div id="openingHoursView" className={visible ? undefined : 'd-none'}>
            <h2 className="mb-4">Öffnungszeiten</h2>
            <div className="card">
                <div className="card-body">
                    <div id="openingHoursAdmin">
                        {state.status === 'error' ? <div className="alert alert-danger">{state.error}</div> : state.days.map(day => (
                            <div className="row g-2 align-items-center mb-2 opening-hour-row" data-weekday={day.weekday} key={day.weekday}>
                                <div className="col-12 col-md-3"><strong>{WEEKDAY_LABELS[day.weekday]}</strong></div>
                                <div className="col-12 col-md-2">
                                    <div className="form-check form-switch">
                                        <input className="form-check-input opening-is-open" type="checkbox" id={`openingIsOpen${day.weekday}`}
                                            checked={day.isOpen} onChange={event => updateDay(day.weekday, { isOpen: event.target.checked })} />
                                        <label className="form-check-label" htmlFor={`openingIsOpen${day.weekday}`}>Geöffnet</label>
                                    </div>
                                </div>
                                <div className="col-6 col-md-3">
                                    <input type="time" className="form-control opening-open-time" aria-label={`${WEEKDAY_LABELS[day.weekday]} öffnet um`}
                                        value={day.openTime} onChange={event => updateDay(day.weekday, { openTime: event.target.value })} />
                                </div>
                                <div className="col-6 col-md-3">
                                    <input type="time" className="form-control opening-close-time" aria-label={`${WEEKDAY_LABELS[day.weekday]} schließt um`}
                                        value={day.closeTime} onChange={event => updateDay(day.weekday, { closeTime: event.target.value })} />
                                </div>
                            </div>
                        ))}
                    </div>
                    <button type="button" className="btn btn-primary mt-3" id="saveOpeningHoursButton" onClick={save}>Öffnungszeiten speichern</button>
                </div>
            </div>
        </div>
    );
});

export default OpeningHoursView;
