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
    const items = order.items || [];

    const hasRentalStartingTodayOrPast = items.some(item =>
        isRentalStartTodayOrPast(item.rentalStart)
    );

    return ['reserved', 'confirmed'].includes(status) && !hasRentalStartingTodayOrPast;
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
                    ${getReturnBadge(deriveMyOrderReturnStatus(order), order.status)}
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

    const itemsHtml = (order.items || [])
        .map(item => renderMyOrderItemCard(item, order))
        .join('');

    const status = String(order.status || '').trim().toLowerCase();
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
        ? uniqueReviewItems.map(item => renderReviewCard(item, order.id)).join('')
        : '';

    const cancelButtonHtml = canCancelOrder(order)
        ? `
            <button type="button" class="btn btn-outline-danger btn-sm mt-3"
                onclick="cancelMyOrder(${order.id})">
                Bestellung stornieren
            </button>
        `
        : '';

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

                    <strong>Zahlung:</strong> ${getPaymentBadge(order.payment_status)}
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
                ${itemsHtml || '<div class="alert alert-info">Keine Artikel vorhanden.</div>'}
            </div>

            <div class="col-12">
                ${renderMyOrderFinancialSummary(order)}
            </div>

            ${canReview ? `
                <div class="col-12">
                    <h5>Produkte bewerten</h5>
                    ${reviewButtonsHtml}
                </div>
            ` : ''}

            ${cancelButtonHtml}
        </div>
    `;
}

function renderReviewCard(item, orderId) {
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
                    <textarea class="form-control form-control-sm"
                        id="reviewText-${item.productId}" rows="2"></textarea>
                </div>

                <button type="button"
                    class="btn btn-outline-success btn-sm"
                    onclick="submitProductReview(${item.productId}, ${orderId})">
                    Bewertung speichern
                </button>
            </div>
        </div>
    `;
}

function isRentalStartTodayOrPast(rentalStart) {
    if (!rentalStart) return false;

    const today = new Date().toISOString().slice(0, 10);
    return String(rentalStart).slice(0, 10) <= today;
}

function renderMyOrderItemCard(item, order) {
    const financials = calculateOrderItemFinancials(item);
    const itemStatus = item.itemStatus || item.item_status || 'active';
    const orderStatus = String(order?.status || '').trim().toLowerCase();
    const canCancelItem =
        itemStatus === 'active' &&
        !['expired', 'cancelled', 'picked_up', 'returned'].includes(orderStatus) &&
        !isRentalStartTodayOrPast(item.rentalStart);

    const imagesHtml = (item.returnImages || []).length === 0
        ? '<div class="text-muted small">Keine Rückgabefotos zu diesem Artikel vorhanden.</div>'
        : `
            <div class="row g-2 mt-2">
                ${(item.returnImages || []).map(image => `
                    <div class="col-6 col-md-3">
                        <a href="/${image.imagePath}" target="_blank">
                            <img src="/${image.imagePath}" class="img-fluid rounded border"
                                style="height: 120px; object-fit: cover; width: 100%;">
                        </a>
                    </div>
                `).join('')}
            </div>
        `;

    return `
        <div class="card mb-3">
        <div class="card-body">
    <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-2">
        <div>
            <h6 class="mb-1">${item.title}</h6>
            <div class="small text-muted">Position #${item.id}</div>
        </div>

        ${canCancelItem ? `
            <button type="button"
                class="btn btn-outline-danger btn-sm"
                onclick="cancelMyOrderItem(${item.orderId || item.order_id}, ${item.id})">
                Artikel stornieren
            </button>
        ` : ''}
    </div>
                <div>
                    <strong>Mietzeitraum:</strong>
                    ${item.rentalStart || '-'} bis ${item.rentalEnd || '-'}
                </div>

                ${(item.adjustedRentalStart || item.adjustedRentalEnd || item.actualReturnDate) ? `
                    <div>
                        <strong>Aktueller Zeitraum:</strong>
                        ${item.adjustedRentalStart || item.rentalStart || '-'} bis
                        ${item.adjustedRentalEnd || item.actualReturnDate || item.rentalEnd || '-'}
                    </div>
                ` : ''}

                <div>
                    <strong>Rückgabe:</strong> ${getReturnBadge(item.returnStatus, order?.status)}
                </div>

<div class="mt-3 p-2 border rounded bg-light">
    <strong>Preisübersicht</strong><br>

    Miettage: ${financials.effectiveDays}<br>
    Tagespreis: ${financials.pricePerDay.toFixed(2)} € inkl. MwSt.<br>

    Mietzeitraumverlängerung:
    ${financials.extendedDays > 0
            ? `${financials.extendedDays} zusätzliche Tag${financials.extendedDays === 1 ? '' : 'e'}`
            : 'Keine'}<br>

    Miete gesamt:
    <strong>${financials.rentalTotal.toFixed(2)} € inkl. MwSt.</strong><br>

    Kaution:
    ${financials.deposit.toFixed(2)} €<br>

    Gesamtpreis inkl. MwSt. und Kaution:
    <strong>${financials.grossTotalWithDeposit.toFixed(2)} €</strong><br>

    ${financials.additionalCharge > 0 ? `
        Zusatzforderung:
        <span class="text-danger">${financials.additionalCharge.toFixed(2)} €</span><br>
        ${financials.additionalChargeReason ? `<small>${formatTextValue(financials.additionalChargeReason)}</small><br>` : ''}
    ` : ''}

    Kaution zurück:
    <span class="text-success">${financials.depositRefund.toFixed(2)} €</span>
</div>
<br>
Kaution einbehalten:
<span class="text-danger">${financials.depositRetained.toFixed(2)} €</span>

                <div class="mt-3">
                    <strong>Rückgabefotos</strong>
                    ${imagesHtml}
                </div>
            </div>
        </div>
    `;
}

