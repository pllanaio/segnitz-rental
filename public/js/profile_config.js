document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/my-profile');

        if (!response.ok) {
            window.location.href = '/login.html';
            return;
        }

        const user = await response.json();

        document.getElementById('customerNo').textContent = user.customerNo || '-';
        document.getElementById('name').textContent = `${user.firstName || ''} ${user.lastName || ''}`.trim();
        document.getElementById('email').textContent = user.email || '-';
        document.getElementById('phone').textContent = user.phone || '-';
        document.getElementById('address').textContent =
            `${user.address || ''}, ${user.zip || ''} ${user.city || ''}`.trim();

        document.getElementById('verified').textContent =
            user.emailVerified === 1 ? 'Ja' : 'Nein';

        document.getElementById('profileBox').classList.remove('d-none');

    } catch (error) {
        const box = document.getElementById('profileError');
        box.textContent = 'Profil konnte nicht geladen werden.';
        box.classList.remove('d-none');
    }
});