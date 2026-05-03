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

                    if (field.type === 'checkbox') {
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

    const formData = serializeFormToStepJson();

    try {
        preloader.classList.add('d-block');
        submitBtn.disabled = true;

        const response = await fetch('/data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                form: formData
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

        bodyElement.classList.add('loaded');

        step[stepCount].classList.remove('d-block');
        step[stepCount].classList.add('d-none');

        prevBtn.classList.remove('d-inline-block');
        prevBtn.classList.add('d-none');

        submitBtn.classList.remove('d-inline-block');
        submitBtn.classList.add('d-none');

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

    if (!adminBtn || !loginStatus || !logoutBtn) return;

    fetch('/auth-status')
        .then(res => res.json())
        .then(data => {
            if (data.loggedIn) {
                registerBtn.style.display = 'none';
                logoutBtn.style.display = 'block';
                profileBtn.style.display = 'block';

                loginStatus.textContent = `Angemeldet als: ${data.user}`;

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
        document.getElementById('CustomerEmail').value = user.email || '';
        document.getElementById('CustomerPhone').value = user.phone || '';
        document.getElementById('CustomerAddress').value = user.address || '';
        document.getElementById('CustomerZip').value = user.zip || '';
        document.getElementById('CustomerCity').value = user.city || '';

    } catch (error) {
        console.error('Fehler beim Vorbefüllen der Kundendaten:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const guestOrderBtn = document.getElementById('guestOrderBtn');
    const checkGuestVerificationBtn = document.getElementById('checkGuestVerificationBtn');
    const guestVerificationInfo = document.getElementById('guestVerificationInfo');

    if (guestOrderBtn) {
        guestOrderBtn.addEventListener('click', async () => {
            const email = document.getElementById('CustomerEmail').value.trim();

            if (!email) {
                showAlert('Bitte geben Sie zuerst Ihre E-Mail-Adresse ein.', 'warning');
                return;
            }

            if (!validateCustomerRequiredFields()) {
                return;
            }

            try {
                guestOrderBtn.disabled = true;

                const response = await fetch('/request-guest-verification', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email })
                });

                const result = await response.json();

                if (!response.ok) {
                    if (response.status === 409) {
                        showAlert(
                            'Diese E-Mail-Adresse existiert bereits. <a href="/login.html" class="alert-link">Hier klicken, um sich einzuloggen.</a>',
                            'warning',
                            8000
                        );
                        return;
                    }

                    showAlert(result.error || 'E-Mail-Verifikation konnte nicht gestartet werden.', 'danger');
                    return;
                }

                if (!response.ok) {
                    showAlert(result.error || 'Fehler beim Versenden des Bestätigungslinks.', 'danger');
                    guestOrderBtn.disabled = false;
                    return;
                }

                guestVerificationRequested = true;
                guestEmailVerified = false;

                if (guestVerificationInfo) {
                    guestVerificationInfo.classList.remove('d-none');
                }

                showAlert('Bestätigungslink wurde versendet.', 'success');

            } catch (error) {
                console.error('Fehler bei Gast-Verifikation:', error);
                showAlert('Fehler beim Versenden des Bestätigungslinks.', 'danger');
                guestOrderBtn.disabled = false;
            }
        });
    }

    if (checkGuestVerificationBtn) {
        checkGuestVerificationBtn.addEventListener('click', async () => {
            const email = document.getElementById('CustomerEmail').value.trim();

            if (!email) {
                showAlert('Bitte geben Sie Ihre E-Mail-Adresse ein.', 'warning');
                return;
            }

            try {
                const response = await fetch('/check-email-verification', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email })
                });

                const result = await response.json();

                if (result.verified) {
                    guestEmailVerified = true;
                    showAlert('E-Mail wurde erfolgreich bestätigt. Sie können fortfahren.', 'success');
                } else {
                    showAlert('E-Mail wurde noch nicht bestätigt.', 'warning');
                }

            } catch (error) {
                console.error('Fehler beim Prüfen der Gast-Verifikation:', error);
                showAlert('Fehler beim Prüfen der Verifikation.', 'danger');
            }
        });
    }
});

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

    for (const fieldId of requiredFields) {
        const field = document.getElementById(fieldId);

        if (!field || !field.value.trim()) {
            showAlert('Bitte füllen Sie alle persönlichen Daten aus.', 'warning');
            return false;
        }
    }

    const phone = document.getElementById('CustomerPhone').value.trim();
    const zip = document.getElementById('CustomerZip').value.trim();
    const address = document.getElementById('CustomerAddress').value.trim();

    if (!/^[0-9]+$/.test(phone)) {
        showAlert('Telefon darf nur Ziffern enthalten.', 'warning');
        return false;
    }

    if (!/^[0-9]+$/.test(zip)) {
        showAlert('PLZ darf nur Ziffern enthalten.', 'warning');
        return false;
    }

    if (!/^[a-zA-Z0-9äöüÄÖÜß\s]+$/.test(address)) {
        showAlert('Adresse darf nur Buchstaben, Zahlen und Leerzeichen enthalten.', 'warning');
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

    const isLoggedIn =
        document.getElementById('logout-button') &&
        document.getElementById('logout-button').style.display !== 'none';

    if (isLoggedIn) {
        return true;
    }

    if (!guestVerificationRequested) {
        showAlert('Bitte wählen Sie "Als Gast bestellen", um Ihre E-Mail-Adresse zu bestätigen.', 'warning');
        return false;
    }

    if (!guestEmailVerified) {
        showAlert('Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse und klicken Sie anschließend auf "Verifikation prüfen".', 'warning');
        return false;
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
    card.dataset.title = product.title;
    card.dataset.description = product.description || '';
    card.dataset.price = `${Number(product.price_per_day).toFixed(2)} € / Tag`;
    card.dataset.deposit = `${Number(product.deposit).toFixed(2)} €`;
    card.dataset.image = firstImage || '';
    card.dataset.images = JSON.stringify(
        productImages.map(image => image.path)
    );

    card.innerHTML = `
    ${firstImage ? `<img src="${firstImage}" alt="${product.title}">` : ''}

    <h5 class="mt-2">${product.title}</h5>

    <p class="mb-2">${product.description || ''}</p>

    <div class="d-flex justify-content-between align-items-end mt-auto">
        <button type="button" class="btn btn-outline-primary btn-sm product-details-btn">
            Details anzeigen
        </button>

        <span class="fw-bold text-end">
            ${Number(product.price_per_day).toFixed(2)} € / Tag
        </span>
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

    return card;
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
    const confirmed = confirm('Möchten Sie den Warenkorb wirklich leeren?');

    if (!confirmed) {
        return;
    }

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

function calculateCartTotals(items) {
    return items.reduce((totals, item) => {
        const days = calculateRentalDays(item.rentalStart, item.rentalEnd);
        const pricePerDay = Number(item.pricePerDay || 0);
        const deposit = Number(item.deposit || 0);

        totals.rentalTotal += days * pricePerDay;
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

    if (!cartItems) return;

    const items = currentCart.items || [];

    if (cartItemCount) {
        cartItemCount.textContent = `${items.length} Produkt${items.length === 1 ? '' : 'e'}`;
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

    const clearCartButtonHtml = `
    <div class="d-flex justify-content-end mb-3">
        <button type="button" class="btn btn-outline-danger btn-sm" onclick="clearCart()">
            Warenkorb leeren
        </button>
    </div>
`;

    cartItems.innerHTML = clearCartButtonHtml + items.map(item => {
        const days = calculateRentalDays(item.rentalStart, item.rentalEnd);
        const lineTotal = days * Number(item.pricePerDay || 0);

        return `
            <div class="border rounded p-3 mb-2">
                <div class="d-flex justify-content-between gap-3">
                    <div>
                        <strong>${item.title}</strong><br>
                        <span class="small text-muted">
                            ${item.rentalStart} bis ${item.rentalEnd} · ${days} Tag${days === 1 ? '' : 'e'}
                        </span><br>
                        <span>${formatCurrency(item.pricePerDay)} / Tag</span><br>
                        <span>Kaution: ${formatCurrency(item.deposit)}</span>
                    </div>

                    <div class="text-end">
                        <strong>${formatCurrency(lineTotal)}</strong><br>
                        <button type="button" class="btn btn-sm btn-outline-primary mt-2 me-2"
                            onclick="openCartItemEditModal(${item.id})">
                            Zeitraum ändern
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger mt-2"
                            onclick="deleteCartItem(${item.id})">
                            Entfernen
                        </button>

                    </div>
                </div>
            </div>
        `;
    }).join('');

    const totals = calculateCartTotals(items);

    if (cartSummary) {
        cartSummary.classList.remove('d-none');
    }

    if (cartRentalTotal) {
        cartRentalTotal.textContent = formatCurrency(totals.rentalTotal);
    }

    if (cartDepositTotal) {
        cartDepositTotal.textContent = formatCurrency(totals.depositTotal);
    }
}

function renderCartReview() {
    const cartReviewItems = document.getElementById('cartReviewItems');
    const cartReviewRentalTotal = document.getElementById('cartReviewRentalTotal');
    const cartReviewDepositTotal = document.getElementById('cartReviewDepositTotal');

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
        const lineTotal = days * Number(item.pricePerDay || 0);

        return `
            <div class="border rounded p-3 mb-2">
                <strong>${item.title}</strong><br>
                Mietzeitraum: ${item.rentalStart} bis ${item.rentalEnd}<br>
                Dauer: ${days} Tag${days === 1 ? '' : 'e'}<br>
                Miete: ${formatCurrency(lineTotal)}<br>
                Kaution: ${formatCurrency(item.deposit)}
            </div>
        `;
    }).join('');

    const totals = calculateCartTotals(items);

    if (cartReviewRentalTotal) {
        cartReviewRentalTotal.textContent = formatCurrency(totals.rentalTotal);
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

function renderCategoryFilters() {
    const container = document.getElementById('categoryFilterList');
    if (!container) return;

    const categories = [...new Set(
        rentalProducts
            .map(product => product.category)
            .filter(Boolean)
    )].sort();

    const countForCategory = category => {
        if (category === 'all') return rentalProducts.length;
        return rentalProducts.filter(product => product.category === category).length;
    };

    container.innerHTML = `
        <button type="button"
            class="btn btn-sm text-start category-btn ${selectedCategory === 'all' ? 'active' : ''}"
            onclick="selectCategoryFilter('all')">
            <i class="bi bi-grid"></i>
            Alle Produkte
            <span class="float-end">${countForCategory('all')}</span>
        </button>

        ${categories.map(category => `
            <button type="button"
                class="btn btn-sm text-start category-btn ${selectedCategory === category ? 'active' : ''}"
                onclick="selectCategoryFilter('${category.replace(/'/g, "\\'")}')">
                <i class="bi bi-tag"></i>
                ${category}
                <span class="float-end">${countForCategory(category)}</span>
            </button>
        `).join('')}
    `;
}

function selectCategoryFilter(category) {
    selectedCategory = category;
    applyProductFilters();
    renderCategoryFilters();
    updateProductSectionTitle();
}

function applyProductFilters() {
    const searchInput = document.getElementById('productSearchInput');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

    filteredRentalProducts = rentalProducts.filter(product => {
        const matchesCategory =
            selectedCategory === 'all' ||
            product.category === selectedCategory;

        const matchesSearch = [
            product.title,
            product.description,
            product.product_key,
            product.category,
            product.price_per_day,
            product.deposit
        ].join(' ').toLowerCase().includes(query);

        return matchesCategory && matchesSearch;
    });

    currentProductPage = 1;
    renderProductPage();
}

function updateProductSectionTitle() {
    const title = document.getElementById('productSectionTitle');
    if (!title) return;

    if (selectedCategory === 'all') {
        title.textContent = 'Produkte zur Vermietung auswählen';
    } else {
        title.textContent =
            selectedCategory === 'all'
                ? 'Alle Produkte'
                : selectedCategory;
    }
}

async function loadBestsellers() {
    const grid = document.getElementById('bestsellerGrid');
    if (!grid) return;

    try {
        const response = await fetch('/products/bestsellers');
        const products = await response.json();

        if (!products.length) {
            grid.innerHTML = '<div class="text-white">Noch keine Bestseller vorhanden.</div>';
            return;
        }

        grid.innerHTML = '';

        products.forEach(product => {
            const card = createRentalProductCard(product);
            grid.appendChild(card);
        });

    } catch (error) {
        console.error('Fehler beim Laden der Bestseller:', error);
    }
}

document.addEventListener('DOMContentLoaded', loadBestsellers);
