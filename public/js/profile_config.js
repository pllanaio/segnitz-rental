let myOrders = [];
let orderIdToCancel = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/my-profile');

        if (!response.ok) {
            window.location.href = '/login.html';
            return;
        }

        const user = await response.json();

        document.getElementById('customerNo').value = user.customerNo || '-';
        document.getElementById('email').value = user.email || '-';
        document.getElementById('profileFirstName').value = user.firstName || '';
        document.getElementById('profileLastName').value = user.lastName || '';
        document.getElementById('profileCompany').value = user.company || '';
        document.getElementById('profilePhone').value = user.phone || '';
        document.getElementById('profileAddress').value = user.address || '';
        document.getElementById('profileZip').value = user.zip || '';
        document.getElementById('profileCity').value = user.city || '';
        document.getElementById('verified').value = user.emailVerified === 1 ? 'Ja' : 'Nein';

        document.getElementById('profileBox').classList.remove('d-none');

        await loadMyOrders();

    } catch (error) {
        const box = document.getElementById('profileError');
        box.textContent = 'Profil konnte nicht geladen werden.';
        box.classList.remove('d-none');
    }
});

async function loadMyOrders() {
    const container = document.getElementById('myOrdersList');

    if (!container) return;

    try {
        const response = await fetch('/my-orders');
        const result = await response.json();

        if (!response.ok) {
            container.innerHTML = `<div class="alert alert-warning">${result.error || 'Bestellungen konnten nicht geladen werden.'}</div>`;
            return;
        }

        myOrders = result;
        renderMyOrders();
    } catch (error) {
        console.error('Fehler beim Laden der Bestellungen:', error);
        container.innerHTML = '<div class="alert alert-danger">Bestellungen konnten nicht geladen werden.</div>';
    }
}

function canCancelOrder(order) {
    const status = String(order.status || '').trim().toLowerCase();
    return ['reserved', 'confirmed'].includes(status);
}

function renderMyOrders() {
    const container = document.getElementById('myOrdersList');

    if (!myOrders || myOrders.length === 0) {
        container.innerHTML = '<div class="alert alert-info">Sie haben noch keine Bestellungen.</div>';
        return;
    }

    container.innerHTML = myOrders.map(order => `
        <div class="card mb-2">
            <div class="card-body d-flex justify-content-between align-items-center gap-3">
                <div>
                    <strong>${order.order_no}</strong><br>
                    ${getStatusBadge(order.status)}
                    ${getPaymentBadge(order.payment_status)}
                    ${getReturnBadge(order.return_status, order.status)}
                </div>

                <div class="d-flex gap-2 flex-wrap justify-content-end">
    <button type="button" class="btn btn-outline-primary btn-sm"
        onclick="openMyOrderDetails(${order.id})">
        Details anzeigen
    </button>

    ${canCancelOrder(order) ? `
        <button type="button" class="btn btn-outline-danger btn-sm"
            onclick="cancelMyOrder(${order.id})">
            Stornieren
        </button>
    ` : ''}
</div>

            </div>
        </div>
    `).join('');
}

async function openMyOrderDetails(orderId) {
    try {
        const response = await fetch(`/my-orders/${orderId}`);
        const order = await response.json();

        if (!response.ok) {
            showAlert(order.error || 'Bestellung konnte nicht geladen werden.', 'danger');
            return;
        }

        renderMyOrderDetails(order);

        const modal = new bootstrap.Modal(document.getElementById('myOrderDetailsModal'));
        modal.show();
    } catch (error) {
        console.error('Fehler beim Laden der Bestellung:', error);
        showAlert('Bestellung konnte nicht geladen werden.', 'danger');
    }
}

function cancelMyOrder(orderId) {
    orderIdToCancel = orderId;

    const modal = new bootstrap.Modal(document.getElementById('cancelOrderModal'));
    modal.show();
}

