document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');

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
            showGlobalAlert(result.error || result.message || 'Login fehlgeschlagen.', 'danger');
            return;
        }

        window.location.href = result.redirectTo || '/index.html';
    });
});