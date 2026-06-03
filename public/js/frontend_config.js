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
let guestVerificationRequested = false;
let guestEmailVerified = false;
let rentalProducts = [];
let currentProductPage = 1;
const productsPerPage = 12;
let filteredRentalProducts = [];
let currentCart = {
    cartId: null,
    items: []
};
let productCalendar = null;
let cartEditCalendar = null;
let selectedCategory = 'all';
let current_step = 0;
let stepCount = 3;
let bestsellerProducts = [];
let currentModalProductReviews = [];
const VAT_RATE = 0.19;

function syncMainNextButtonVisibility() {
    if (!nextBtn) return;

    const items = currentCart.items || [];

    const shouldShow =
        (current_step === 0 && items.length > 0) ||
        (current_step > 0 && current_step < stepCount);

    nextBtn.classList.toggle('d-none', !shouldShow);
    nextBtn.classList.toggle('d-inline-block', shouldShow);
}

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const paymentContext = params.get('payment');
    const paymentType = params.get('paymentType');
    const itemId = params.get('itemId');

    if (!['return', 'extension', 'return_charge'].includes(paymentContext)) {
        return;
    }

    const orderId = params.get('orderId');
    const finalDiv = document.getElementById('final');
    const resultIcon = document.getElementById('paymentResultIcon');
    const resultTitle = document.getElementById('paymentResultTitle');
    const resultText = document.getElementById('paymentResultText');

    Array.from(step).forEach(stepElement => {
        stepElement.classList.remove('d-block');
        stepElement.classList.add('d-none');
    });

    prevBtn.classList.add('d-none');
    nextBtn.classList.add('d-none');
    submitBtn.classList.add('d-none');
    succcessDiv.classList.remove('d-none');
    succcessDiv.classList.add('d-block');

    const wizardButtons = document.getElementById('q-box__buttons');

    if (wizardButtons) {
        wizardButtons.style.display = 'none';
    }

    progress(100);

    const successMessages = {
        return: {
            title: 'Mietvorgang erfolgreich bezahlt',
            text: 'Vielen Dank! Ihre Zahlung wurde erfolgreich bestätigt.',
            body: 'Ihre Reservierung wurde erfolgreich bezahlt.'
        },
        extension: {
            title: 'Mietzeitraum erfolgreich verlängert',
            text: 'Die Nachzahlung für die Verlängerung wurde erfolgreich bestätigt.',
            body: 'Ihr verlängerter Mietzeitraum ist nun bezahlt.'
        },
        return_charge: {
            title: 'Nachzahlung erfolgreich bezahlt',
            text: 'Die Nachzahlung aus der Rückgabe wurde erfolgreich bestätigt.',
            body: 'Der Rückgabefall wurde bezahlt und kann abgeschlossen werden.'
        }
    };

    const statusMessages = {
        failed: 'Die Zahlung ist fehlgeschlagen.',
        expired: 'Die Zahlung ist abgelaufen.',
        cancelled: 'Die Zahlung wurde abgebrochen.',
        canceled: 'Die Zahlung wurde abgebrochen.',
        authorized: 'Die Zahlung wurde autorisiert, aber noch nicht endgültig eingezogen.',
        pending: 'Die Zahlung wurde noch nicht bestätigt.'
    };

    const setPaymentErrorView = (status) => {
        const message = statusMessages[status] || statusMessages.pending;

        if (resultIcon) {
            resultIcon.innerHTML = '<i class="bi bi-x-lg"></i>';
            resultIcon.className = 'success-icon payment-error-icon';
        }

        if (resultTitle) {
            resultTitle.textContent = 'Zahlung nicht abgeschlossen';
        }

        if (resultText) {
            resultText.textContent = message;
        }

        if (finalDiv) {
            finalDiv.innerHTML = `
                <div class="alert alert-warning">
                    ${message}<br>
                    Falls Sie vor Ort bezahlen möchten, kommen Sie während unserer Öffnungszeiten vorbei.
                </div>
            `;
        }
    };

    const setPaymentSuccessView = (order) => {
        const message = successMessages[paymentContext] || successMessages.return;

        if (resultIcon) {
            resultIcon.innerHTML = '<i class="bi bi-check-lg"></i>';
            resultIcon.className = 'success-icon';
        }

        if (resultTitle) {
            resultTitle.textContent = message.title;
        }

        if (resultText) {
            resultText.textContent = message.text;
        }

        if (finalDiv) {
            finalDiv.innerHTML = `
                <div class="alert alert-success">
                    ${message.body}<br>
                    Bestellnummer: <strong>${order.orderNo || order.order_no || orderId}</strong>
                </div>
            `;
        }
    };

    if (!orderId || !finalDiv) {
        setPaymentErrorView('failed');
        return;
    }

    try {
        const queryParams = new URLSearchParams();

        if (paymentType) {
            queryParams.set('paymentType', paymentType);
        }

        if (itemId) {
            queryParams.set('itemId', itemId);
        }

        const query = queryParams.toString()
            ? `?${queryParams.toString()}`
            : '';

        const response = await fetch(`/orders/${orderId}/payment-status${query}`);
        const order = await response.json();

        if (!response.ok) {
            throw new Error(order.error || 'Status konnte nicht geladen werden.');
        }

        const status = order.payment_status || order.paymentStatus;

        if (status === 'paid') {

            const wizardButtons = document.getElementById('q-box__buttons');

            if (wizardButtons) {
                wizardButtons.style.display = 'none';
            }

            setPaymentSuccessView(order);
            return;
        }

        setPaymentErrorView(status);
    } catch (error) {
        console.error('Fehler beim Prüfen des Zahlungsstatus:', error);
        setPaymentErrorView('pending');
    }
});

async function retryMolliePayment(orderId) {
    try {
        const response = await fetch(`/orders/${orderId}/mollie-checkout`, {
            method: 'POST'
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Zahlung konnte nicht erneut gestartet werden.', 'danger');
            return;
        }

        window.location.href = result.checkoutUrl;
    } catch (error) {
        console.error('Fehler beim erneuten Starten der Zahlung:', error);
        showAlert('Zahlung konnte nicht erneut gestartet werden.', 'danger');
    }
}

step[current_step]
    .classList
    .add('d-block');
if (current_step == 0) {
    prevBtn.classList.add('d-none');
    submitBtn.classList.add('d-none');
    syncMainNextButtonVisibility();
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
            isValid = await validateProductStep();
            break;
        case 1:
            await loadCart();
            renderCartReview();
            isValid = validateCartReviewStep();
            break;
        case 2:
            isValid = validateCustomerDataStep();
            break;
        case 3:
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

    syncMainNextButtonVisibility();

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
            syncMainNextButtonVisibility();
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

    syncMainNextButtonVisibility();

    progress((100 / stepCount) * current_step);

});

