let myOrders = [];

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
                    ${getReturnBadge(order.return_status)}
                </div>

                <button type="button" class="btn btn-outline-primary btn-sm"
                    onclick="openMyOrderDetails(${order.id})">
                    Details anzeigen
                </button>
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
                    <strong>Rückgabe:</strong> ${getReturnBadge(order.return_status)}
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

function getReturnBadge(status) {
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
        phone: document.getElementById('profilePhone').value.trim(),
        address: document.getElementById('profileAddress').value.trim(),
        zip: document.getElementById('profileZip').value.trim(),
        city: document.getElementById('profileCity').value.trim()
    };

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