function calculateRentalDays(startDate, endDate) {
    if (!startDate || !endDate) return 0;

    const start = new Date(startDate);
    const end = new Date(endDate);

    return Math.max(
        Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1,
        0
    );
}

function calculateOrderItemFinancials(item) {
    const originalDays = calculateRentalDays(item.rentalStart, item.rentalEnd);

    const effectiveStart = item.adjustedRentalStart || item.rentalStart;
    const effectiveEnd = item.actualReturnDate || item.adjustedRentalEnd || item.rentalEnd;

    const effectiveDays = calculateRentalDays(effectiveStart, effectiveEnd);
    const extendedDays = Math.max(
        calculateRentalDays(item.rentalStart, item.adjustedRentalEnd || item.rentalEnd) - originalDays,
        0
    );

    const pricePerDay = Number(item.adjustedPricePerDay || item.pricePerDay || 0);
    const rentalTotal = effectiveDays * pricePerDay;
    const originalRentalTotal = originalDays * Number(item.pricePerDay || 0);
    const rentalAdjustment = rentalTotal - originalRentalTotal;

    const deposit = Number(item.deposit || 0);
    const depositRefund = Number(item.depositRefundAmount ?? deposit);
    const depositRetained = Math.max(deposit - depositRefund, 0);
    const additionalCharge = Number(item.additionalChargeAmount || 0);

    const grossTotalWithDeposit = rentalTotal + deposit;
    const customerAdditionalDue = additionalCharge;
    const customerCredit = depositRefund;

    return {
        originalDays,
        effectiveDays,
        extendedDays,
        pricePerDay,
        rentalTotal,
        deposit,
        depositRefund,
        depositRetained,
        additionalCharge,
        grossTotalWithDeposit,
        customerAdditionalDue,
        customerCredit,
        originalRentalTotal,
        rentalAdjustment,
        additionalChargeReason: item.additionalChargeReason || ''
    };
}