function serializeFormToStepJson() {
    const steps = Array.from(document.querySelectorAll('#steps-container .step'));

    return steps.map((stepElement, index) => {
        const fields = Array.from(
            stepElement.querySelectorAll('input, select, textarea')
        );

        return {
            step: index + 1,
            elements: fields
                .filter(field => field.name)
                .map(field => {
                    const element = {
                        name: field.name,
                        value: field.type === 'checkbox'
                            ? (field.checked ? 'on' : '')
                            : field.value
                    };

                    if (field.type === 'checkbox' || field.type === 'radio') {
                        element.checked = field.checked;
                    }

                    return element;
                })
        };
    });
}

submitBtn.addEventListener('click', async (event) => {
    event.preventDefault();

    submitSignature();

    const signatureValid = validateSignatureStep();

    if (!signatureValid) {
        return;
    }

    const selectedPaymentMethod = document.querySelector('input[name="paymentMethod"]:checked');

    if (!selectedPaymentMethod) {
        showAlert('Bitte wählen Sie eine Zahlungsart aus.', 'warning');
        submitBtn.disabled = false;
        return;
    }

    console.log('Gewählte Zahlungsart:', selectedPaymentMethod.value);

    const formData = serializeFormToStepJson();

    const step3 = formData.find(step => step.step === 4);

    if (step3) {
        step3.elements = step3.elements.filter(
            element => element.name !== 'paymentMethod'
        );

        step3.elements.push({
            name: 'paymentMethod',
            value: selectedPaymentMethod.value,
            checked: true
        });
    }

    try {
        preloader.classList.add('d-block');
        submitBtn.disabled = true;

        const response = await fetch('/data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                form: formData,
                paymentMethod: selectedPaymentMethod.value
            })
        });

        const result = await response.json();

        if (!response.ok) {
            preloader.classList.remove('d-block');
            bodyElement.classList.remove('loaded');
            submitBtn.disabled = false;

            if (response.status === 409) {
                showAlert(
                    `${result.error} <a href="/login.html" class="alert-link">Hier klicken, um sich einzuloggen.</a>`,
                    'warning',
                    8000
                );
                return;
            }

            showAlert(result.error || 'Bestellung konnte nicht abgeschlossen werden.', 'danger');
            return;
        }

        if (result.checkoutUrl) {
            window.location.href = result.checkoutUrl;
            return;
        }

        bodyElement.classList.add('loaded');

        step[stepCount].classList.remove('d-block');
        step[stepCount].classList.add('d-none');

        prevBtn.classList.remove('d-inline-block');
        prevBtn.classList.add('d-none');

        submitBtn.classList.remove('d-inline-block');
        submitBtn.classList.add('d-none');

        nextBtn.classList.remove('d-inline-block');
        nextBtn.classList.add('d-none');

        succcessDiv.classList.remove('d-none');
        succcessDiv.classList.add('d-block');

        if (result.pdfUrl) {
            window.open(result.pdfUrl, '_blank');
        }

    } catch (error) {
        console.error('Fehler beim Absenden der Bestellung:', error);

        preloader.classList.remove('d-block');
        bodyElement.classList.remove('loaded');
        submitBtn.disabled = false;

        showAlert('Bestellung konnte nicht abgeschlossen werden.', 'danger');
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
                showAlert('Fehler beim Abmelden', 'danger');
            }
        })
        .catch(error => {
            console.error('Netzwerkfehler beim Versuch, sich abzumelden:', error);
            showAlert('Netzwerkfehler', 'danger');
        });
}

// ==========================
// AUTH STATUS HANDLING
// ==========================
document.addEventListener("DOMContentLoaded", () => {
    const adminBtn = document.getElementById('admin-button');
    const loginStatus = document.getElementById('login-status');
    const logoutBtn = document.getElementById('logout-button');
    const registerBtn = document.getElementById('register-button');
    const profileBtn = document.getElementById('profile-button');
    const guestOrderWrapper = document.getElementById('guestOrderWrapper');

    if (!adminBtn || !loginStatus || !logoutBtn) return;

    fetch('/auth-status')
        .then(res => res.json())
        .then(data => {
            if (data.loggedIn) {
                registerBtn.style.display = 'none';
                logoutBtn.style.display = 'block';
                profileBtn.style.display = 'block';

                loginStatus.textContent = `Angemeldet als: ${data.user}`;

                if (guestOrderWrapper) {
                    guestOrderWrapper.style.display = 'none';
                }

                if (data.role === 'global_admin') {
                    adminBtn.href = '/backend.html';
                    adminBtn.querySelector('button').innerHTML =
                        '<i class="bi bi-gear"></i> Konfiguration';
                } else {
                    adminBtn.href = '#';
                    adminBtn.querySelector('button').innerHTML =
                        '<i class="bi bi-person-check"></i> Eingeloggt';

                    loadUserProfileIntoForm();
                }
            } else {
                adminBtn.href = '/login.html';
                adminBtn.querySelector('button').innerHTML =
                    '<i class="bi bi-person-lock"></i> Login';

                registerBtn.style.display = 'block';
                logoutBtn.style.display = 'none';
                profileBtn.style.display = 'none';

                loginStatus.textContent = 'Kein Benutzer angemeldet';
                if (guestOrderWrapper) {
                    guestOrderWrapper.style.display = 'block';
                }
            }
        })
        .catch(err => {
            console.error('Auth-Status Fehler:', err);
        });
});

let selectedProductCard = null;

document.addEventListener("DOMContentLoaded", () => {
    const modalElement = document.getElementById('productDetailsModal');
    const selectProductFromModalBtn = document.getElementById('selectProductFromModal');

    if (selectProductFromModalBtn) {
        selectProductFromModalBtn.addEventListener('click', async () => {
            if (!selectedProductCard) return;

            const productId = selectedProductCard.dataset.productId;
            const rentalStart = document.getElementById('modalRentalStart').value;
            const rentalEnd = document.getElementById('modalRentalEnd').value;

            if (!rentalStart || !rentalEnd) {
                showAlert('Bitte wählen Sie Mietbeginn und Mietende aus.', 'warning');
                return;
            }

            if (new Date(rentalEnd) < new Date(rentalStart)) {
                showAlert('Das Mietende darf nicht vor dem Mietbeginn liegen.', 'warning');
                return;
            }

            await addProductToCart(productId, rentalStart, rentalEnd);

            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) {
                modal.hide();
            }
        });
    }
});


