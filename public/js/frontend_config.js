const progress = (value) => {
    document
        .getElementsByClassName('progress-bar')[0]
        .style
        .width = `${value}%`;
}

let step = document.getElementsByClassName('step');
let prevBtn = document.getElementById('prev-btn');
let nextBtn = document.getElementById('next-btn');
let submitBtn = document.getElementById('submit-btn');
let form = document.getElementsByTagName('form')[0];
let preloader = document.getElementById('preloader-wrapper');
let bodyElement = document.querySelector('body');
let succcessDiv = document.getElementById('success');

let current_step = 0;
let stepCount = 5;
step[current_step]
    .classList
    .add('d-block');
if (current_step == 0) {
    prevBtn
        .classList
        .add('d-none');
    submitBtn
        .classList
        .add('d-none');
    nextBtn
        .classList
        .add('d-inline-block');
}

function submitSignature() {
    var dataURL = signaturePad.toDataURL();
    //Konsolenausgabe zur Sendungsüberprüfung des Bildes
    if (dataURL.trim() !== "") {
        document
            .getElementById("Signature")
            .value = dataURL;
        //console.log("Unterschrift erfolgreich generiert");
        //console.log(dataURL);
    } else {
        console.log("Keine Bildübertragung erfolgt");
    }
}

nextBtn.addEventListener('click', async () => {

    // Check if current step is valid before moving to next
    let isValid = true;
    switch (current_step) {
        case 0:
            isValid = validateProductStep();
            break;
        case 1:
            isValid = validateRentalPeriodStep();
            break;
        case 2:
            isValid = validateCustomerDataStep();
            break;
        case 3:
            isValid = validateExtraStepOne();
            break;
        case 4:
            isValid = validateExtraStepTwo();
            break;
        case 5:
            isValid = validateSignatureStep();
            break;
    }

    if (!isValid) {
        return; // Stop the function if the current step is not valid
    }

    current_step++;
    let previous_step = current_step - 1;
    if ((current_step > 0) && (current_step <= stepCount)) {
        prevBtn
            .classList
            .remove('d-none');
        prevBtn
            .classList
            .add('d-inline-block');
        step[current_step]
            .classList
            .remove('d-none');
        step[current_step]
            .classList
            .add('d-block');
        step[previous_step]
            .classList
            .remove('d-block');
        step[previous_step]
            .classList
            .add('d-none');
        if (current_step == stepCount) {
            submitBtn
                .classList
                .remove('d-none');
            submitBtn
                .classList
                .add('d-inline-block');
            nextBtn
                .classList
                .remove('d-inline-block');
            nextBtn
                .classList
                .add('d-none');
        }
    } else {
        if (current_step > stepCount) {
            form.onsubmit = () => {
                return true
            }
        }
    }
    progress((100 / stepCount) * current_step);
});

prevBtn.addEventListener('click', () => {
    if (current_step > 0) {
        current_step--;
        let previous_step = current_step + 1;
        prevBtn
            .classList
            .add('d-none');
        prevBtn
            .classList
            .add('d-inline-block');
        step[current_step]
            .classList
            .remove('d-none');
        step[current_step]
            .classList
            .add('d-block')
        step[previous_step]
            .classList
            .remove('d-block');
        step[previous_step]
            .classList
            .add('d-none');
        if (current_step < stepCount) {
            submitBtn
                .classList
                .remove('d-inline-block');
            submitBtn
                .classList
                .add('d-none');
            nextBtn
                .classList
                .remove('d-none');
            nextBtn
                .classList
                .add('d-inline-block');
            prevBtn
                .classList
                .remove('d-none');
            prevBtn
                .classList
                .add('d-inline-block');
        }
    }

    if (current_step == 0) {
        prevBtn
            .classList
            .remove('d-inline-block');
        prevBtn
            .classList
            .add('d-none');
    }
    progress((100 / stepCount) * current_step);
});

submitBtn.addEventListener('click', (event) => {
    let signatureValid = validateSignatureStep();

    if (!signatureValid) {
        event.preventDefault();
    } else {

        preloader
            .classList
            .add('d-block');

        const timer = ms => new Promise(res => setTimeout(res, ms));

        timer(0)
            .then(() => {
                bodyElement.classList.add('loaded');
            })
            .then(() => {
                step[stepCount].classList.remove('d-block');
                step[stepCount].classList.add('d-none');

                prevBtn.classList.remove('d-inline-block');
                prevBtn.classList.add('d-none');

                submitBtn.classList.remove('d-inline-block');
                submitBtn.classList.add('d-none');

                succcessDiv.classList.remove('d-none');
                succcessDiv.classList.add('d-block');
            });
    }
});

