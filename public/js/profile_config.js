let myOrders = [];

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

let myOrders = [];

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