async function showProductDetails(card) {
    selectedProductCard = card;

    document.getElementById('modalProductId').value = card.dataset.productId;
    document.getElementById('modalProductTitle').textContent = card.dataset.title;
    document.getElementById('modalProductRating').innerHTML = renderRatingStars(
        Number(card.dataset.averageRating || 0),
        Number(card.dataset.reviewCount || 0)
    );
    loadProductReviews(card.dataset.productId);
    document.getElementById('modalProductDescription').textContent = card.dataset.description;
    document.getElementById('modalProductPrice').textContent = card.dataset.price;
    document.getElementById('modalProductDeposit').textContent = card.dataset.deposit;

    const startInput = document.getElementById('modalRentalStart');
    const endInput = document.getElementById('modalRentalEnd');
    const infoBox = document.getElementById('modalRentalInfo');

    const today = new Date().toISOString().split('T')[0];
    startInput.value = '';
    endInput.value = '';
    startInput.min = today;
    endInput.min = today;
    infoBox.classList.add('d-none');

    const carouselWrapper = document.getElementById('modalProductCarouselWrapper');
    const carouselInner = document.getElementById('modalProductCarouselInner');

    let images = [];

    try {
        images = JSON.parse(card.dataset.images || '[]');
    } catch (error) {
        images = [];
    }

    carouselInner.innerHTML = '';

    if (images.length > 0) {
        images.forEach((imagePath, index) => {
            const item = document.createElement('div');
            item.className = index === 0 ? 'carousel-item active' : 'carousel-item';

            item.innerHTML = `
                <img src="${imagePath}" class="d-block w-100 rounded modal-product-image" alt="${card.dataset.title}">
            `;

            carouselInner.appendChild(item);
        });

        carouselWrapper.classList.remove('d-none');
    } else {
        carouselWrapper.classList.add('d-none');
    }

    await loadProductAvailability(card.dataset.productId);
    initProductCalendar();
    const modal = new bootstrap.Modal(document.getElementById('productDetailsModal'));
    modal.show();
}

let currentBlockedPeriods = [];

async function loadProductAvailability(productId) {
    try {
        const response = await fetch(`/products/${productId}/availability`);
        currentBlockedPeriods = await response.json();

        renderBlockedPeriodsInfo();
    } catch (error) {
        console.error('Fehler beim Laden der Verfügbarkeit:', error);
        currentBlockedPeriods = [];
    }
}

function renderBlockedPeriodsInfo() {
    const infoBox = document.getElementById('modalRentalInfo');

    if (!infoBox || currentBlockedPeriods.length === 0) {
        return;
    }

    infoBox.classList.remove('d-none', 'alert-danger');
    infoBox.classList.add('alert-info');

    infoBox.innerHTML = `
        <strong>Bereits reservierte Zeiträume:</strong><br>
        ${currentBlockedPeriods.map(period => {
        return `${period.rentalStart} bis ${period.rentalEnd}`;
    }).join('<br>')}
    `;
}

function selectedRangeConflicts(startDate, endDate) {
    return currentBlockedPeriods.some(period => {
        return startDate <= period.rentalEnd && endDate >= period.rentalStart;
    });
}

async function loadUserProfileIntoForm() {
    try {
        const response = await fetch('/my-profile');

        if (!response.ok) {
            return;
        }

        const user = await response.json();

        document.getElementById('FirstName').value = user.firstName || '';
        document.getElementById('LastName').value = user.lastName || '';
        document.getElementById('CustomerCompany').value = user.company || '';
        document.getElementById('CustomerEmail').value = user.email || '';
        prefillFinalEmailField(user.email);
        document.getElementById('CustomerPhone').value = user.phone || '';
        document.getElementById('CustomerAddress').value = user.address || '';
        document.getElementById('CustomerZip').value = user.zip || '';
        document.getElementById('CustomerCity').value = user.city || '';

    } catch (error) {
        console.error('Fehler beim Vorbefüllen der Kundendaten:', error);
    }
}

function setCheckoutFieldInvalid(field, message) {
    field.classList.add('is-invalid');
    field.setAttribute('aria-invalid', 'true');

    const feedback = document.getElementById(`${field.id}Feedback`);
    if (feedback) {
        feedback.textContent = message;
    }
}

function clearCheckoutFieldInvalid(field) {
    field.classList.remove('is-invalid');
    field.removeAttribute('aria-invalid');
}

function validateCustomerRequiredFields() {
    const requiredFields = [
        'FirstName',
        'LastName',
        'CustomerEmail',
        'CustomerPhone',
        'CustomerAddress',
        'CustomerZip',
        'CustomerCity'
    ];

    let isValid = true;
    let firstInvalidField = null;

    requiredFields.forEach((fieldId) => {
        const field = document.getElementById(fieldId);

        clearCheckoutFieldInvalid(field);

        if (!field.value.trim()) {
            isValid = false;
            firstInvalidField = firstInvalidField || field;
            setCheckoutFieldInvalid(field, 'Dieses Pflichtfeld muss ausgefüllt werden.');
        }
    });

    const phone = document.getElementById('CustomerPhone');
    const zip = document.getElementById('CustomerZip');
    const address = document.getElementById('CustomerAddress');
    const email = document.getElementById('CustomerEmail');

    if (email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
        isValid = false;
        firstInvalidField = firstInvalidField || email;
        setCheckoutFieldInvalid(email, 'Bitte geben Sie eine gültige E-Mail-Adresse ein.');
    }

    if (phone.value.trim() && !/^[0-9]+$/.test(phone.value.trim())) {
        isValid = false;
        firstInvalidField = firstInvalidField || phone;
        setCheckoutFieldInvalid(phone, 'Telefon darf nur Ziffern enthalten.');
    }

    if (zip.value.trim() && !/^[0-9]+$/.test(zip.value.trim())) {
        isValid = false;
        firstInvalidField = firstInvalidField || zip;
        setCheckoutFieldInvalid(zip, 'PLZ darf nur Ziffern enthalten.');
    }

    if (address.value.trim() && !/^[a-zA-Z0-9äöüÄÖÜß\s]+$/.test(address.value.trim())) {
        isValid = false;
        firstInvalidField = firstInvalidField || address;
        setCheckoutFieldInvalid(address, 'Adresse darf nur Buchstaben, Zahlen und Leerzeichen enthalten.');
    }

    if (!isValid) {
        showAlert('Bitte füllen Sie alle rot markierten Pflichtfelder korrekt aus.', 'warning');

        if (firstInvalidField) {
            firstInvalidField.focus();
        }

        return false;
    }

    return true;
}