function logout() {
    fetch('/logout', {
        method: 'POST'
    })
        .then(response => {
            if (response.ok) {
                // Optional: Weiterleitung zur Login-Seite oder Anzeige einer Bestätigung
                window.location.href = '/index.html';
            } else {
                console.error('Fehler beim Logout');
                alert('Fehler beim Abmelden');
            }
        })
        .catch(error => {
            console.error('Netzwerkfehler beim Versuch, sich abzumelden:', error);
        });
}

// ==========================
// AUTH STATUS HANDLING
// ==========================
document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById('admin-button');
    const loginStatus = document.getElementById('login-status');
    const logoutBtn = document.getElementById('logout-button');

    // Falls Seite kein Login-Bereich hat (z.B. backend.html), einfach abbrechen
    if (!btn || !loginStatus || !logoutBtn) return;

    fetch('/auth-status')
        .then(res => res.json())
        .then(data => {
            const registerBtn = document.getElementById('register-button');
            const profileBtn = document.getElementById('profile-button');
            if (data.loggedIn && data.role === 'global_admin') {
                // Button → Konfiguration
                btn.href = '/backend.html';
                btn.querySelector('button').innerHTML =
                    '<i class="bi bi-gear"></i> Konfiguration';
                logoutBtn.style.display = 'inline-block';
                loginStatus.textContent = `Angemeldet als: ${data.user}`;
            } else if (data.loggedIn) {
                btn.href = '#';
                btn.querySelector('button').innerHTML =
                    '<i class="bi bi-person-check"></i> Eingeloggt';

                logoutBtn.style.display = 'inline-block';
                loginStatus.textContent = `Angemeldet als: ${data.user}`;
                // Logout anzeigen
                logoutBtn.style.display = 'inline-block';

                // User anzeigen
                loginStatus.textContent = `Angemeldet als: ${data.user}`;

                if (profileBtn) {
                    profileBtn.style.display = 'inline-block';
                }
                if (registerBtn) {
                    registerBtn.style.display = 'none';
                }

                loadUserProfileIntoForm();
            } else {
                btn.href = '/login.html';
                btn.querySelector('button').innerHTML =
                    '<i class="bi bi-person-lock"></i> Login';

                logoutBtn.style.display = 'none';
                loginStatus.textContent = 'Kein Benutzer angemeldet';

                if (registerBtn) {
                    registerBtn.style.display = 'inline-block';
                }
            }
        })
        .catch(err => {
            console.error('Auth-Status Fehler:', err);
        });
});

document.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => {
        document
            .querySelectorAll('.product-card')
            .forEach(c => c.classList.remove('selected'));

        card.classList.add('selected');

        document.getElementById('RentalProduct').value =
            card.dataset.product;
    });
});

let selectedProductCard = null;

document.addEventListener("DOMContentLoaded", () => {
    const modalElement = document.getElementById('productDetailsModal');
    const selectProductFromModalBtn = document.getElementById('selectProductFromModal');

    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', () => {
            selectProductCard(card);
        });

        const detailsButton = card.querySelector('.product-details-btn');

        if (detailsButton) {
            detailsButton.addEventListener('click', (event) => {
                event.stopPropagation();
                selectedProductCard = card;
                showProductDetails(card);
            });
        }
    });

    if (selectProductFromModalBtn) {
        selectProductFromModalBtn.addEventListener('click', () => {
            if (!selectedProductCard) return;

            selectProductCard(selectedProductCard);

            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) {
                modal.hide();
            }
        });
    }
});

function selectProductCard(card) {
    document
        .querySelectorAll('.product-card')
        .forEach(c => c.classList.remove('selected'));

    card.classList.add('selected');

    document.getElementById('RentalProduct').value = card.dataset.product;
}