function renderMyOrderDetails(order) {
    const body = document.getElementById('myOrderDetailsBody');

    const itemsHtml = (order.items || []).map(item => `
        <tr>
            <td>${item.title}</td>
            <td>${item.rentalStart} bis ${item.rentalEnd}</td>
            <td>${Number(item.pricePerDay || 0).toFixed(2)} €</td>
            <td>${Number(item.deposit || 0).toFixed(2)} €</td>
        </tr>
    `).join('');

    const status = String(order.status || '').trim().toLowerCase();
    const canShowReturnSection = status !== 'cancelled';

    const canReview = status === 'returned';

    const uniqueReviewItems = [];

    if (canReview) {
        const reviewItemsByProductId = new Map();

        (order.items || []).forEach(item => {
            const productId = String(item.productId);

            if (!reviewItemsByProductId.has(productId)) {
                reviewItemsByProductId.set(productId, item);
                return;
            }

            const existingItem = reviewItemsByProductId.get(productId);

            if (!existingItem.review && item.review) {
                reviewItemsByProductId.set(productId, {
                    ...existingItem,
                    review: item.review
                });
            }
        });

        uniqueReviewItems.push(...reviewItemsByProductId.values());
    }

    const reviewButtonsHtml = canReview
        ? uniqueReviewItems.map(item => {
            if (item.review) {
                return `
                <div class="card mt-3">
                    <div class="card-body">
                        <h6>Ihre Bewertung für ${item.title}</h6>

                        <div class="mb-2">
                            <strong>Sterne:</strong>
                            ${'★'.repeat(Number(item.review.rating))}
                            ${'☆'.repeat(5 - Number(item.review.rating))}
                        </div>

                        <div class="mb-2">
                            <strong>Kommentar:</strong><br>
                            <div class="border rounded p-2 bg-light">
                                ${item.review.reviewText || '<span class="text-muted">Kein Kommentar</span>'}
                            </div>
                        </div>

                        <div class="text-muted small">
                            Bewertet am: ${item.review.createdAt || '-'}
                        </div>
                    </div>
                </div>
            `;
            }

            return `
            <div class="card mt-3">
                <div class="card-body">
                    <h6>Bewertung für ${item.title}</h6>

                    <div class="alert alert-light border small mb-3">
                        Dieses Produkt kann pro Bestellung einmal bewertet werden,
                        auch wenn es in mehreren Mietzeiträumen gebucht wurde.
                    </div>

                    <div class="mb-2">
                        <label class="form-label" for="rating-${item.productId}">
                            Sterne
                        </label>

                        <select class="form-select form-select-sm" id="rating-${item.productId}">
                            <option value="">Bitte auswählen</option>
                            <option value="5">5 Sterne</option>
                            <option value="4">4 Sterne</option>
                            <option value="3">3 Sterne</option>
                            <option value="2">2 Sterne</option>
                            <option value="1">1 Stern</option>
                        </select>
                    </div>

                    <div class="mb-2">
                        <label class="form-label" for="reviewText-${item.productId}">
                            Kommentar
                        </label>

                        <textarea
                            class="form-control form-control-sm"
                            id="reviewText-${item.productId}"
                            rows="2"></textarea>
                    </div>

                    <button
                        type="button"
                        class="btn btn-outline-success btn-sm"
                        onclick="submitProductReview(${item.productId}, ${order.id})">

                        Bewertung speichern
                    </button>
                </div>
            </div>
        `;
        }).join('')
        : '';

    const cancelButtonHtml = canCancelOrder(order)
        ? `
        <button type="button" class="btn btn-outline-danger btn-sm mt-3"
            onclick="cancelMyOrder(${order.id})">
            Bestellung stornieren
        </button>
    `
        : '';

    const imagesHtml = (order.returnImages || []).length === 0
        ? '<div class="text-muted">Keine Rückgabefotos vorhanden.</div>'
        : `<div class="row g-2">
            ${order.returnImages.map(image => `
                <div class="col-6 col-md-3">
                    <a href="/${image.imagePath}" target="_blank">
                        <img src="/${image.imagePath}" class="img-fluid rounded border"
                            style="height: 140px; object-fit: cover; width: 100%;">
                    </a>
                </div>
            `).join('')}
        </div>`;

    body.innerHTML = `
        <div class="row g-4">
            <div class="col-12 col-lg-6">
                <h5>Bestellung</h5>
                <p>
                    <strong>Bestellnummer:</strong> ${order.order_no}<br>
                    <strong>Status:</strong> ${getStatusBadge(order.status)}<br>
                        ${order.status === 'cancelled' ? `
        <strong>Storniert am:</strong> ${order.cancelled_at || '-'}<br>
        <strong>Stornogrund:</strong><br>
        <span class="text-danger">${formatTextValue(order.cancel_reason)}</span><br>
    ` : ''}

                    <strong>Zahlung:</strong> ${getPaymentBadge(order.payment_status)}<br>
                    <strong>Rückgabe:</strong> ${getReturnBadge(order.return_status, order.status)}
                </p>
            </div>

            <div class="col-12 col-lg-6">
                <h5>Kunde</h5>
                <p>
                    <strong>${order.customer_first_name || ''} ${order.customer_last_name || ''}</strong><br>
                    ${order.customer_email || ''}<br>
                    ${order.customer_phone || ''}<br>
                    ${order.customer_address || ''}<br>
                    ${order.customer_zip || ''} ${order.customer_city || ''}
                </p>
            </div>

            <div class="col-12">
                <h5>Artikel</h5>
                <div class="table-responsive">
                    <table class="table table-sm table-striped">
                        <thead>
                            <tr>
                                <th>Artikel</th>
                                <th>Mietzeitraum</th>
                                <th>Preis / Tag</th>
                                <th>Kaution</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml || '<tr><td colspan="4">Keine Artikel vorhanden.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
            ${canReview ? `
    <div class="col-12">
        <h5>Produkte bewerten</h5>
        ${reviewButtonsHtml}
    </div>
` : ''}
            ${cancelButtonHtml}

${canShowReturnSection ? `
    <div class="col-12">
        <h5>Rückgabe / Kaution</h5>
        <p>
            <strong>Beschädigt:</strong> ${order.is_damaged ? 'Ja' : 'Nein'}<br>
            <strong>Beschreibung Schaden:</strong> ${order.damage_description || '-'}<br>
            <strong>Verspätet:</strong> ${order.is_late ? 'Ja' : 'Nein'}<br>
            <strong>Beschreibung Verspätung:</strong> ${order.late_description || '-'}<br>
            <strong>Kautionsentscheidung:</strong> ${order.deposit_decision || 'pending'}<br>
            <strong>Rückzahlung:</strong> ${order.deposit_refund_amount || '-'} €<br>
            <strong>Abzug:</strong> ${order.deposit_deduction_amount || '-'} €<br>
            <strong>Grund für Abzug:</strong> ${order.deposit_deduction_reason || '-'}
        </p>
    </div>

    <div class="col-12">
        <h5>Rückgabefotos</h5>
        ${imagesHtml}
    </div>
` : ''}
        </div>
    `;
}