async function validateProductStep() {
    await loadCart();

    if (!currentCart.items || currentCart.items.length === 0) {
        showAlert('Bitte legen Sie mindestens ein Produkt in den Warenkorb.', 'warning');
        return false;
    }

    return true;
}

async function goToNextStepFromCart() {
    const isValid = await validateProductStep();

    if (!isValid) return;

    const modalEl = document.getElementById('cartModal');
    const modal = bootstrap.Modal.getInstance(modalEl);

    if (modal) {
        modal.hide();
    }

    // WICHTIG: Step wirklich weiter schalten
    const nextBtn = document.getElementById('next-btn');

    if (nextBtn) {
        nextBtn.click();
    }
}

function validateCartReviewStep() {
    if (!currentCart.items || currentCart.items.length === 0) {
        showAlert('Ihr Warenkorb ist leer.', 'warning');
        return false;
    }

    return true;
}

function validateCustomerDataStep() {
    if (!validateCustomerRequiredFields()) {
        return false;
    }

    const email = document.getElementById('CustomerEmail').value.trim();
    prefillFinalEmailField(email);

    return true;
}

function validateSignatureStep() {
    let isValid = true;

    if (signaturePad.isEmpty()) {
        showAlert('Bitte leisten Sie Ihre Unterschrift.', 'warning');
        isValid = false;
    }

    if (!document.getElementById('agbs').checked) {
        showAlert('Bitte stimmen Sie den Allgemeinen Geschäftsbedingungen zu.', 'warning');
        isValid = false;
    }

    if (!document.getElementById('dsgvo').checked) {
        showAlert('Bitte stimmen Sie der Datenschutzerklärung zu.', 'warning');
        isValid = false;
    }

    return isValid;
}

document.addEventListener('DOMContentLoaded', loadRentalProducts);

async function loadRentalProducts() {
    const productGrid = document.getElementById('productGrid');

    if (!productGrid) return;

    try {
        const response = await fetch('/products');
        const products = await response.json();

        rentalProducts = products.filter(product => product.is_active === 1);
        renderCategoryFilters();
        filteredRentalProducts = [...rentalProducts];
        currentProductPage = 1;

        renderProductPage();

    } catch (error) {
        console.error('Fehler beim Laden der Produkte:', error);
        productGrid.innerHTML = `
            <div class="alert alert-danger">
                Produkte konnten nicht geladen werden.
            </div>
        `;
    }
    updateProductSectionTitle();
}

function createRentalProductCard(product) {
    const card = document.createElement('div');
    const productImages = product.images || [];

    const firstImage = productImages.length > 0
        ? productImages[0].path
        : product.image_path;

    card.className = 'product-card';
    card.dataset.product = product.product_key;
    card.dataset.productId = product.id;
    card.dataset.available = 'unknown';
    card.dataset.title = product.title;
    card.dataset.description = product.description || '';
    card.dataset.price = `${Number(product.price_per_day).toFixed(2)} € / Tag`;
    card.dataset.deposit = `${Number(product.deposit).toFixed(2)} €`;
    card.dataset.image = firstImage || '';
    card.dataset.images = JSON.stringify(
        productImages.map(image => image.path)
    );
    card.dataset.averageRating = product.average_rating || 0;
    card.dataset.reviewCount = product.review_count || 0;
    const ratingHtml = renderRatingStars(
        product.average_rating,
        product.review_count
    );

    card.innerHTML = `
    <div class="product-card-image-wrap">
        ${firstImage ? `<img src="${firstImage}" alt="${product.title}">` : ''}
        <div class="availability-badge badge bg-secondary">
            Verfügbarkeit wird geprüft...
        </div>
    </div>

    <div class="product-card-body">
        <h5 class="product-card-title">${product.title}</h5>
        ${ratingHtml}

        <p class="product-card-description">
            ${product.description || ''}
        </p>

        <div class="product-card-price-row">
            <div>
                <div class="product-card-price">
                    ${Number(product.price_per_day).toFixed(2)} € / Tag
                </div>
                <div class="product-card-deposit">
                    Kaution: ${Number(product.deposit).toFixed(2)} €
                </div>
            </div>

            <button type="button" class="btn btn-outline-primary btn-sm product-details-btn">
                Details
            </button>
        </div>
    </div>
`;

    card.addEventListener('click', () => {
        showProductDetails(card);
    });

    const detailsButton = card.querySelector('.product-details-btn');

    if (detailsButton) {
        detailsButton.addEventListener('click', event => {
            event.stopPropagation();
            selectedProductCard = card;
            showProductDetails(card);
        });
    }
    loadProductCurrentAvailability(product.id, card);
    return card;
}

async function loadProductCurrentAvailability(productId, card) {
    const badge = card.querySelector('.availability-badge');

    try {
        const response = await fetch(`/products/${productId}/current-availability`);
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Verfügbarkeit konnte nicht geladen werden.');
        }

        if (badge) {
            badge.classList.remove('bg-secondary', 'bg-success', 'bg-danger');

            if (result.available) {
                badge.classList.add('bg-success');
                badge.textContent = 'Aktuell verfügbar';
            } else {
                badge.classList.add('bg-warning');
                badge.textContent = 'Aktuell vermietet';
            }
        }

    } catch (error) {
        console.error('Fehler beim Laden der Verfügbarkeit:', error);

        if (badge) {
            badge.classList.remove('bg-secondary', 'bg-success', 'bg-danger');
            badge.classList.add('bg-secondary');
            badge.textContent = 'Verfügbarkeit unbekannt';
        }
    }
}

function renderProductPage() {
    const productGrid = document.getElementById('productGrid');
    const pagination = document.getElementById('productPagination');

    productGrid.innerHTML = '';

    if (filteredRentalProducts.length === 0) {
        productGrid.innerHTML = `
            <div class="alert alert-warning">
                Aktuell sind keine Produkte verfügbar.
            </div>
        `;
        pagination.innerHTML = '';
        return;
    }

    const startIndex = (currentProductPage - 1) * productsPerPage;
    const endIndex = startIndex + productsPerPage;
    const productsForPage = filteredRentalProducts.slice(startIndex, endIndex);

    productsForPage.forEach(product => {
        productGrid.appendChild(createRentalProductCard(product));
    });

    renderProductPagination();
}