function renderMyOrderFinancialSummary(order) {
    const items = order.items || [];

    const itemRows = items.map(item => {
        const f = calculateOrderItemFinancials(item);

        return `
            <div class="border-bottom py-2">
                <strong>${item.title}</strong><br>
                Miettage: ${f.effectiveDays}<br>
                Tagespreis: ${f.pricePerDay.toFixed(2)} € inkl. MwSt.<br>
                Miete gesamt: ${f.rentalTotal.toFixed(2)} € inkl. MwSt.<br>
                Kaution: ${f.deposit.toFixed(2)} €<br>
                ${f.additionalCharge > 0 ? `Zusatzforderung: ${f.additionalCharge.toFixed(2)} €<br>` : ''}
                ${f.depositRefund > 0 ? `Kaution zurück: ${f.depositRefund.toFixed(2)} €<br>` : ''}
            </div>
        `;
    }).join('');

    const totals = items.reduce((sum, item) => {
        const f = calculateOrderItemFinancials(item);

        sum.rentalTotal += f.rentalTotal;
        sum.deposit += f.deposit;
        sum.depositRefund += f.depositRefund;
        sum.depositRetained += f.depositRetained;
        sum.additionalCharges += f.additionalCharge;
        sum.originalRentalTotal += f.originalRentalTotal;
        sum.rentalAdjustment += f.rentalAdjustment;

        return sum;
    }, {
        rentalTotal: 0,
        deposit: 0,
        depositRefund: 0,
        depositRetained: 0,
        originalRentalTotal: 0,
        rentalAdjustment: 0,
        additionalCharges: 0
    });

    const chargeableRentalAdjustment = Math.max(totals.rentalAdjustment, 0);

    const finalBalance =
        chargeableRentalAdjustment +
        totals.additionalCharges -
        totals.depositRefund;

    const finalBalanceClass =
        finalBalance > 0
            ? 'text-danger'
            : finalBalance < 0
                ? 'text-success'
                : 'text-muted';

    const finalBalanceLabel =
        finalBalance > 0
            ? 'Kunde muss insgesamt nachzahlen'
            : finalBalance < 0
                ? 'Kunde erhält insgesamt zurück'
                : 'Bestellung vollständig ausgeglichen';

    return `
        <div class="card mt-4">
            <div class="card-header">
                <strong>Gesamtpreisberechnung</strong>
            </div>

            <div class="card-body">
                ${itemRows || '<div class="text-muted">Keine Positionen vorhanden.</div>'}

                <hr>

                <strong>Gesamtsummen</strong><br>
                Ursprüngliche Miete: ${totals.originalRentalTotal.toFixed(2)} € inkl. MwSt.<br>
                Mietpreis-Korrektur:
                <span class="${totals.rentalAdjustment > 0 ? 'text-danger' : totals.rentalAdjustment < 0 ? 'text-muted' : ''}">
                ${totals.rentalAdjustment.toFixed(2)} €
                </span>
                ${totals.rentalAdjustment < 0 ? '<br><small class="text-muted">Nicht als Mietrückerstattung berücksichtigt.</small>' : ''}
                <br>
                Miete gesamt: ${totals.rentalTotal.toFixed(2)} € inkl. MwSt.<br>
                Kaution gesamt: ${totals.deposit.toFixed(2)} €<br>
                Kaution zurück: <span class="text-success">${totals.depositRefund.toFixed(2)} €</span><br>
                Kaution einbehalten: <span class="text-danger">${totals.depositRetained.toFixed(2)} €</span><br>
                Zusatzforderungen: <span class="text-danger">${totals.additionalCharges.toFixed(2)} €</span>

                <hr>

                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <strong>${finalBalanceLabel}</strong>
                    <div class="fs-4 fw-bold ${finalBalanceClass}">
                        ${Math.abs(finalBalance).toFixed(2)} €
                    </div>
                </div>
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
        cancelled: 'dark',
        picked_up: 'info'
    };

    const labels = {
        reserved: 'Reserviert',
        expired: 'Abgelaufen',
        paid: 'Bezahlt',
        confirmed: 'Bestätigt',
        active: 'Aktiv',
        returned: 'Zurückgegeben',
        cancelled: 'Storniert',
        picked_up: 'Abgeholt'
    };

    return `<span class="badge bg-${map[status] || 'secondary'}">${labels[status] || status || '-'}</span>`;
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

function deriveMyOrderReturnStatus(order) {
    const items = order.items || [];

    if (!items.length) return 'pending';

    if (items.some(item => item.returnStatus === 'returned_late_damaged')) {
        return 'returned_late_damaged';
    }

    if (items.some(item => item.returnStatus === 'returned_damaged')) {
        return 'returned_damaged';
    }

    if (items.some(item => item.returnStatus === 'returned_late')) {
        return 'returned_late';
    }

    if (items.every(item => item.returnStatus === 'returned_ok')) {
        return 'returned_ok';
    }

    return 'pending';
}

function getReturnBadge(status, orderStatus = null) {
    if (['cancelled', 'expired'].includes(orderStatus)) {
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

async function cancelMyOrderItem(orderId, itemId) {
    const confirmed = window.confirm(
        'Möchten Sie diesen Artikel wirklich stornieren?'
    );

    if (!confirmed) return;

    try {
        const response = await fetch(`/my-orders/${orderId}/items/${itemId}/cancel`, {
            method: 'POST'
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Artikel konnte nicht storniert werden.', 'danger');
            return;
        }

        showAlert(result.message || 'Artikel wurde storniert.', 'success');

        await loadMyOrders();
        await refreshMyOrderDetails(orderId);

    } catch (error) {
        console.error('Fehler beim Stornieren des Artikels:', error);
        showAlert('Artikel konnte nicht storniert werden.', 'danger');
    }
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