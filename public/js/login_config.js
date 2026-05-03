document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');

    const params = new URLSearchParams(window.location.search);

    if (params.get('reason') === 'session_expired') {
        showAlert('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.', 'warning', 8000);
    }

    if (!loginForm) return;

    loginForm.addEventListener('submit', handleLogin);
});

async function handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                password
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            showAlert(errorText || 'Fehler bei der Anmeldung', 'danger');
            return;
        }

        const result = await response.json();

        showAlert(result.message || 'Login erfolgreich!', 'success');

        // 🔥 DAS IST DER WICHTIGE TEIL
        if (result.redirectTo) {
            window.location.href = result.redirectTo;
        } else {
            window.location.href = '/index.html';
        }

    } catch (error) {
        console.error('Login Fehler:', error);
        showAlert('Serverfehler bei der Anmeldung', 'danger');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initPasswordResetModal();
});

function initPasswordResetModal() {
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const requestForm = document.getElementById('passwordResetRequestForm');
    const resetForm = document.getElementById('passwordResetForm');

    const params = new URLSearchParams(window.location.search);
    const resetTokenFromUrl = params.get('resetToken');

    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', event => {
            event.preventDefault();

            document.getElementById('passwordResetRequestForm')?.classList.remove('d-none');
            document.getElementById('passwordResetForm')?.classList.add('d-none');
            document.getElementById('resetEmail').value = '';

            const modal = new bootstrap.Modal(document.getElementById('passwordResetModal'));
            modal.show();
        });
    }

    if (resetTokenFromUrl) {
        document.getElementById('resetToken').value = resetTokenFromUrl;
        document.getElementById('passwordResetRequestForm')?.classList.add('d-none');
        document.getElementById('passwordResetForm')?.classList.remove('d-none');

        const modal = new bootstrap.Modal(document.getElementById('passwordResetModal'));
        modal.show();
    }

    if (requestForm) {
        requestForm.addEventListener('submit', requestPasswordReset);
    }

    if (resetForm) {
        resetForm.addEventListener('submit', submitPasswordReset);
    }
}

async function requestPasswordReset(event) {
    event.preventDefault();

    const email = document.getElementById('resetEmail').value.trim().toLowerCase();

    if (!email) {
        showAlert('Bitte geben Sie Ihre E-Mail-Adresse ein.', 'warning');
        return;
    }

    try {
        const response = await fetch('/password-reset-request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });

        const text = await response.text();

        showAlert(text || 'Wenn die E-Mail existiert, wurde ein Link versendet.', response.ok ? 'success' : 'danger');

        if (response.ok) {
            bootstrap.Modal.getInstance(document.getElementById('passwordResetModal'))?.hide();
        }
    } catch (error) {
        console.error('Fehler beim Anfordern des Passwort-Resets:', error);
        showAlert('Reset-Link konnte nicht angefordert werden.', 'danger');
    }
}

async function submitPasswordReset(event) {
    event.preventDefault();

    const token = document.getElementById('resetToken').value;
    const password = document.getElementById('resetNewPassword').value;
    const passwordConfirm = document.getElementById('resetNewPasswordConfirm').value;

    if (!token) {
        showAlert('Reset-Token fehlt.', 'danger');
        return;
    }

    if (!password || !passwordConfirm) {
        showAlert('Bitte beide Passwortfelder ausfüllen.', 'warning');
        return;
    }

    if (password !== passwordConfirm) {
        showAlert('Die Passwörter stimmen nicht überein.', 'warning');
        return;
    }

    const passwordPolicyRegex = /^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

    if (!passwordPolicyRegex.test(password)) {
        showAlert('Das Passwort muss mindestens 8 Zeichen, eine Zahl und ein Sonderzeichen enthalten.', 'warning');
        return;
    }

    try {
        const response = await fetch('/password-reset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                token,
                password
            })
        });

        const text = await response.text();

        showAlert(text || 'Passwort wurde geändert.', response.ok ? 'success' : 'danger');

        if (response.ok) {
            bootstrap.Modal.getInstance(document.getElementById('passwordResetModal'))?.hide();

            const cleanUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
        }
    } catch (error) {
        console.error('Fehler beim Zurücksetzen des Passworts:', error);
        showAlert('Passwort konnte nicht zurückgesetzt werden.', 'danger');
    }
}