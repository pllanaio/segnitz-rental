let myOrders = [];
let currentMyOrderPage = 1;
const myOrdersPerPage = 10;
let myOrderPagination = {
    page: 1,
    limit: myOrdersPerPage,
    total: 0,
    totalPages: 1
};
let myOrderFilterOptions = {
    years: [],
    months: [],
    statuses: [],
    returnStatuses: [],
    paymentStatuses: []
};

async function handleProfileActionClick(event) {
    const button = event.target.closest('[data-profile-action]');

    if (!button || button.disabled) return;

    const action = button.dataset.profileAction;
    const orderId = Number(button.dataset.orderId);
    const productId = Number(button.dataset.productId);

    const actions = {
        'open-order-details': () => openMyOrderDetails(orderId),
        'change-order-page': () => changeMyOrderPage(Number(button.dataset.direction)),
        'submit-review': () => submitProductReview(productId, orderId)
    };

    await window.PendingActions.run(button, async () => actions[action]?.());
}

document.addEventListener('DOMContentLoaded', async () => {
    document.addEventListener('click', handleProfileActionClick);

    document.querySelectorAll('[data-profile-view]').forEach(button => {
        button.addEventListener('click', () => switchProfileView(button.dataset.profileView));
    });

    document.getElementById('profileLogoutButton')?.addEventListener('click', logout);

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

        initMyOrderFilters();
        await loadMyOrders();

    } catch (error) {
        const box = document.getElementById('profileError');
        box.textContent = 'Profil konnte nicht geladen werden.';
        box.classList.remove('d-none');
    }
});

function initMyOrderFilters() {
    [
        'myOrderYearFilter',
        'myOrderMonthFilter',
        'myOrderStatusFilter',
        'myOrderReturnStatusFilter',
        'myOrderPaymentStatusFilter'
    ].forEach(id => {
        const element = document.getElementById(id);

        if (element) {
            element.addEventListener('change', async () => {
                currentMyOrderPage = 1;
                await loadMyOrders();
            });
        }
    });
}

function getMyOrderDate(order) {
    return order.created_at || order.createdAt || order.created || order.rental_start || order.rentalStart || '';
}

function getMyOrderYear(order) {
    const date = getMyOrderDate(order);
    return date ? String(date).slice(0, 4) : '';
}

function getMyOrderMonth(order) {
    const date = getMyOrderDate(order);
    return date ? String(date).slice(5, 7) : '';
}

function getMyOrderFilterValue(id) {
    return document.getElementById(id)?.value || '';
}

function setMyOrderSelectOptions(selectId, values, labelMap = {}) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const currentValue = select.value;
    const firstLabel = select.options[0]?.textContent || 'Alle';

    select.innerHTML = `<option value="">${firstLabel}</option>`;

    values
        .filter(Boolean)
        .sort()
        .forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = labelMap[value] || value;
            select.appendChild(option);
        });

    select.value = currentValue;
}

function populateMyOrderFilters() {
    setMyOrderSelectOptions(
        'myOrderYearFilter',
        myOrderFilterOptions.years || []
    );

    setMyOrderSelectOptions(
        'myOrderMonthFilter',
        myOrderFilterOptions.months || [],
        {
            '01': 'Januar',
            '02': 'Februar',
            '03': 'März',
            '04': 'April',
            '05': 'Mai',
            '06': 'Juni',
            '07': 'Juli',
            '08': 'August',
            '09': 'September',
            '10': 'Oktober',
            '11': 'November',
            '12': 'Dezember'
        }
    );

    setMyOrderSelectOptions('myOrderStatusFilter', myOrderFilterOptions.statuses || []);
    setMyOrderSelectOptions('myOrderReturnStatusFilter', myOrderFilterOptions.returnStatuses || []);
    setMyOrderSelectOptions('myOrderPaymentStatusFilter', myOrderFilterOptions.paymentStatuses || []);
}

