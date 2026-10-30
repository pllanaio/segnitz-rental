import PageHead from '../components/PageHead';

export default function EmailVerifiedPage() {
    return (
        <>
            <PageHead title="E-Mail bestätigt - Segnitz Rental" />
            <div className="container min-vh-100 d-flex align-items-center justify-content-center">
                <div className="card shadow-sm" style={{ maxWidth: 520, width: '100%' }}>
                    <div className="card-body text-center p-5">
                        <i className="bi bi-check-circle-fill text-success" style={{ fontSize: '4rem' }} />
                        <h3 className="mt-3">E-Mail erfolgreich bestätigt</h3>
                        <p className="text-muted mt-3">
                            Ihre E-Mail-Adresse wurde erfolgreich bestätigt.
                            Sie können sich jetzt mit Ihrem Kundenkonto einloggen.
                        </p>
                        <a href="/login.html" className="btn btn-primary w-100 mt-3">
                            <i className="bi bi-person-lock" /> Jetzt einloggen
                        </a>
                        <a href="/index.html" className="btn btn-outline-secondary w-100 mt-2">Zur Startseite</a>
                    </div>
                </div>
            </div>
            <footer className="legal-footer"><a href="/widerruf.html">Widerruf</a></footer>
        </>
    );
}
