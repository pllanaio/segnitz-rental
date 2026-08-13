'use strict';

document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('setupForm');
    const submitButton = document.getElementById('setupSubmit');
    const messageBox = document.getElementById('setupMessage');

    function showMessage(message, type = 'danger') {
        messageBox.textContent = message;
        messageBox.className = `alert alert-${type}`;
        messageBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function setSubmitting(submitting) {
        submitButton.disabled = submitting;
        submitButton.innerHTML = submitting
            ? '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Einrichtung läuft...'
            : '<i class="bi bi-person-check-fill me-1" aria-hidden="true"></i> Adminkonto erstellen';
    }

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
    } catch (error) {
        showMessage(error.message || 'Installationsstatus konnte nicht geladen werden.');
        submitButton.disabled = true;
        return;
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();

        const password = document.getElementById('password').value;
        const passwordRepeat = document.getElementById('passwordRepeat').value;
        const passwordPolicy = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,128}$/;

        if (!form.reportValidity()) return;

        if (password !== passwordRepeat) {
            showMessage('Die Passwörter stimmen nicht überein.');
            document.getElementById('passwordRepeat').focus();
            return;
        }

        if (!passwordPolicy.test(password)) {
            showMessage(
                'Das Passwort benötigt mindestens 12 Zeichen, Groß- und Kleinbuchstaben, eine Zahl und ein Sonderzeichen.'
            );
            document.getElementById('password').focus();
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
                    setupToken: document.getElementById('setupToken').value,
                    firstName: document.getElementById('firstName').value.trim(),
                    lastName: document.getElementById('lastName').value.trim(),
                    email: document.getElementById('email').value.trim(),
                    password
                })
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(result.error || 'Die Ersteinrichtung ist fehlgeschlagen.');
            }

            showMessage(result.message, 'success');
            window.setTimeout(() => {
                window.location.replace(result.redirectTo || '/backend.html');
            }, 500);
        } catch (error) {
            showMessage(error.message || 'Die Ersteinrichtung ist fehlgeschlagen.');
            setSubmitting(false);
        }
    });
});
