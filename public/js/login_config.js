document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const passwordResetModalEl = document.getElementById('passwordResetModal');
    const passwordResetRequestForm = document.getElementById('passwordResetRequestForm');
    const passwordResetForm = document.getElementById('passwordResetForm');

    const passwordResetModal = passwordResetModalEl
        ? new bootstrap.Modal(passwordResetModalEl)
        : null;

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;

            const res = await fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
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
        });
    }

    if (forgotPasswordLink && passwordResetModal) {
        forgotPasswordLink.addEventListener('click', (event) => {
            event.preventDefault();

            passwordResetRequestForm.classList.remove('d-none');
            passwordResetForm.classList.add('d-none');
            passwordResetModal.show();
        });
    }

    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get('resetToken');

    if (resetToken && passwordResetModal) {
        document.getElementById('resetToken').value = resetToken;

        passwordResetRequestForm.classList.add('d-none');
        passwordResetForm.classList.remove('d-none');

        passwordResetModal.show();
    }

    if (passwordResetRequestForm) {
        passwordResetRequestForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const email = document.getElementById('resetEmail').value.trim();

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
            passwordResetModal.hide();
        });
    }

    if (passwordResetForm) {
        passwordResetForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const token = document.getElementById('resetToken').value;
            const password = document.getElementById('resetNewPassword').value;
            const passwordConfirm = document.getElementById('resetNewPasswordConfirm').value;

            if (!password || !passwordConfirm) {
                showAlert('Bitte beide Passwortfelder ausfüllen.', 'warning');
                return;
            }

            if (password !== passwordConfirm) {
                showAlert('Die Passwörter stimmen nicht überein.', 'warning');
                return;
            }

            const response = await fetch('/password-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password })
            });

            const text = await response.text();

            if (!response.ok) {
                showAlert(text || 'Passwort konnte nicht zurückgesetzt werden.', 'danger');
                return;
            }

            showAlert('Passwort wurde erfolgreich geändert. Sie können sich jetzt einloggen.', 'success');

            passwordResetModal.hide();
            window.history.replaceState({}, document.title, '/login.html');
        });
    }
});