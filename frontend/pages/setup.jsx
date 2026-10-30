import { useEffect, useRef, useState } from 'react';
import PageHead from '../components/PageHead';

const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,128}$/;

export default function SetupPage() {
    const formRef = useRef(null);
    const messageRef = useRef(null);
    const passwordRef = useRef(null);
    const passwordRepeatRef = useRef(null);
    const [statusChecked, setStatusChecked] = useState(false);
    const [blocked, setBlocked] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState(null);
    const [values, setValues] = useState({
        setupToken: '', firstName: '', lastName: '', email: '', password: '', passwordRepeat: ''
    });

    useEffect(() => {
        if (message) messageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [message]);

    useEffect(() => {
        (async () => {
            try {
                const statusResponse = await fetch('/setup-status', {
                    headers: { Accept: 'application/json' }
                });
                const status = await statusResponse.json();

                if (!statusResponse.ok) {
                    throw new Error(status.error || 'Installationsstatus konnte nicht geladen werden.');
                }

                if (!status.setupRequired) {
                    window.location.replace('/login.html');
                    return;
                }
                setStatusChecked(true);
            } catch (error) {
                setMessage({ text: error.message || 'Installationsstatus konnte nicht geladen werden.', type: 'danger' });
                setBlocked(true);
            }
        })();
    }, []);

    const update = field => event => setValues(current => ({ ...current, [field]: event.target.value }));

    const submit = async event => {
        event.preventDefault();
        if (!statusChecked) return;

        const { password, passwordRepeat } = values;

        if (!formRef.current.reportValidity()) return;

        if (password !== passwordRepeat) {
            setMessage({ text: 'Die Passwörter stimmen nicht überein.', type: 'danger' });
            passwordRepeatRef.current.focus();
            return;
        }

        if (!PASSWORD_POLICY.test(password)) {
            setMessage({
                text: 'Das Passwort benötigt mindestens 12 Zeichen, Groß- und Kleinbuchstaben, eine Zahl und ein Sonderzeichen.',
                type: 'danger'
            });
            passwordRef.current.focus();
            return;
        }

        setSubmitting(true);

        try {
            const response = await fetch('/setup-admin', {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    setupToken: values.setupToken,
                    firstName: values.firstName.trim(),
                    lastName: values.lastName.trim(),
                    email: values.email.trim(),
                    password
                })
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(result.error || 'Die Ersteinrichtung ist fehlgeschlagen.');
            }

            setMessage({ text: result.message, type: 'success' });
            window.setTimeout(() => {
                window.location.replace(result.redirectTo || '/backend.html');
            }, 500);
        } catch (error) {
            setMessage({ text: error.message || 'Die Ersteinrichtung ist fehlgeschlagen.', type: 'danger' });
            setSubmitting(false);
        }
    };

    return (
        <>
            <PageHead title="Segnitz Rental – Ersteinrichtung" robots="noindex, nofollow" />
            <main className="container py-5">
                <div className="row justify-content-center">
                    <div className="col-12 col-lg-8 col-xl-6">
                        <div className="text-center mb-4">
                            <img src="img/logo.png" alt="Segnitz Rental" className="img-fluid mb-3" style={{ maxHeight: 88 }} />
                            <h1 className="h3 mb-2">Ersteinrichtung</h1>
                            <p className="text-muted mb-0">
                                Die Datenbank ist bereit. Erstellen Sie jetzt das erste globale Adminkonto.
                            </p>
                        </div>

                        <div id="setupMessage" ref={messageRef} className={message ? `alert alert-${message.type}` : 'alert d-none'}
                            role="alert" aria-live="polite">
                            {message?.text}
                        </div>

                        <div className="card border-0 shadow-sm">
                            <div className="card-body p-4 p-md-5">
                                <div className="alert alert-info d-flex gap-3 align-items-start">
                                    <i className="bi bi-shield-lock-fill fs-4" aria-hidden="true" />
                                    <div>
                                        <strong>Einmalig abgesichert</strong>
                                        <div className="small mt-1">
                                            Den Einrichtungs-Code finden Sie im Deployment-Log oder im Wert von <code>ADMIN_SETUP_TOKEN</code>.
                                        </div>
                                    </div>
                                </div>

                                <form id="setupForm" noValidate ref={formRef} onSubmit={submit}>
                                    <div className="mb-3">
                                        <label htmlFor="setupToken" className="form-label">Einrichtungs-Code</label>
                                        <input type="password" className="form-control" id="setupToken"
                                            autoComplete="one-time-code" required maxLength={512}
                                            value={values.setupToken} onChange={update('setupToken')} />
                                    </div>

                                    <div className="row g-3">
                                        <div className="col-md-6">
                                            <label htmlFor="firstName" className="form-label">Vorname</label>
                                            <input type="text" className="form-control" id="firstName"
                                                autoComplete="given-name" required maxLength={100}
                                                value={values.firstName} onChange={update('firstName')} />
                                        </div>
                                        <div className="col-md-6">
                                            <label htmlFor="lastName" className="form-label">Nachname</label>
                                            <input type="text" className="form-control" id="lastName"
                                                autoComplete="family-name" required maxLength={100}
                                                value={values.lastName} onChange={update('lastName')} />
                                        </div>
                                    </div>

                                    <div className="mt-3">
                                        <label htmlFor="email" className="form-label">Admin-E-Mail-Adresse</label>
                                        <input type="email" className="form-control" id="email"
                                            autoComplete="username" required maxLength={254}
                                            value={values.email} onChange={update('email')} />
                                    </div>

                                    <div className="row g-3 mt-0">
                                        <div className="col-md-6">
                                            <label htmlFor="password" className="form-label">Passwort</label>
                                            <input type="password" className="form-control" id="password" ref={passwordRef}
                                                autoComplete="new-password" required minLength={12} maxLength={128}
                                                value={values.password} onChange={update('password')} />
                                        </div>
                                        <div className="col-md-6">
                                            <label htmlFor="passwordRepeat" className="form-label">Passwort wiederholen</label>
                                            <input type="password" className="form-control" id="passwordRepeat" ref={passwordRepeatRef}
                                                autoComplete="new-password" required minLength={12} maxLength={128}
                                                value={values.passwordRepeat} onChange={update('passwordRepeat')} />
                                        </div>
                                    </div>

                                    <div className="form-text mt-2">
                                        Mindestens 12 Zeichen mit Groß- und Kleinbuchstaben, Zahl und Sonderzeichen.
                                    </div>

                                    <button type="submit" id="setupSubmit" className="btn btn-primary w-100 mt-4"
                                        disabled={blocked || submitting}>
                                        {submitting
                                            ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Einrichtung läuft...</>
                                            : <><i className="bi bi-person-check-fill me-1" aria-hidden="true" /> Adminkonto erstellen</>}
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
            <footer className="legal-footer"><a href="/widerruf.html">Widerruf</a></footer>
        </>
    );
}