function getStatusBadge(status) {
    const map = {
        reserved: 'warning',
        expired: 'danger',
        paid: 'info',
        confirmed: 'primary',
        active: 'success',
        returned: 'success',
        cancelled: 'dark'
    };

    const labels = {
        reserved: 'Reserviert',
        expired: 'Abgelaufen',
        paid: 'Bezahlt',
        confirmed: 'Bestätigt',
        active: 'Aktiv',
        returned: 'Zurückgegeben',
        cancelled: 'Storniert'
    };

    return `<span class="badge bg-${map[status] || 'secondary'} me-1">${labels[status] || status || '-'}</span>`;
}

function getPaymentBadge(status) {
    const map = {
        paid: 'success',
        unpaid: 'warning',
        pending: 'warning',
        failed: 'danger',
        refunded: 'secondary'
    };

    const labels = {
        paid: 'Bezahlt',
        unpaid: 'Unbezahlt',
        pending: 'Ausstehend',
        failed: 'Fehlgeschlagen',
        refunded: 'Erstattet'
    };

    return `<span class="badge bg-${map[status] || 'secondary'} me-1">
        Zahlung: ${labels[status] || status || '-'}
    </span>`;
}

function getReturnBadge(status, orderStatus = null) {
    if (orderStatus === 'cancelled') {
        return `<span class="badge bg-dark">Rückgabe: Geschlossen</span>`;
    }

    const map = {
        pending: 'secondary',
        returned_ok: 'success',
        returned_late: 'warning',
        returned_damaged: 'danger',
        returned_late_damaged: 'danger'
    };

    const labels = {
        pending: 'Offen',
        returned_ok: 'OK',
        returned_late: 'Verspätet',
        returned_damaged: 'Beschädigt',
        returned_late_damaged: 'Verspätet + beschädigt'
    };

    return `<span class="badge bg-${map[status] || 'secondary'}">
        Rückgabe: ${labels[status] || status || 'pending'}
    </span>`;
}