function renderProductPagination() {
    const pagination = document.getElementById('productPagination');
    const totalPages = Math.ceil(filteredRentalProducts.length / productsPerPage);

    pagination.innerHTML = '';

    if (totalPages <= 1) {
        return;
    }

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'btn btn-outline-primary btn-sm';
    prevBtn.textContent = 'Zurück';
    prevBtn.disabled = currentProductPage === 1;
    prevBtn.addEventListener('click', () => {
        currentProductPage--;
        renderProductPage();
    });

    pagination.appendChild(prevBtn);

    for (let page = 1; page <= totalPages; page++) {
        const pageBtn = document.createElement('button');
        pageBtn.type = 'button';
        pageBtn.className =
            page === currentProductPage
                ? 'btn btn-primary btn-sm'
                : 'btn btn-outline-primary btn-sm';

        pageBtn.textContent = page;

        pageBtn.addEventListener('click', () => {
            currentProductPage = page;
            renderProductPage();
        });

        pagination.appendChild(pageBtn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn btn-outline-primary btn-sm';
    nextBtn.textContent = 'Weiter';
    nextBtn.disabled = currentProductPage === totalPages;
    nextBtn.addEventListener('click', () => {
        currentProductPage++;
        renderProductPage();
    });

    pagination.appendChild(nextBtn);
}

function calculateRentalDays(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

function formatCurrency(value) {
    return `${Number(value || 0).toFixed(2).replace('.', ',')} €`;
}

function prefillFinalEmailField(email) {
    const finalEmailInput = document.getElementById('email');

    if (!finalEmailInput || !email) return;

    finalEmailInput.value = email;
}

async function loadCart() {
    try {
        const response = await fetch('/cart');
        const cart = await response.json();

        if (!response.ok) {
            throw new Error(cart.error || 'Warenkorb konnte nicht geladen werden.');
        }

        currentCart = cart;
        renderCart();
        renderCartReview();

        return cart;
    } catch (error) {
        console.error('Fehler beim Laden des Warenkorbs:', error);
        currentCart = {
            cartId: null,
            items: []
        };
        renderCart();
        renderCartReview();
    }
}

async function addProductToCart(productId, rentalStart, rentalEnd) {
    if (selectedRangeConflicts(rentalStart, rentalEnd)) {
        showAlert('Dieses Produkt ist im ausgewählten Zeitraum bereits reserviert.', 'danger');
        return;
    }

    const cartConflict = (currentCart.items || []).some(item => {
        return String(item.productId) === String(productId)
            && rentalStart <= item.rentalEnd
            && rentalEnd >= item.rentalStart;
    });

    if (cartConflict) {
        showAlert('Dieses Produkt befindet sich bereits im Warenkorb.', 'danger');
        return;
    }

    try {
        const response = await fetch('/cart/items', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                productId,
                rentalStart,
                rentalEnd
            })
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Produkt konnte nicht zum Warenkorb hinzugefügt werden.', 'danger');
            return;
        }

        await loadCart();
        showAlert('Produkt wurde zum Warenkorb hinzugefügt.', 'success');
    } catch (error) {
        console.error('Fehler beim Hinzufügen zum Warenkorb:', error);
        showAlert('Produkt konnte nicht zum Warenkorb hinzugefügt werden.', 'danger');
    }
}

async function deleteCartItem(itemId) {
    try {
        const response = await fetch(`/cart/items/${itemId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Warenkorbposition konnte nicht gelöscht werden.', 'danger');
            return;
        }

        await loadCart();
    } catch (error) {
        console.error('Fehler beim Löschen der Warenkorbposition:', error);
        showAlert('Warenkorbposition konnte nicht gelöscht werden.', 'danger');
    }
}

async function clearCart() {
    const confirmModalEl = document.getElementById('confirmClearCartModal');

    confirmModalEl.style.zIndex = 1065;

    const confirmModal = new bootstrap.Modal(confirmModalEl, {
        backdrop: false
    });

    confirmModal.show();
}

async function executeClearCart() {
    try {
        const response = await fetch('/cart', {
            method: 'DELETE'
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Warenkorb konnte nicht geleert werden.', 'danger');
            return;
        }

        await loadCart();
        showAlert(result.message || 'Warenkorb wurde geleert.', 'success');

    } catch (error) {
        console.error('Fehler beim Leeren des Warenkorbs:', error);
        showAlert('Warenkorb konnte nicht geleert werden.', 'danger');
    }
}

function getItemPricePerDay(item) {
    return Number(item.pricePerDay ?? item.price_per_day ?? item.price_per_day_gross ?? 0);
}

function getItemDeposit(item) {
    return Number(item.deposit ?? 0);
}

function calculateCartTotals(items) {
    return items.reduce((totals, item) => {
        const days = calculateRentalDays(item.rentalStart, item.rentalEnd);
        const pricePerDay = getItemPricePerDay(item);
        const deposit = getItemDeposit(item);

        const rentalTotal = days * pricePerDay;

        totals.rentalTotal += rentalTotal;
        totals.depositTotal += deposit;

        return totals;
    }, {
        rentalTotal: 0,
        depositTotal: 0
    });
}

function renderCart() {
    const cartItems = document.getElementById('cartItems');
    const cartItemCount = document.getElementById('cartItemCount');
    const cartSummary = document.getElementById('cartSummary');
    const cartRentalTotal = document.getElementById('cartRentalTotal');
    const cartDepositTotal = document.getElementById('cartDepositTotal');
    const cartRentalNetTotal = document.getElementById('cartRentalNetTotal');
    const cartRentalVatTotal = document.getElementById('cartRentalVatTotal');
    const cartModalNextBtn = document.getElementById('cartModalNextBtn');
    const nextBtn = document.getElementById('next-btn');

    if (!cartItems) return;

    const items = currentCart.items || [];

    syncMainNextButtonVisibility();

    if (cartModalNextBtn) {
        cartModalNextBtn.disabled = items.length === 0;
    }

    if (cartItemCount) {
        cartItemCount.textContent = items.length;
    }

    if (items.length === 0) {
        cartItems.innerHTML = `
            <div class="alert alert-info mb-0">
                Ihr Warenkorb ist leer.
            </div>
        `;

        if (cartSummary) {
            cartSummary.classList.add('d-none');
        }

        return;
    }

    cartItems.innerHTML = items.map(item => {
        const days = calculateRentalDays(item.rentalStart, item.rentalEnd);
        const pricePerDay = getItemPricePerDay(item);
        const deposit = getItemDeposit(item);
        const lineTotal = days * pricePerDay;

        return `
            <div class="border rounded p-3 mb-2">
                <div class="d-flex justify-content-between gap-3">
                    <div>
                        <strong>${item.title}</strong><br>
                        <span class="small text-muted">
                            ${item.rentalStart} bis ${item.rentalEnd} · ${days} Tag${days === 1 ? '' : 'e'}
                        </span><br>
                        <span>${formatCurrency(pricePerDay)} / Tag</span><br>
                        <span>Kaution: ${formatCurrency(deposit)}</span>
                    </div>

<div class="text-end">
    <strong>${formatCurrency(lineTotal)}</strong>

    <div class="cart-item-actions mt-2">
        <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            onclick="openCartItemEditModal(${item.id})">

            <i class="bi bi-calendar-range"></i>
            Zeitraum ändern
        </button>
        <button
            type="button"
            class="btn btn-sm btn-outline-danger"
            onclick="deleteCartItem(${item.id})">

            <i class="bi bi-trash"></i>
            Entfernen
        </button>
    </div>
</div>
                </div>
            </div>
        `;
    }).join('');

    const totals = calculateCartTotals(items);

    const rentalGross = totals.rentalTotal;
    const rentalNet = rentalGross / (1 + VAT_RATE);
    const rentalVat = rentalGross - rentalNet;
    const grandTotal = totals.rentalTotal + totals.depositTotal;

    if (cartSummary) {
        cartSummary.classList.remove('d-none');
    }

    if (cartRentalNetTotal) {
        cartRentalNetTotal.textContent = formatCurrency(rentalNet);
    }

    if (cartRentalVatTotal) {
        cartRentalVatTotal.textContent = formatCurrency(rentalVat);
    }

    if (cartRentalTotal) {
        cartRentalTotal.textContent = formatCurrency(rentalGross);
    }

    if (cartDepositTotal) {
        cartDepositTotal.textContent = formatCurrency(totals.depositTotal);
    }

    const cartGrandTotal = document.getElementById('cartGrandTotal');

    if (cartGrandTotal) {
        cartGrandTotal.textContent = `${formatCurrency(grandTotal)} inkl. MwSt.`;
    }
}

function renderCartReview() {
    const cartReviewItems = document.getElementById('cartReviewItems');
    const cartReviewRentalTotal = document.getElementById('cartReviewRentalTotal');
    const cartReviewDepositTotal = document.getElementById('cartReviewDepositTotal');
    const cartReviewRentalNetTotal = document.getElementById('cartReviewRentalNetTotal');
    const cartReviewRentalVatTotal = document.getElementById('cartReviewRentalVatTotal');

    if (!cartReviewItems) return;

    const items = currentCart.items || [];

    if (items.length === 0) {
        cartReviewItems.innerHTML = `
            <div class="alert alert-warning">
                Ihr Warenkorb ist leer.
            </div>
        `;
        return;
    }

    cartReviewItems.innerHTML = items.map(item => {
        const days = calculateRentalDays(item.rentalStart, item.rentalEnd);
        const pricePerDay = getItemPricePerDay(item);
        const deposit = getItemDeposit(item);
        const lineTotal = days * pricePerDay;

        return `
            <div class="border rounded p-3 mb-2">
                <strong>${item.title}</strong><br>
                Mietzeitraum: ${item.rentalStart} bis ${item.rentalEnd}<br>
                Dauer: ${days} Tag${days === 1 ? '' : 'e'}<br>
                Miete: ${formatCurrency(lineTotal)}<br>
                Kaution: ${formatCurrency(deposit)}
            </div>
        `;
    }).join('');

    const totals = calculateCartTotals(items);
    const grandTotal = totals.rentalTotal + totals.depositTotal;
    const cartReviewGrandTotal = document.getElementById('cartReviewGrandTotal');

    if (cartReviewGrandTotal) {
        cartReviewGrandTotal.textContent = `${formatCurrency(grandTotal)} inkl. MwSt.`;
    }
    const rentalGross = totals.rentalTotal;
    const rentalNet = rentalGross / (1 + VAT_RATE);
    const rentalVat = rentalGross - rentalNet;

    if (cartReviewRentalNetTotal) {
        cartReviewRentalNetTotal.textContent = formatCurrency(rentalNet);
    }

    if (cartReviewRentalVatTotal) {
        cartReviewRentalVatTotal.textContent = formatCurrency(rentalVat);
    }

    if (cartReviewRentalTotal) {
        cartReviewRentalTotal.textContent = formatCurrency(rentalGross);
    }

    if (cartReviewDepositTotal) {
        cartReviewDepositTotal.textContent = formatCurrency(totals.depositTotal);
    }
}

window.deleteCartItem = deleteCartItem;

document.addEventListener('DOMContentLoaded', loadCart);

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('productSearchInput');

    if (!searchInput) return;

    searchInput.addEventListener('input', applyProductFilters);

    searchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
        }
    });
});

function initProductCalendar() {
    const rangeInput = document.getElementById('modalRentalRange');
    const startInput = document.getElementById('modalRentalStart');
    const endInput = document.getElementById('modalRentalEnd');
    const infoBox = document.getElementById('modalRentalInfo');
    const calendarContainer = document.getElementById('modalCalendarContainer');

    if (!rangeInput || !startInput || !endInput) return;

    if (productCalendar) {
        productCalendar.destroy();
    }

    rangeInput.value = '';
    startInput.value = '';
    endInput.value = '';

    if (calendarContainer) {
        calendarContainer.innerHTML = '';
    }

    const blockedRanges = currentBlockedPeriods.map(period => ({
        from: period.rentalStart.split('T')[0],
        to: period.rentalEnd.split('T')[0]
    }));

    productCalendar = flatpickr(rangeInput, {
        mode: 'range',
        inline: true,
        appendTo: calendarContainer,
        minDate: 'today',
        dateFormat: 'Y-m-d',
        locale: 'de',
        disable: blockedRanges,
        showMonths: 1,
        allowInput: false,

        onChange: function (selectedDates) {
            if (selectedDates.length !== 2) {
                startInput.value = '';
                endInput.value = '';
                return;
            }

            const startDate = productCalendar.formatDate(selectedDates[0], 'Y-m-d');
            const endDate = productCalendar.formatDate(selectedDates[1], 'Y-m-d');

            startInput.value = startDate;
            endInput.value = endDate;

            const days = calculateRentalDays(startDate, endDate);

            infoBox.classList.remove('d-none', 'alert-danger');
            infoBox.classList.add('alert-info');
            infoBox.textContent = `Ausgewählter Mietzeitraum: ${days} Tag${days === 1 ? '' : 'e'}`;
        }
    });
}

async function openCartItemEditModal(itemId) {
    const item = currentCart.items.find(cartItem => cartItem.id === itemId);

    if (!item) {
        showAlert('Warenkorbposition wurde nicht gefunden.', 'danger');
        return;
    }

    document.getElementById('editCartItemId').value = item.id;
    document.getElementById('editCartProductId').value = item.productId;
    document.getElementById('editCartItemTitle').textContent = item.title;
    document.getElementById('editCartRentalStart').value = item.rentalStart;
    document.getElementById('editCartRentalEnd').value = item.rentalEnd;
    document.getElementById('editCartRentalRange').value = `${item.rentalStart} bis ${item.rentalEnd}`;

    await loadProductAvailability(item.productId);

    if (cartEditCalendar) {
        cartEditCalendar.destroy();
    }

    cartEditCalendar = flatpickr('#editCartRentalRange', {
        mode: 'range',
        dateFormat: 'Y-m-d',
        locale: 'de',
        minDate: 'today',
        defaultDate: [item.rentalStart, item.rentalEnd],
        disable: currentBlockedPeriods.map(period => ({
            from: period.rentalStart,
            to: period.rentalEnd
        })),
        onChange: function (selectedDates) {
            if (selectedDates.length === 2) {
                const start = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                const end = flatpickr.formatDate(selectedDates[1], 'Y-m-d');

                document.getElementById('editCartRentalStart').value = start;
                document.getElementById('editCartRentalEnd').value = end;
            }
        }
    });

    const modal = new bootstrap.Modal(document.getElementById('cartItemEditModal'));
    modal.show();
}

async function saveCartItemRentalPeriod() {
    const itemId = document.getElementById('editCartItemId').value;
    const rentalStart = document.getElementById('editCartRentalStart').value;
    const rentalEnd = document.getElementById('editCartRentalEnd').value;

    if (!rentalStart || !rentalEnd) {
        showAlert('Bitte wählen Sie einen Mietzeitraum aus.', 'warning');
        return;
    }

    if (new Date(rentalEnd) < new Date(rentalStart)) {
        showAlert('Das Mietende darf nicht vor dem Mietbeginn liegen.', 'warning');
        return;
    }

    try {
        const response = await fetch(`/cart/items/${itemId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                rentalStart,
                rentalEnd
            })
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Mietzeitraum konnte nicht geändert werden.', 'danger');
            return;
        }

        const modal = bootstrap.Modal.getInstance(document.getElementById('cartItemEditModal'));

        if (modal) {
            modal.hide();
        }

        await loadCart();
        showAlert('Mietzeitraum wurde aktualisiert.', 'success');
    } catch (error) {
        console.error('Fehler beim Aktualisieren des Mietzeitraums:', error);
        showAlert('Mietzeitraum konnte nicht geändert werden.', 'danger');
    }
}