function showProductDetails(card) {
    document.getElementById('modalProductTitle').textContent = card.dataset.title;
    document.getElementById('modalProductDescription').textContent = card.dataset.description;
    document.getElementById('modalProductPrice').textContent = card.dataset.price;
    document.getElementById('modalProductDeposit').textContent = card.dataset.deposit;

    const modal = new bootstrap.Modal(document.getElementById('productDetailsModal'));
    modal.show();
}

document.addEventListener('DOMContentLoaded', () => {
    const startInput = document.getElementById('RentalStartDate');
    const endInput = document.getElementById('RentalEndDate');
    const infoBox = document.getElementById('rentalDurationInfo');

    if (!startInput || !endInput || !infoBox) return;

    const today = new Date().toISOString().split('T')[0];
    startInput.min = today;
    endInput.min = today;

    function updateRentalDurationInfo() {
        const startDate = startInput.value;
        const endDate = endInput.value;

        if (!startDate || !endDate) {
            infoBox.classList.add('d-none');
            startInput.addEventListener('change', () => {
                endInput.min = startInput.value;
                endInput.value = '';

                infoBox.classList.add('d-none');

                updateRentalDurationInfo();
            });
            return;
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (end < start) {
            infoBox.classList.remove('d-none');
            infoBox.classList.remove('alert-info');
            infoBox.classList.add('alert-danger');
            infoBox.textContent = 'Das Mietende darf nicht vor dem Mietbeginn liegen.';
            return;
        }

        const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
        infoBox.classList.remove('d-none');
        infoBox.classList.remove('alert-danger');
        infoBox.classList.add('alert-info');
        infoBox.textContent = `Ausgewählter Mietzeitraum: ${days} Tag${days === 1 ? '' : 'e'}`;
    }

    startInput.addEventListener('change', () => {
        endInput.min = startInput.value;
        endInput.value = '';
        updateRentalDurationInfo();
    });

    endInput.addEventListener('change', updateRentalDurationInfo);
});

async function loadUserProfileIntoForm() {
    try {
        const response = await fetch('/my-profile');

        if (!response.ok) {
            return;
        }

        const user = await response.json();

        document.getElementById('FirstName').value = user.firstName || '';
        document.getElementById('LastName').value = user.lastName || '';
        document.getElementById('CustomerEmail').value = user.email || '';
        document.getElementById('CustomerPhone').value = user.phone || '';
        document.getElementById('CustomerAddress').value = user.address || '';
        document.getElementById('CustomerZip').value = user.zip || '';
        document.getElementById('CustomerCity').value = user.city || '';

    } catch (error) {
        console.error('Fehler beim Vorbefüllen der Kundendaten:', error);
    }
}

function validateProductStep() {
    const selectedProduct = document.getElementById('RentalProduct').value;

    if (!selectedProduct) {
        alert('Bitte wählen Sie ein Produkt aus.');
        return false;
    }

    return true;
}

function validateRentalPeriodStep() {
    const startDate = document.getElementById('RentalStartDate').value;
    const endDate = document.getElementById('RentalEndDate').value;

    if (!startDate || !endDate) {
        alert('Bitte wählen Sie Mietbeginn und Mietende aus.');
        return false;
    }

    if (new Date(endDate) < new Date(startDate)) {
        alert('Das Mietende darf nicht vor dem Mietbeginn liegen.');
        return false;
    }

    return true;
}

function validateCustomerDataStep() {
    const requiredFields = [
        'FirstName',
        'LastName',
        'CustomerEmail',
        'CustomerPhone',
        'CustomerAddress',
        'CustomerZip',
        'CustomerCity'
    ];

    for (const fieldId of requiredFields) {
        const field = document.getElementById(fieldId);

        if (!field || !field.value.trim()) {
            alert('Bitte füllen Sie alle persönlichen Daten aus.');
            return false;
        }
    }

    return true;
}

function validateExtraStepOne() {
    return true;
}

function validateExtraStepTwo() {
    return true;
}

function validateSignatureStep() {
    let isValid = true;

    if (signaturePad.isEmpty()) {
        alert('Bitte leisten Sie Ihre Unterschrift.');
        isValid = false;
    }

    if (!document.getElementById('agbs').checked) {
        alert('Bitte stimmen Sie den Allgemeinen Geschäftsbedingungen zu.');
        isValid = false;
    }

    if (!document.getElementById('dsgvo').checked) {
        alert('Bitte stimmen Sie der Datenschutzerklärung zu.');
        isValid = false;
    }

    return isValid;
}