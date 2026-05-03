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