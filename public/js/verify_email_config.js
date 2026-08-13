'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('completeVerification');
    const message = document.getElementById('verificationMessage');
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('token') || '';

    window.history.replaceState({}, document.title, '/verify-email.html');

    if (!/^[a-f0-9]{64}$/.test(token)) {
        message.textContent = 'Der Bestätigungslink ist ungültig oder unvollständig.';
        button.disabled = true;
        return;
    }

    button.addEventListener('click', async () => {
        button.disabled = true;
        message.textContent = 'Die E-Mail-Adresse wird bestätigt …';

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
            message.textContent = error.message;
            button.disabled = false;
        }
    });
});