function allowOnlyDigits(input) {
    input.value = input.value.replace(/[^0-9]/g, '');
}

function allowAddressChars(input) {
    input.value = input.value.replace(/[^a-zA-Z0-9äöüÄÖÜß\s]/g, '');
}

function initCustomerInputValidation() {
    const phoneInput = document.getElementById('CustomerPhone');
    const zipInput = document.getElementById('CustomerZip');
    const addressInput = document.getElementById('CustomerAddress');

    if (phoneInput) {
        phoneInput.addEventListener('input', () => allowOnlyDigits(phoneInput));
    }

    if (zipInput) {
        zipInput.addEventListener('input', () => allowOnlyDigits(zipInput));
    }

    if (addressInput) {
        addressInput.addEventListener('input', () => allowAddressChars(addressInput));
    }
}

document.addEventListener('DOMContentLoaded', initCustomerInputValidation);

async function loadOpeningStatus() {
    const label = document.getElementById('openingStatusLabel');
    const message = document.getElementById('openingStatusMessage');
    const box = document.getElementById('openingStatusBox');

    if (!label || !message || !box) return;

    try {
        const response = await fetch('/opening-hours/status');
        const result = await response.json();

        label.textContent = result.label || 'Status unbekannt';
        message.textContent = result.message || '';

    } catch (error) {
        console.error('Fehler beim Laden des Öffnungsstatus:', error);
        label.textContent = 'Status unbekannt';
    }
}

