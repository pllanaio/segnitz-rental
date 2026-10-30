import { useEffect, useRef, useState } from 'react';
import PageHead from '../components/PageHead';
import GlobalAlerts from '../components/GlobalAlerts';
import Preloader from '../components/Preloader';
import { SidebarLegal, SidebarLogo } from '../components/SidebarBrand';
import { showAlert } from '../lib/alerts';
import { getModal, hideModal } from '../lib/bootstrap';

export default function LoginPage() {
    const modalRef = useRef(null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [resetMode, setResetMode] = useState('request');
    const [resetEmail, setResetEmail] = useState('');
    const [resetToken, setResetToken] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newPasswordConfirm, setNewPasswordConfirm] = useState('');

    useEffect(() => {
        const queryParams = new URLSearchParams(window.location.search);
        const fragmentParams = new URLSearchParams(window.location.hash.slice(1));
        const token = fragmentParams.get('resetToken') || queryParams.get('resetToken');

        if (!token) return;

        // The token must not stay in the address bar or browser history.
        window.history.replaceState({}, document.title, '/login.html');
        setResetToken(token);
        setResetMode('reset');
        getModal(modalRef.current).show();
    }, []);

    const submitLogin = async event => {
        event.preventDefault();

        const res = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username.trim(), password })
        });

        const contentType = res.headers.get('content-type') || '';
        const result = contentType.includes('application/json')
            ? await res.json()
            : { message: await res.text() };

        if (!res.ok) {
            showAlert(result.error || result.message || 'Login fehlgeschlagen.', 'danger');
            return;
        }

        window.location.href = result.redirectTo || '/index.html';
    };

    const openPasswordReset = event => {
        event.preventDefault();
        setResetMode('request');
        getModal(modalRef.current).show();
    };

    const submitResetRequest = async event => {
        event.preventDefault();

        const email = resetEmail.trim();

        if (!email) {
            showAlert('Bitte geben Sie Ihre E-Mail-Adresse ein.', 'warning');
            return;
        }

        const response = await fetch('/password-reset-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const text = await response.text();

        if (!response.ok) {
            showAlert(text || 'Reset-Link konnte nicht angefordert werden.', 'danger');
            return;
        }

        showAlert(text || 'Wenn die E-Mail existiert, wurde ein Link versendet.', 'success');
        hideModal(modalRef.current);
    };

    const submitPasswordReset = async event => {
        event.preventDefault();

        if (!newPassword || !newPasswordConfirm) {
            showAlert('Bitte beide Passwortfelder ausfüllen.', 'warning');
            return;
        }

        if (newPassword !== newPasswordConfirm) {
            showAlert('Die Passwörter stimmen nicht überein.', 'warning');
            return;
        }

        const response = await fetch('/password-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: resetToken, password: newPassword })
        });

        const text = await response.text();

        if (!response.ok) {
            showAlert(text || 'Passwort konnte nicht zurückgesetzt werden.', 'danger');
            return;
        }

        showAlert('Passwort wurde erfolgreich geändert. Sie können sich jetzt einloggen.', 'success');

        hideModal(modalRef.current);
        window.history.replaceState({}, document.title, '/login.html');
    };

    return (
        <>
            <PageHead title="Segnitz Rental" referrer="no-referrer" />
            <GlobalAlerts />
            <div className="container-fluid min-vh-100 p-0">
                <div className="row g-0 min-vh-100">
                    <aside className="col-12 col-md-3 col-xl-2 bg-primary text-white p-4">
                        <SidebarLogo />
                        <a href="/index.html">
                            <button type="button" className="btn btn-light w-100 mt-4">
                                <i className="bi bi-arrow-left-circle" /> Zurück zur Startseite
                            </button>
                        </a>
                        <SidebarLegal />
                    </aside>

                    <main className="col-12 col-md-9 col-xl-10 p-4 p-lg-5">
                        <div id="qbox-container_form" className="w-100">
                            <form className="needs-validation" id="loginForm" method="post" name="loginForm" onSubmit={submitLogin}>
                                <div id="steps-container">
                                    <div className="step d-block">
                                        <div id="login" className="mx-auto" style={{ maxWidth: 480 }}>
                                            <h4 className="mb-4">Einloggen</h4>

                                            <input type="text" className="form-control" id="username"
                                                placeholder="Benutzername eingeben" value={username}
                                                onChange={event => setUsername(event.target.value)} />

                                            <br />

                                            <input type="password" className="form-control" id="password"
                                                placeholder="Passwort eingeben" value={password}
                                                onChange={event => setPassword(event.target.value)} />

                                            <br />

                                            <button type="submit" className="btn btn-primary w-100">Einloggen</button>
                                            <p className="mt-2 text-center">
                                                <a href="#" id="forgotPasswordLink" className="link-primary" onClick={openPasswordReset}>
                                                    Passwort vergessen?
                                                </a>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </main>
                </div>
            </div>
            <Preloader />

            <div className="modal fade" id="passwordResetModal" tabIndex={-1} aria-hidden="true" ref={modalRef}>
                <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h5 className="modal-title">Passwort zurücksetzen</h5>
                            <button type="button" className="btn-close" data-bs-dismiss="modal" />
                        </div>

                        <div className="modal-body">
                            <form id="passwordResetRequestForm" className={resetMode === 'request' ? undefined : 'd-none'}
                                onSubmit={submitResetRequest}>
                                <label className="form-label" htmlFor="resetEmail">E-Mail-Adresse</label>
                                <input type="email" id="resetEmail" className="form-control" required
                                    value={resetEmail} onChange={event => setResetEmail(event.target.value)} />

                                <button type="submit" className="btn btn-primary w-100 mt-3">Reset-Link anfordern</button>
                            </form>

                            <form id="passwordResetForm" className={resetMode === 'reset' ? 'mt-3' : 'd-none mt-3'}
                                onSubmit={submitPasswordReset}>
                                <input type="hidden" id="resetToken" value={resetToken} readOnly />

                                <label className="form-label" htmlFor="resetNewPassword">Neues Passwort</label>
                                <input type="password" id="resetNewPassword" className="form-control" required
                                    value={newPassword} onChange={event => setNewPassword(event.target.value)} />

                                <label className="form-label mt-2" htmlFor="resetNewPasswordConfirm">Neues Passwort wiederholen</label>
                                <input type="password" id="resetNewPasswordConfirm" className="form-control" required
                                    value={newPasswordConfirm} onChange={event => setNewPasswordConfirm(event.target.value)} />

                                <button type="submit" className="btn btn-success w-100 mt-3">Passwort speichern</button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
