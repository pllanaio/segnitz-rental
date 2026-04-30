document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
        firstName: firstName.value.trim(),
        lastName: lastName.value.trim(),
        email: email.value.trim(),
        phone: phone.value.trim(),
        address: address.value.trim(),
        zip: zip.value.trim(),
        city: city.value.trim(),
        password: password.value
    };

    if (password.value !== passwordRepeat.value) {
        showMsg('Passwörter stimmen nicht überein', 'danger');
        return;
    }

    const res = await fetch('/register-customer', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });

    const result = await res.json();

    if (!res.ok) {
        showMsg(result.error || 'Fehler', 'danger');
        return;
    }

    showMsg('Registrierung erfolgreich! Bitte E-Mail bestätigen.', 'success');

    document.getElementById('registerForm').reset();
});

function showMsg(text, type) {
    const box = document.getElementById('msg');
    box.className = `alert alert-${type}`;
    box.textContent = text;
    box.classList.remove('d-none');
}