document.addEventListener('DOMContentLoaded', loadOpeningStatus);

function getProductCategoryNames(product) {
    if (!Array.isArray(product.categories)) {
        return [];
    }

    return product.categories
        .map(category =>
            typeof category === 'string'
                ? category
                : category.name
        )
        .filter(Boolean);
}

function renderCategoryFilters() {
    const container = document.getElementById('categoryFilterList');

    if (!container) return;

    const categoryMap = new Map();

    rentalProducts.forEach(product => {
        getProductCategoryNames(product).forEach(categoryName => {
            categoryMap.set(
                categoryName,
                (categoryMap.get(categoryName) || 0) + 1
            );
        });
    });

    const categories = [...categoryMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'de'));

    container.innerHTML = '';

    const allButton = createCategoryFilterButton(
        'all',
        'Alle Produkte',
        rentalProducts.length
    );

    container.appendChild(allButton);

    categories.forEach(([categoryName, count]) => {
        container.appendChild(
            createCategoryFilterButton(
                categoryName,
                categoryName,
                count
            )
        );
    });
}

function createCategoryFilterButton(categoryValue, label, count) {
    const button = document.createElement('button');

    button.type = 'button';
    button.className =
        categoryValue === selectedCategory
            ? 'btn btn-warning w-100 text-start d-flex justify-content-between align-items-center mb-2'
            : 'btn btn-outline-light w-100 text-start d-flex justify-content-between align-items-center mb-2';

    button.innerHTML = `
        <span>
            <i class="bi ${categoryValue === 'all' ? 'bi-grid' : 'bi-tag'}"></i>
            ${label}
        </span>
        <span>${count}</span>
    `;

    button.addEventListener('click', () => {
        selectedCategory = categoryValue;
        applyProductFilters();
    });

    return button;
}

function selectCategoryFilter(category) {
    selectedCategory = category;
    applyProductFilters();
    renderCategoryFilters();
    updateProductSectionTitle();
    renderBestsellers();
}