function switchProfileView(view) {
    document.getElementById('profileView').classList.add('d-none');
    document.getElementById('ordersView').classList.add('d-none');

    document.getElementById(`nav-profile`).classList.remove('active');
    document.getElementById(`nav-orders`).classList.remove('active');

    if (view === 'profile') {
        document.getElementById('profileView').classList.remove('d-none');
        document.getElementById('nav-profile').classList.add('active');
    }

    if (view === 'orders') {
        document.getElementById('ordersView').classList.remove('d-none');
        document.getElementById('nav-orders').classList.add('active');
    }
}

document.getElementById('profileForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    console.log('Profildaten speichern ausgelöst');

    const payload = {
        firstName: document.getElementById('profileFirstName').value.trim(),
        lastName: document.getElementById('profileLastName').value.trim(),
        company: document.getElementById('profileCompany').value.trim(),
        phone: document.getElementById('profilePhone').value.trim(),
        address: document.getElementById('profileAddress').value.trim(),
        zip: document.getElementById('profileZip').value.trim(),
        city: document.getElementById('profileCity').value.trim()
    };

    if (!/^[0-9]+$/.test(payload.phone)) {
        showAlert('Telefon darf nur Ziffern enthalten.', 'warning');
        return;
    }

    if (!/^[0-9]+$/.test(payload.zip)) {
        showAlert('PLZ darf nur Ziffern enthalten.', 'warning');
        return;
    }

    if (!/^[a-zA-Z0-9äöüÄÖÜß\s]+$/.test(payload.address)) {
        showAlert('Adresse darf nur Buchstaben, Zahlen und Leerzeichen enthalten.', 'warning');
        return;
    }

    try {
        const response = await fetch('/my-profile', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Profildaten konnten nicht gespeichert werden.', 'danger');
            return;
        }

        showAlert(result.message || 'Profildaten wurden gespeichert.', 'success');
        console.log('Profildaten gespeichert:', result);

    } catch (error) {
        console.error('Fehler beim Speichern der Profildaten:', error);
        showAlert('Profildaten konnten nicht gespeichert werden.', 'danger');
    }
});

document.getElementById('passwordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    console.log('Passwortänderung ausgelöst');

    const payload = {
        currentPassword: document.getElementById('currentPassword').value,
        newPassword: document.getElementById('newPassword').value,
        newPasswordConfirm: document.getElementById('newPasswordConfirm').value
    };

    const passwordPolicyRegex = /^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

    if (!passwordPolicyRegex.test(payload.newPassword)) {
        showAlert('Das Passwort muss mindestens 8 Zeichen, eine Zahl und ein Sonderzeichen enthalten.', 'warning');
        return;
    }

    try {
        const response = await fetch('/my-profile/password', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Passwort konnte nicht geändert werden.', 'danger');
            return;
        }

        document.getElementById('passwordForm').reset();

        showAlert(result.message || 'Passwort wurde geändert.', 'success');
        console.log('Passwort geändert:', result);

    } catch (error) {
        console.error('Fehler beim Ändern des Passworts:', error);
        showAlert('Passwort konnte nicht geändert werden.', 'danger');
    }
});