async function loadMyOrders() {
    const container = document.getElementById('myOrdersList');

    if (!container) return;

    try {
        const params = new URLSearchParams({
            page: String(currentMyOrderPage),
            limit: String(myOrdersPerPage)
        });

        const filters = {
            year: getMyOrderFilterValue('myOrderYearFilter'),
            month: getMyOrderFilterValue('myOrderMonthFilter'),
            status: getMyOrderFilterValue('myOrderStatusFilter'),
            returnStatus: getMyOrderFilterValue('myOrderReturnStatusFilter'),
            paymentStatus: getMyOrderFilterValue('myOrderPaymentStatusFilter')
        };

        Object.entries(filters).forEach(([key, value]) => {
            if (value) params.set(key, value);
        });

        const response = await fetch(`/my-orders?${params.toString()}`);
        const result = await response.json();

        if (!response.ok) {
            container.innerHTML = `<div class="alert alert-warning">${escapeHtml(result.error || 'Bestellungen konnten nicht geladen werden.')}</div>`;
            return;
        }

        myOrders = Array.isArray(result.items) ? result.items : [];
        myOrderPagination = result.pagination || myOrderPagination;
        myOrderFilterOptions = result.filterOptions || myOrderFilterOptions;
        populateMyOrderFilters();
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

    const visibleOrders = myOrders;

    if (visibleOrders.length === 0) {
        container.innerHTML = '<div class="alert alert-info">Keine Bestellungen für diese Filter gefunden.</div>';
        return;
    }

    const totalPages = Math.max(Number(myOrderPagination.totalPages || 1), 1);
    currentMyOrderPage = Math.min(currentMyOrderPage, totalPages);

    container.innerHTML = visibleOrders.map(order => `
        <div class="card mb-2">
            <div class="card-body d-flex justify-content-between align-items-center gap-3">
                <div>
                    <strong>${escapeHtml(order.order_no)}</strong><br>
                    ${getStatusBadge(order.status)}
                    ${getPaymentBadge(order.payment_status)}
                    ${getReturnBadge(deriveMyOrderReturnStatus(order), order.status)}
                    ${getReturnCaseBadge(order.return_case_status, order.status)}
                </div>

                <div class="d-flex gap-2 flex-wrap justify-content-end">
                    <button type="button" class="btn btn-outline-primary btn-sm"
                        data-profile-action="open-order-details" data-order-id="${order.id}">
                        Details anzeigen
                    </button>
                </div>
            </div>
        </div>
    `).join('');

    const pagination = document.createElement('div');
    pagination.className = 'd-flex justify-content-between align-items-center mt-3 flex-wrap gap-2';

    pagination.innerHTML = `
        <div class="text-muted small">
            ${Number(myOrderPagination.total || 0)} Bestellung${Number(myOrderPagination.total || 0) === 1 ? '' : 'en'} gefunden,
            Seite ${currentMyOrderPage} von ${totalPages}
        </div>

        <div class="btn-group">
            <button type="button" class="btn btn-outline-primary btn-sm"
                ${currentMyOrderPage <= 1 ? 'disabled' : ''}
                data-profile-action="change-order-page" data-direction="-1">
                Zurück
            </button>

            <button type="button" class="btn btn-outline-primary btn-sm"
                ${currentMyOrderPage >= totalPages ? 'disabled' : ''}
                data-profile-action="change-order-page" data-direction="1">
                Weiter
            </button>
        </div>
    `;

    container.appendChild(pagination);
}

async function changeMyOrderPage(direction) {
    currentMyOrderPage += direction;
    await loadMyOrders();
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

    body.innerHTML = `
        <div class="row g-4">
            <div class="col-12 col-lg-6">
                <h5>Bestellung</h5>
                <p>
                    <strong>Bestellnummer:</strong> ${escapeHtml(order.order_no)}<br>
                    <strong>Status:</strong> ${getStatusBadge(order.status)}<br>

                    ${order.status === 'cancelled' ? `
                        <strong>Storniert am:</strong> ${escapeHtml(order.cancelled_at || '-')}<br>
                        ${order.cancel_reason ? `
                            <strong>Stornogrund:</strong><br>
                            <span class="text-danger">${formatTextValue(order.cancel_reason)}</span><br>
                        ` : ''}
                    ` : ''}

                    <strong>Zahlung:</strong> ${getPaymentBadge(order.payment_status)}<br>
                    <strong>Rückgabeabwicklung:</strong>
                    ${getReturnCaseBadge(order.return_case_status, order.status) || '-'}
                </p>
            </div>

            <div class="col-12 col-lg-6">
                <h5>Kunde</h5>
                <p>
                    <strong>${escapeHtml(order.customer_first_name || '')} ${escapeHtml(order.customer_last_name || '')}</strong><br>
                    ${escapeHtml(order.customer_email || '')}<br>
                    ${escapeHtml(order.customer_phone || '')}<br>
                    ${escapeHtml(order.customer_address || '')}<br>
                    ${escapeHtml(order.customer_zip || '')} ${escapeHtml(order.customer_city || '')}
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
        </div>
    `;
}

function renderReviewCard(item, orderId) {
    if (item.review) {
        return `
            <div class="card mt-3">
                <div class="card-body">
                    <h6>Ihre Bewertung für ${escapeHtml(item.title)}</h6>
                    <div class="mb-2">
                        <strong>Sterne:</strong>
                        ${'★'.repeat(Number(item.review.rating))}
                        ${'☆'.repeat(5 - Number(item.review.rating))}
                    </div>
                    <div class="mb-2">
                        <strong>Kommentar:</strong><br>
                        <div class="border rounded p-2 bg-light">
                            ${item.review.reviewText
                                ? escapeHtml(item.review.reviewText)
                                : '<span class="text-muted">Kein Kommentar</span>'}
                        </div>
                    </div>
                    <div class="text-muted small">
                        Bewertet am: ${escapeHtml(window.SegnitzDate.formatInstant(item.review.createdAt))}
                    </div>
                </div>
            </div>
        `;
    }

    return `
        <div class="card mt-3">
            <div class="card-body">
                <h6>Bewertung für ${escapeHtml(item.title)}</h6>

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
                        id="reviewText-${item.productId}" rows="2" maxlength="2000"></textarea>
                    <div class="form-text">
                        Maximal 2000 Zeichen. Öffentlich erscheinen Ihr Vorname und nur der
                        Anfangsbuchstabe Ihres Nachnamens.
                    </div>
                </div>

                <button type="button"
                    class="btn btn-outline-success btn-sm"
                    data-profile-action="submit-review"
                    data-product-id="${item.productId}"
                    data-order-id="${orderId}">
                    Bewertung speichern
                </button>
            </div>
        </div>
    `;
}

function renderMyOrderItemCard(item, order) {
    const financials = calculateOrderItemFinancials(item);
    const itemStatus = item.itemStatus || item.item_status || 'active';
    const orderStatus = String(order?.status || '').trim().toLowerCase();

    const imagesHtml = (item.returnImages || []).length === 0
        ? '<div class="text-muted small">Keine Rückgabefotos zu diesem Artikel vorhanden.</div>'
        : `
            <div class="row g-2 mt-2">
                ${(item.returnImages || []).map(image => `
                    <div class="col-6 col-md-3">
                        <a href="/${escapeHtml(image.imagePath)}" target="_blank" rel="noopener noreferrer">
                            <img src="/${escapeHtml(image.imagePath)}" class="img-fluid rounded border"
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
            <h6 class="mb-1">${escapeHtml(item.title)}</h6>
            <div class="small text-muted">Position #${escapeHtml(item.id)}</div>
        </div>
    </div>
                <div>
                    <strong>Mietzeitraum:</strong>
                    ${escapeHtml(item.rentalStart || '-')} bis ${escapeHtml(item.rentalEnd || '-')}
                </div>

                ${(item.adjustedRentalStart || item.adjustedRentalEnd || item.actualReturnDate) ? `
                    <div>
                        <strong>Aktueller Zeitraum:</strong>
                        ${escapeHtml(item.adjustedRentalStart || item.rentalStart || '-')} bis
                        ${escapeHtml(item.adjustedRentalEnd || item.actualReturnDate || item.rentalEnd || '-')}
                    </div>
                ` : ''}

                <div>
                    <strong>Rückgabe:</strong> ${getReturnBadge(item.returnStatus, order?.status)}
                </div>

<div class="admin-price-panel mt-3">
    <div class="summary-section-label">Preisübersicht</div>

    <div class="checkout-summary-row">
        <span>Miettage</span>
        <strong>${financials.effectiveDays}</strong>
    </div>

    <div class="checkout-summary-row">
        <span>Tagespreis inkl. MwSt.</span>
        <strong>${financials.pricePerDay.toFixed(2)} €</strong>
    </div>

    <div class="checkout-summary-row">
        <span>Miete gesamt inkl. MwSt.</span>
        <strong>${financials.rentalTotal.toFixed(2)} €</strong>
    </div>

    <div class="checkout-summary-row">
        <span>Kaution</span>
        <strong>${financials.deposit.toFixed(2)} €</strong>
    </div>

    <div class="checkout-summary-total-row">
        <span>Gesamt inkl. Kaution</span>
        <strong>${financials.grossTotalWithDeposit.toFixed(2)} €</strong>
    </div>

    ${financials.extendedDays > 0 ? `
        <hr>
        <div class="checkout-summary-row">
            <span>Mietzeitraumverlängerung</span>
            <strong>${financials.extendedDays} zusätzliche Tag${financials.extendedDays === 1 ? '' : 'e'}</strong>
        </div>
    ` : ''}

    ${(item.actualReturnDate || item.returnStatus || item.additionalChargeReason) ? `
        <hr>
        <div class="summary-section-label">Rückgabe</div>

        ${item.actualReturnDate ? `
            <div class="checkout-summary-row">
                <span>Rückgabedatum</span>
                <strong>${escapeHtml(item.actualReturnDate)}</strong>
            </div>
        ` : ''}

        ${item.returnStatus ? `
            <div class="checkout-summary-row">
                <span>Rückgabestatus</span>
                <strong>${getReturnBadge(item.returnStatus, order?.status)}</strong>
            </div>
        ` : ''}

        ${financials.additionalCharge > 0 ? `
            <div class="checkout-summary-row">
                <span>Reparatur-/Zusatzkosten</span>
                <strong class="text-danger">${financials.additionalCharge.toFixed(2)} €</strong>
            </div>
        ` : ''}

        ${financials.additionalChargeReason ? `
            <div class="small text-muted">
                Grund: ${formatTextValue(financials.additionalChargeReason)}
            </div>
        ` : ''}
    ` : ''}

    <hr>

    <div class="summary-section-label">Kaution nach Rückgabe</div>

    <div class="checkout-summary-row">
        <span>Kaution zurück</span>
        <strong class="text-success">${financials.depositRefund.toFixed(2)} €</strong>
    </div>

    <div class="checkout-summary-row">
        <span>Kaution einbehalten</span>
        <strong class="text-danger">${financials.depositRetained.toFixed(2)} €</strong>
    </div>
</div>

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

function calculateLateDays(actualReturnDate, plannedReturnDate) {
    if (!actualReturnDate || !plannedReturnDate) return 0;

    const actual = new Date(String(actualReturnDate).slice(0, 10));
    const planned = new Date(String(plannedReturnDate).slice(0, 10));

    if (actual <= planned) return 0;
    return Math.ceil((actual - planned) / (1000 * 60 * 60 * 24));
}

function calculateOrderItemFinancials(item) {
    if (!item.financials) throw new Error('Finanzdaten fehlen. Bitte die Bestellung erneut laden.');
    return item.financials;
}

function renderMyOrderFinancialSummary(order) {
    return window.OrderFinanceView.render(order.financialSummary, order.payments);
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
        picked_up: 'info',
        pending_payment: 'warning',
        payment_failed: 'danger',
        payment_dispute: 'danger'
    };

    const labels = {
        reserved: 'Reserviert',
        expired: 'Abgelaufen',
        paid: 'Bezahlt',
        confirmed: 'Bestätigt',
        active: 'Aktiv',
        returned: 'Zurückgegeben',
        cancelled: 'Storniert',
        picked_up: 'Abgeholt',
        pending_payment: 'Zahlung ausstehend',
        payment_failed: 'Zahlung fehlgeschlagen',
        payment_dispute: 'Zahlung strittig'
    };

    return `<span class="badge bg-${map[status] || 'secondary'}">${labels[status] || status || '-'}</span>`;
}

function getPaymentBadge(status) {
    const map = {
        paid: 'success',
        unpaid: 'warning',
        pending: 'warning',
        open: 'warning',
        authorized: 'info',
        failed: 'danger',
        cancelled: 'dark',
        expired: 'dark',
        refunded: 'secondary',
        refund_pending: 'warning',
        refund_failed: 'danger',
        charged_back: 'danger'
    };

    const labels = {
        paid: 'Bezahlt',
        unpaid: 'Unbezahlt',
        pending: 'Ausstehend',
        open: 'Ausstehend',
        authorized: 'Autorisiert',
        failed: 'Fehlgeschlagen',
        cancelled: 'Storniert',
        expired: 'Abgelaufen',
        refunded: 'Erstattet',
        refund_pending: 'Erstattung läuft',
        refund_failed: 'Erstattung fehlgeschlagen',
        charged_back: 'Rückbelastet'
    };

    return `<span class="badge bg-${map[status] || 'secondary'} me-1">
        Zahlung: ${labels[status] || status || '-'}
    </span>`;
}

function deriveMyOrderReturnStatus(order) {
    const items = (order.items || []).filter(item =>
        !['cancelled', 'expired'].includes(String(item.itemStatus || '').toLowerCase()) &&
        item.returnStatus !== 'not_required'
    );

    if (!items.length) return 'not_required';

    const hasLateReturn = items.some(item =>
        ['returned_late', 'returned_late_damaged'].includes(item.returnStatus)
    );
    const hasDamagedReturn = items.some(item =>
        ['returned_damaged', 'returned_late_damaged'].includes(item.returnStatus)
    );

    if (hasLateReturn && hasDamagedReturn) {
        return 'returned_late_damaged';
    }

    if (hasDamagedReturn) {
        return 'returned_damaged';
    }

    if (hasLateReturn) {
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
        returned_late_damaged: 'danger',
        not_required: 'dark'
    };

    const labels = {
        pending: 'Offen',
        returned_ok: 'OK',
        returned_late: 'Verspätet',
        returned_damaged: 'Beschädigt',
        returned_late_damaged: 'Verspätet + beschädigt',
        not_required: 'Nicht erforderlich'
    };

    return `<span class="badge bg-${map[status] || 'secondary'}">
        Rückgabe: ${labels[status] || status || 'pending'}
    </span>`;
}

function getReturnCaseBadge(status, orderStatus = null) {
    const normalizedStatus = String(status || '').toLowerCase();
    const normalizedOrderStatus = String(orderStatus || '').toLowerCase();

    if (!normalizedStatus) return '';
    if (normalizedStatus === 'open' && normalizedOrderStatus !== 'picked_up') return '';

    const map = {
        open: 'info',
        partial: 'warning',
        payment_pending: 'warning',
        payment_failed: 'danger',
        refund_pending: 'warning',
        refund_failed: 'danger',
        payment_dispute: 'danger',
        closed: 'success'
    };
    const labels = {
        open: 'Rückgabe offen',
        partial: 'Teilrückgabe offen',
        payment_pending: 'Nachzahlung offen',
        payment_failed: 'Nachzahlung fehlgeschlagen',
        refund_pending: 'Erstattung offen',
        refund_failed: 'Erstattung fehlgeschlagen',
        payment_dispute: 'Zahlung strittig',
        closed: 'Abgeschlossen'
    };

    return `<span class="badge bg-${map[normalizedStatus] || 'secondary'} me-1">
        Abwicklung: ${labels[normalizedStatus] || normalizedStatus}
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

window.PendingActions.bindForm(document.getElementById('profileForm'), async (event) => {
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

    if (!window.ContactContract.isValidPhone(payload.phone)) {
        showAlert('Bitte eine gültige Telefonnummer mit Ländervorwahl eingeben.', 'warning');
        return;
    }

    if (!window.ContactContract.isValidPostalCode(payload.zip)) {
        showAlert('Bitte eine gültige Postleitzahl eingeben.', 'warning');
        return;
    }

    if (!window.ContactContract.isSafeAddress(payload.address)) {
        showAlert('Bitte eine gültige Adresse ohne Steuerzeichen eingeben.', 'warning');
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


    } catch (error) {
        console.error('Fehler beim Speichern der Profildaten:', error);
        showAlert('Profildaten konnten nicht gespeichert werden.', 'danger');
    }
});

window.PendingActions.bindForm(document.getElementById('passwordForm'), async (event) => {
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
        if (value.message) return escapeHtml(value.message);
        if (value.reason) return escapeHtml(value.reason);
        if (value.text) return escapeHtml(value.text);

        return escapeHtml(JSON.stringify(value));
    }

    return escapeHtml(value);
}

function getSafeCheckoutUrl(value) {
    try {
        const checkoutUrl = new URL(String(value || ''));
        return checkoutUrl.protocol === 'https:' ? checkoutUrl.href : null;
    } catch (error) {
        return null;
    }
}

function allowOnlyDigits(input) {
    input.setCustomValidity((input.id.toLowerCase().includes('phone') ? window.ContactContract.isValidPhone(input.value) : window.ContactContract.isValidPostalCode(input.value)) ? '' : 'Bitte die Kontaktdaten prüfen.');
}

function allowAddressChars(input) {
    input.setCustomValidity(window.ContactContract.isSafeAddress(input.value) ? '' : 'Bitte eine gültige Adresse eingeben.');
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

async function submitProductReview(productId, orderId) {
    const ratingInput = document.getElementById(`rating-${productId}`);
    const reviewTextInput = document.getElementById(`reviewText-${productId}`);

    const rating = ratingInput ? ratingInput.value : '';
    const reviewText = reviewTextInput ? reviewTextInput.value.trim() : '';

    if (!rating) {
        showAlert('Bitte wählen Sie eine Sternebewertung aus.', 'warning');
        return;
    }

    if (reviewText.length > 2000) {
        showAlert('Der Bewertungstext darf maximal 2000 Zeichen lang sein.', 'warning');
        return;
    }

    const submitButton = document.querySelector(
        `button[data-profile-action="submit-review"][data-product-id="${productId}"][data-order-id="${orderId}"]`
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