function applyProductFilters() {
    if (selectedCategory === 'all') {
        filteredRentalProducts = [...rentalProducts];
    } else {
        filteredRentalProducts = rentalProducts.filter(product =>
            getProductCategoryNames(product)
                .some(category =>
                    category.toLowerCase() === selectedCategory.toLowerCase()
                )
        );
    }

    currentProductPage = 1;
    renderCategoryFilters();
    renderProductPage();
    updateProductSectionTitle();
    renderBestsellers();
}

function updateProductSectionTitle() {
    const title = document.getElementById('productSectionTitle');

    if (!title) return;

    title.textContent = selectedCategory === 'all'
        ? 'Produkte zur Vermietung'
        : `Produkte zur Vermietung: ${selectedCategory}`;
}

async function loadBestsellers() {
    const grid = document.getElementById('bestsellerGrid');
    const section = document.getElementById('bestsellerSection');

    if (!grid) return;

    try {
        const response = await fetch('/products/bestsellers');
        const products = await response.json();

        if (!response.ok) {
            throw new Error(products.error || 'Bestseller konnten nicht geladen werden.');
        }

        const visibleProducts = products.filter(product => Number(product.times_ordered || 0) > 0);

        bestsellerProducts = visibleProducts;

        renderBestsellers();

    } catch (error) {
        console.error('Fehler beim Laden der Bestseller:', error);
        grid.innerHTML = `
            <div class="alert alert-warning w-100">
                Bestseller konnten nicht geladen werden.
            </div>
        `;
    }
}
document.addEventListener('DOMContentLoaded', loadBestsellers);

function renderBestsellers() {
    const grid = document.getElementById('bestsellerGrid');
    const section = document.getElementById('bestsellerSection');

    if (!grid || !section) return;

    if (selectedCategory !== 'all') {
        grid.innerHTML = '';
        section.classList.add('d-none');
        return;
    }

    const visibleBestsellers = bestsellerProducts;

    if (visibleBestsellers.length === 0) {
        section.classList.add('d-none');
        return;
    }

    grid.innerHTML = '';

    visibleBestsellers.forEach(product => {
        grid.appendChild(createRentalProductCard(product));
    });

    section.classList.remove('d-none');
}

function renderRatingStars(rating, count = null) {
    const normalizedRating = Number(rating || 0);
    const reviewCount = Number(count || 0);

    let stars = '';

    for (let i = 1; i <= 5; i++) {
        stars += normalizedRating >= i
            ? '<i class="bi bi-star-fill text-warning"></i>'
            : '<i class="bi bi-star text-warning"></i>';
    }

    return `
        <div class="d-flex align-items-center gap-2 small">
            <span>${stars}</span>
            ${count !== null ? `<span class="text-muted">${normalizedRating.toFixed(1)} (${reviewCount})</span>` : ''}
        </div>
    `;
}

async function loadProductReviews(productId) {
    const container = document.getElementById('modalProductReviews');
    const reviewCount = document.getElementById('modalProductReviewCount');

    if (!container) return;

    container.innerHTML = '<div class="text-muted">Bewertungen werden geladen...</div>';

    if (reviewCount) {
        reviewCount.textContent = '';
    }

    try {
        const response = await fetch(`/products/${productId}/reviews`);
        const reviews = await response.json();

        if (!response.ok) {
            container.innerHTML = '<div class="text-muted">Bewertungen konnten nicht geladen werden.</div>';
            return;
        }

        currentModalProductReviews = (reviews || []).sort((a, b) => {
            const ratingA = Number(a.rating || 0);
            const ratingB = Number(b.rating || 0);

            if (ratingB !== ratingA) {
                return ratingB - ratingA;
            }

            const dateA = new Date(a.createdAt || 0).getTime();
            const dateB = new Date(b.createdAt || 0).getTime();

            return dateB - dateA;
        });

        if (reviewCount) {
            reviewCount.textContent = currentModalProductReviews.length === 1
                ? '1 Bewertung'
                : `${currentModalProductReviews.length} Bewertungen`;
        }

        renderModalProductReviews(false);

    } catch (error) {
        console.error('Fehler beim Laden der Bewertungen:', error);
        container.innerHTML = '<div class="text-muted">Bewertungen konnten nicht geladen werden.</div>';
    }
}

function renderModalProductReviews(showAll = false) {
    const container = document.getElementById('modalProductReviews');

    if (!container) return;

    const reviews = currentModalProductReviews || [];

    if (reviews.length === 0) {
        container.innerHTML = '<div class="text-muted">Noch keine Bewertungen vorhanden.</div>';
        return;
    }

    const visibleReviews = showAll
        ? reviews
        : reviews.slice(0, 3);

    const reviewsHtml = visibleReviews.map(review => `
        <div class="border-bottom pb-2 mb-2">
            ${renderRatingStars(review.rating)}

            <div class="small text-muted">
                ${review.firstName || ''} ${review.lastName || ''}
                · ${review.createdAt || ''}
            </div>

            <div>
                ${review.reviewText || '<span class="text-muted">Keine Rezension geschrieben.</span>'}
            </div>
        </div>
    `).join('');

    const showAllButtonHtml = !showAll && reviews.length > 3
        ? `
            <button type="button"
                class="btn btn-outline-primary btn-sm mt-2"
                onclick="renderModalProductReviews(true)">
                Alle Bewertungen anzeigen
            </button>
        `
        : '';

    container.innerHTML = reviewsHtml + showAllButtonHtml;
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('confirmClearCartBtn');

    if (!btn) return;

    btn.addEventListener('click', async () => {
        const confirmModalEl = document.getElementById('confirmClearCartModal');
        const confirmModal = bootstrap.Modal.getInstance(confirmModalEl);

        if (confirmModal) {
            confirmModal.hide();
        }

        await executeClearCart();

        const cartModalEl = document.getElementById('cartModal');
        const cartModal = bootstrap.Modal.getInstance(cartModalEl);

        if (cartModal) {
            cartModal.hide();
        }
    });
});

document.addEventListener('DOMContentLoaded', () => {
    [
        'FirstName',
        'LastName',
        'CustomerEmail',
        'CustomerPhone',
        'CustomerAddress',
        'CustomerZip',
        'CustomerCity'
    ].forEach((fieldId) => {
        const field = document.getElementById(fieldId);

        if (!field) return;

        field.addEventListener('input', () => {
            if (field.value.trim()) {
                clearCheckoutFieldInvalid(field);
            }
        });
    });
});