function formatTextValue(value) {
    if (value === null || value === undefined || value === '') {
        return '-';
    }

    if (typeof value === 'object') {
        if (value.message) return value.message;
        if (value.reason) return value.reason;
        if (value.text) return value.text;

        return JSON.stringify(value);
    }

    return String(value);
}

function allowOnlyDigits(input) {
    input.value = input.value.replace(/[^0-9]/g, '');
}

function allowAddressChars(input) {
    input.value = input.value.replace(/[^a-zA-Z0-9äöüÄÖÜß\s]/g, '');
}

function initProfileInputValidation() {
    const phoneInput = document.getElementById('profilePhone');
    const zipInput = document.getElementById('profileZip');
    const addressInput = document.getElementById('profileAddress');

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

document.addEventListener('DOMContentLoaded', initProfileInputValidation);

document.getElementById('confirmCancelOrderBtn')?.addEventListener('click', async () => {
    if (!orderIdToCancel) return;

    const modalEl = document.getElementById('cancelOrderModal');
    const modal = bootstrap.Modal.getInstance(modalEl);

    try {
        const response = await fetch(`/my-orders/${orderIdToCancel}/cancel`, {
            method: 'POST'
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Bestellung konnte nicht storniert werden.', 'danger');
            return;
        }

        showAlert(result.message || 'Bestellung wurde storniert.', 'success');

        modal.hide();
        orderIdToCancel = null;

        await loadMyOrders();

    } catch (error) {
        console.error('Fehler beim Stornieren der Bestellung:', error);
        showAlert('Bestellung konnte nicht storniert werden.', 'danger');
    }
});

async function submitProductReview(productId, orderId) {
    const ratingInput = document.getElementById(`rating-${productId}`);
    const reviewTextInput = document.getElementById(`reviewText-${productId}`);

    const rating = ratingInput ? ratingInput.value : '';
    const reviewText = reviewTextInput ? reviewTextInput.value.trim() : '';

    if (!rating) {
        showAlert('Bitte wählen Sie eine Sternebewertung aus.', 'warning');
        return;
    }

    const submitButton = document.querySelector(
        `button[onclick="submitProductReview(${productId}, ${orderId})"]`
    );

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Bewertung wird gespeichert...';
    }

    try {
        const response = await fetch(`/products/${productId}/reviews`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                orderId,
                rating: Number(rating),
                reviewText
            })
        });

        const result = await response.json();

        if (!response.ok) {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = 'Bewertung speichern';
            }

            showAlert(result.error || 'Bewertung konnte nicht gespeichert werden.', 'danger');
            return;
        }

        showAlert(result.message || 'Bewertung wurde gespeichert.', 'success');

        await refreshMyOrderDetails(orderId);
        await loadMyOrders();

    } catch (error) {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = 'Bewertung speichern';
        }

        console.error('Fehler beim Speichern der Bewertung:', error);
        showAlert('Bewertung konnte nicht gespeichert werden.', 'danger');
    }
}

async function refreshMyOrderDetails(orderId) {
    try {
        const response = await fetch(`/my-orders/${orderId}`);
        const order = await response.json();

        if (!response.ok) {
            showAlert(order.error || 'Bestellung konnte nicht aktualisiert werden.', 'danger');
            return;
        }

        renderMyOrderDetails(order);

    } catch (error) {
        console.error('Fehler beim Aktualisieren der Bestelldetails:', error);
        showAlert('Bestellung konnte nicht aktualisiert werden.', 'danger');
    }
}

function cleanupBootstrapModalState() {
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.remove();
    });

    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
}

document.addEventListener('DOMContentLoaded', () => {
    const orderDetailsModal = document.getElementById('myOrderDetailsModal');

    if (!orderDetailsModal) return;

    orderDetailsModal.addEventListener('hidden.bs.modal', () => {
        cleanupBootstrapModalState();
    });
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