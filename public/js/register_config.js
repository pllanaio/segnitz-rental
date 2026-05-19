document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('registerForm');
    const submitButton = document.getElementById('registerSubmitButton');

    const fields = {
        firstName: document.getElementById('firstName'),
        lastName: document.getElementById('lastName'),
        company: document.getElementById('company'),
        email: document.getElementById('email'),
        phone: document.getElementById('phone'),
        address: document.getElementById('address'),
        zip: document.getElementById('zip'),
        city: document.getElementById('city'),
        password: document.getElementById('password'),
        passwordRepeat: document.getElementById('passwordRepeat')
    };

    const requiredFieldIds = [
        'firstName',
        'lastName',
        'email',
        'phone',
        'address',
        'zip',
        'city',
        'password',
        'passwordRepeat'
    ];

    function setFieldInvalid(field, message) {
        field.classList.add('is-invalid');
        field.setAttribute('aria-invalid', 'true');

        const feedback = document.getElementById(`${field.id}Feedback`);
        if (feedback) feedback.textContent = message;
    }

    function clearFieldInvalid(field) {
        field.classList.remove('is-invalid');
        field.removeAttribute('aria-invalid');
    }

    function validateRequiredFields() {
        let isValid = true;
        let firstInvalidField = null;

        requiredFieldIds.forEach((fieldId) => {
            const field = fields[fieldId];
            clearFieldInvalid(field);

            if (!field.value.trim()) {
                isValid = false;
                firstInvalidField = firstInvalidField || field;
                setFieldInvalid(field, 'Dieses Pflichtfeld muss ausgefüllt werden.');
            }
        });

        if (
            fields.password.value &&
            fields.passwordRepeat.value &&
            fields.password.value !== fields.passwordRepeat.value
        ) {
            isValid = false;
            firstInvalidField = firstInvalidField || fields.passwordRepeat;
            setFieldInvalid(fields.passwordRepeat, 'Die Passwörter stimmen nicht überein.');
        }

        if (firstInvalidField) firstInvalidField.focus();

        return isValid;
    }

    requiredFieldIds.forEach((fieldId) => {
        const field = fields[fieldId];

        field.addEventListener('input', () => {
            if (field.value.trim()) clearFieldInvalid(field);

            if (
                (fieldId === 'password' || fieldId === 'passwordRepeat') &&
                fields.password.value &&
                fields.passwordRepeat.value &&
                fields.password.value === fields.passwordRepeat.value
            ) {
                clearFieldInvalid(fields.passwordRepeat);
            }
        });
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (submitButton.disabled) return;

        if (!validateRequiredFields()) {
            showMsg('Bitte füllen Sie alle rot markierten Pflichtfelder aus.', 'danger');
            return;
        }

        const data = {
            firstName: fields.firstName.value.trim(),
            lastName: fields.lastName.value.trim(),
            company: fields.company.value.trim(),
            email: fields.email.value.trim(),
            phone: fields.phone.value.trim(),
            address: fields.address.value.trim(),
            zip: fields.zip.value.trim(),
            city: fields.city.value.trim(),
            password: fields.password.value
        };

        submitButton.disabled = true;
        submitButton.innerHTML =
            '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Registrierung läuft...';

        try {
            const res = await fetch('/register-customer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await res.json().catch(() => ({}));

            if (!res.ok) {
                showMsg(result.error || 'Fehler bei der Registrierung.', 'danger');
                return;
            }

            showMsg('Registrierung erfolgreich! Bitte E-Mail bestätigen.', 'success');
            form.reset();
            requiredFieldIds.forEach((fieldId) => clearFieldInvalid(fields[fieldId]));
        } catch (error) {
            console.error('Registrierung fehlgeschlagen:', error);
            showMsg('Die Registrierung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.', 'danger');
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = '<i class="bi bi-person-plus"></i> Registrieren';
        }
    });
});

function showMsg(text, type) {
    const box = document.getElementById('msg');
    box.className = `alert alert-${type}`;
    box.textContent = text;
    box.classList.remove('d-none');
}