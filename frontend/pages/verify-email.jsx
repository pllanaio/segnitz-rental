import { useEffect, useState } from 'react';
import PageHead from '../components/PageHead';

const DEFAULT_MESSAGE = 'Klicken Sie auf „E-Mail bestätigen“, um die Registrierung abzuschließen.';

export default function VerifyEmailPage() {
    const [token, setToken] = useState(null);
    const [message, setMessage] = useState(DEFAULT_MESSAGE);
    const [disabled, setDisabled] = useState(false);

    useEffect(() => {
        const params = new URLSearchParams(window.location.hash.slice(1));
        const fragmentToken = params.get('token') || '';

        // The token must neither stay in the address bar nor leak via Referer.
        window.history.replaceState({}, document.title, '/verify-email.html');

        if (!/^[a-f0-9]{64}$/.test(fragmentToken)) {
            setMessage('Der Bestätigungslink ist ungültig oder unvollständig.');
            setDisabled(true);
            return;
        }

        setToken(fragmentToken);
    }, []);

    const complete = async () => {
        if (!token) return;
        setDisabled(true);
        setMessage('Die E-Mail-Adresse wird bestätigt …');

        try {
            const response = await fetch('/verify-email/complete', {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token })
            });
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Die E-Mail-Adresse konnte nicht bestätigt werden.');
            }

            const redirectTo = String(result.redirectTo || '');
            if (!redirectTo.startsWith('/')) {
                throw new Error('Die Bestätigung lieferte kein gültiges Weiterleitungsziel.');
            }
            window.location.assign(redirectTo);
        } catch (error) {
            setMessage(error.message);
            setDisabled(false);
        }
    };

    return (
        <>
            <PageHead title="E-Mail bestätigen – Segnitz Rental" referrer="no-referrer" noStore />
            <main className="container min-vh-100 d-flex align-items-center justify-content-center">
                <section className="card shadow-sm" style={{ maxWidth: 520, width: '100%' }}>
                    <div className="card-body text-center p-5">
                        <i className="bi bi-envelope-check text-primary" style={{ fontSize: '4rem' }} />
                        <h1 className="h3 mt-3">E-Mail-Adresse bestätigen</h1>
                        <p className="text-muted mt-3" id="verificationMessage">{message}</p>
                        <button type="button" id="completeVerification" className="btn btn-primary w-100 mt-3"
                            disabled={disabled} onClick={complete}>
                            E-Mail bestätigen
                        </button>
                        <a href="/index.html" className="btn btn-outline-secondary w-100 mt-2">Zur Startseite</a>
                    </div>
                </section>
            </main>
            <footer className="legal-footer"><a href="/widerruf.html">Widerruf</a></footer>
        </>
    );
}
