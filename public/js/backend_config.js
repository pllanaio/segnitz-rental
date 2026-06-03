let products = [];
let filteredProducts = [];
let orders = [];
let currentOrderItems = [];
let availableCategories = [];
let currentOrderPage = 1;
const ordersPerPage = 10;

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('productForm');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const orderSearchInput = document.getElementById('orderSearchInput');
    [
        'orderYearFilter',
        'orderMonthFilter',
        'orderStatusFilter',
        'orderReturnStatusFilter',
        'orderPaymentStatusFilter'
    ].forEach(id => {
        const element = document.getElementById(id);

        if (element) {
            element.addEventListener('change', () => {
                currentOrderPage = 1;
                renderOrders();
            });
        }
    });

    loadBackendUser();
    loadProducts();
    loadCategories();
    initCategoryUi();

    form.addEventListener('submit', saveProduct);
    cancelEditBtn.addEventListener('click', resetForm);

    const backendSearchInput = document.getElementById('backendProductSearchInput');

    if (backendSearchInput) {
        backendSearchInput.addEventListener('input', () => {
            const query = backendSearchInput.value.trim().toLowerCase();

            filteredProducts = products.filter(product => {
                return [
                    product.title,
                    product.description,
                    product.product_key,
                    product.price_per_day,
                    product.deposit,
                    product.is_active ? 'aktiv' : 'inaktiv'
                ]
                    .join(' ')
                    .toLowerCase()
                    .includes(query);
            });

            renderBackendProductList();
        });
    }

    if (orderSearchInput) {
        orderSearchInput.addEventListener('input', () => {
            currentOrderPage = 1;
            renderOrders();
        });
    }
});

async function loadProducts() {
    const productList = document.getElementById('productList');

    try {
        const response = await fetch('/products');
        products = await response.json();
        filteredProducts = [...products];

        renderBackendProductList();

    } catch (error) {
        console.error('Fehler beim Laden der Produkte:', error);
        showAlert('Produkte konnten nicht geladen werden.', 'danger');
    }
}

function renderBackendProductList() {
    const productList = document.getElementById('productList');

    productList.innerHTML = '';

    if (filteredProducts.length === 0) {
        productList.innerHTML = '<div class="alert alert-info">Keine Produkte gefunden.</div>';
        return;
    }

    filteredProducts.forEach(product => {
        productList.appendChild(createProductCard(product));
    });
}

function createProductCard(product) {
    const card = document.createElement('div');
    card.className = 'card mb-3';

    card.innerHTML = `
        <div class="card-body">
            <div class="row g-3 align-items-center">
                <div class="col-12 col-md-2">
                    ${product.image_path ? `<img src="${product.image_path}" class="img-fluid rounded" alt="${product.title}">` : ''}
                </div>

                <div class="col-12 col-md-6">
                    <h5 class="mb-1">${product.title}</h5>
                    <p class="mb-1 text-muted">${product.description || ''}</p>
                    <small>
                        Key: ${product.product_key}
                        |
                        Status: ${product.is_active ? 'Aktiv' : 'Inaktiv'}
                    </small>
                </div>

                <div class="col-12 col-md-2">
                    <strong>${Number(product.price_per_day).toFixed(2)} € / Tag</strong><br>
                    <span>Kaution: ${Number(product.deposit).toFixed(2)} €</span>
                </div>

                <div class="col-12 col-md-2 text-md-end">
                    <button type="button" class="btn btn-primary btn-sm mb-2 w-100" onclick="editProduct(${product.id})">
                        Bearbeiten
                    </button>
                    <button type="button" class="btn btn-danger btn-sm w-100" onclick="deleteProduct(${product.id})">
                        Löschen
                    </button>
                </div>
            </div>
        </div>
    `;

    return card;
}

async function saveProduct(event) {
    event.preventDefault();

    const productId = document.getElementById('productId').value;
    const categories = getSelectedCategories();
    const payload = {
        productKey: document.getElementById('productKey').value.trim(),
        title: document.getElementById('title').value.trim(),
        description: document.getElementById('description').value.trim(),
        pricePerDay: Number(document.getElementById('pricePerDay').value),
        deposit: Number(document.getElementById('deposit').value),
        imagePath: '',
        category: categories[0] || '',
        categories,
        isActive: document.getElementById('isActive').checked
    };

    if (!payload.productKey || !payload.title) {
        showAlert('Produkt-Key und Titel sind Pflichtfelder.', 'warning');
        return;
    }

    try {
        const response = await fetch(productId ? `/products/${productId}` : '/products', {
            method: productId ? 'PUT' : 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Produkt konnte nicht gespeichert werden.', 'danger');
            return;
        }
        const savedProductId = productId || result.productId;

        await uploadProductImages(savedProductId);

        showAlert(result.message || 'Produkt gespeichert.', 'success');

        await loadProducts();

        const updatedProduct = products.find(product => product.id == savedProductId);

        if (updatedProduct) {
            editProduct(updatedProduct.id);
        }

        document.getElementById('productImages').value = '';
    } catch (error) {
        console.error('Fehler beim Speichern:', error);
        showAlert('Fehler beim Speichern des Produkts.', 'danger');
    }
}

function editProduct(id) {
    const product = products.find(item => item.id === id);

    if (!product) {
        return;
    }

    document.getElementById('productId').value = product.id;
    document.getElementById('productKey').value = product.product_key;
    document.getElementById('productKey').disabled = true;
    document.getElementById('title').value = product.title;
    document.getElementById('description').value = product.description || '';
    document.getElementById('pricePerDay').value = product.price_per_day;
    document.getElementById('deposit').value = product.deposit;
    const categoryNames = Array.isArray(product.categories)
        ? product.categories.map(category =>
            typeof category === 'string'
                ? category
                : category.name
        )
        : [];

    setSelectedCategories(categoryNames);
    document.getElementById('isActive').checked = product.is_active === 1;
    renderExistingImages(product);

    document.getElementById('saveProductBtn').textContent = 'Änderungen speichern';
    document.getElementById('cancelEditBtn').classList.remove('d-none');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderExistingImages(product) {
    const wrapper = document.getElementById('existingImagesWrapper');
    const container = document.getElementById('existingImages');

    container.innerHTML = '';

    if (!product.images || product.images.length === 0) {
        wrapper.classList.add('d-none');
        return;
    }

    wrapper.classList.remove('d-none');

    product.images.forEach(image => {
        const col = document.createElement('div');
        col.className = 'col-6 col-md-3 draggable-image';
        col.draggable = true;
        col.dataset.imageId = image.id;

        col.innerHTML = `
            <div class="card h-100">
                <img src="${image.path}" class="card-img-top" style="height:120px; object-fit:cover;">
                <div class="card-body p-2">
                    <small class="text-muted d-block mb-2">Ziehen zum Sortieren</small>
                    <button type="button" class="btn btn-danger btn-sm w-100">
                        Löschen
                    </button>
                </div>
            </div>
        `;

        col.querySelector('button').addEventListener('click', () => {
            deleteProductImage(image.id, product.id);
        });

        addImageDragEvents(col, product.id);

        container.appendChild(col);
    });
}

let draggedImageElement = null;

function addImageDragEvents(element, productId) {
    element.addEventListener('dragstart', () => {
        draggedImageElement = element;
        element.classList.add('dragging');
    });

    element.addEventListener('dragend', async () => {
        element.classList.remove('dragging');
        draggedImageElement = null;

        await saveImageOrder(productId);
    });

    element.addEventListener('dragover', event => {
        event.preventDefault();

        const container = document.getElementById('existingImages');
        const afterElement = getDragAfterElement(container, event.clientY);

        if (!draggedImageElement) return;

        if (afterElement == null) {
            container.appendChild(draggedImageElement);
        } else {
            container.insertBefore(draggedImageElement, afterElement);
        }
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [
        ...container.querySelectorAll('.draggable-image:not(.dragging)')
    ];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
            return {
                offset,
                element: child
            };
        }

        return closest;
    }, {
        offset: Number.NEGATIVE_INFINITY
    }).element;
}

async function saveImageOrder(productId) {
    const imageIds = [
        ...document.querySelectorAll('#existingImages .draggable-image')
    ].map(element => Number(element.dataset.imageId));

    try {
        const response = await fetch(`/products/${productId}/images/order`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ imageIds })
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Bildreihenfolge konnte nicht gespeichert werden.', 'danger');
            return;
        }

        showAlert('Bildreihenfolge gespeichert.', 'success');
        await loadProducts();

    } catch (error) {
        console.error('Fehler beim Speichern der Bildreihenfolge:', error);
        showAlert('Fehler beim Speichern der Bildreihenfolge.', 'danger');
    }
}

async function deleteProductImage(imageId, productId) {
    const confirmed = await showConfirm(
        'Möchten Sie dieses Bild wirklich löschen?',
        'Bild löschen'
    );

    if (!confirmed) {
        return;
    }
    try {
        const response = await fetch(`/product-images/${imageId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Bild konnte nicht gelöscht werden.', 'danger');
            return;
        }

        showAlert(result.message || 'Bild gelöscht.', 'success');

        await loadProducts();

        const updatedProduct = products.find(product => product.id === productId);
        if (updatedProduct) {
            renderExistingImages(updatedProduct);
        }
    } catch (error) {
        console.error('Fehler beim Löschen des Bildes:', error);
        showAlert('Fehler beim Löschen des Bildes.', 'danger');
    }
}

async function deleteProduct(id) {
    const confirmed = await showConfirm(
        'Möchten Sie dieses Produkt wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
        'Produkt löschen'
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(`/products/${id}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Produkt konnte nicht gelöscht werden.', 'danger');
            return;
        }

        showAlert(result.message || 'Produkt gelöscht.', 'success');
        loadProducts();
    } catch (error) {
        console.error('Fehler beim Löschen:', error);
        showAlert('Fehler beim Löschen des Produkts.', 'danger');
    }
}

function resetForm() {
    document.getElementById('productForm').reset();
    document.getElementById('productId').value = '';
    document.getElementById('productKey').disabled = false;
    document.getElementById('isActive').checked = true;
    document.getElementById('saveProductBtn').textContent = 'Produkt speichern';
    document.getElementById('cancelEditBtn').classList.add('d-none');
    document.getElementById('existingImagesWrapper').classList.add('d-none');
    document.getElementById('existingImages').innerHTML = '';
    setSelectedCategories([]);
}

async function loadOrders() {
    try {
        const response = await fetch('/admin/orders');
        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Bestellungen konnten nicht geladen werden.', 'danger');
            return;
        }

        orders = result;
        populateOrderFilters();
        renderOrders();

    } catch (error) {
        console.error('Fehler beim Laden der Bestellungen:', error);
        showAlert('Bestellungen konnten nicht geladen werden.', 'danger');
    }
}

function getOrderDate(order) {
    return order.created_at || order.createdAt || order.created || order.rental_start || order.rentalStart || '';
}

function getOrderYear(order) {
    const date = getOrderDate(order);
    return date ? String(date).slice(0, 4) : '';
}

function getOrderMonth(order) {
    const date = getOrderDate(order);
    return date ? String(date).slice(5, 7) : '';
}

function setSelectOptions(selectId, values, labelMap = {}) {
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

const orderStatusLabelMap = {
    reserved: 'Reserviert',
    confirmed: 'Bestätigt',
    paid: 'Bezahlt',
    active: 'Aktiv',
    picked_up: 'Abgeholt',
    returned: 'Zurückgegeben',
    cancelled: 'Storniert',
    expired: 'Abgelaufen'
};

const returnStatusLabelMap = {
    pending: 'Offen',
    returned_ok: 'Ordnungsgemäß zurückgegeben',
    returned_late: 'Verspätet zurückgegeben',
    returned_damaged: 'Beschädigt zurückgegeben',
    returned_late_damaged: 'Verspätet und beschädigt',
    not_required: 'Nicht erforderlich'
};

const paymentStatusLabelMap = {
    unpaid: 'Unbezahlt',
    pending: 'Ausstehend',
    paid: 'Bezahlt',
    failed: 'Fehlgeschlagen',
    refunded: 'Erstattet',
    cancelled: 'Abgebrochen',
    expired: 'Abgelaufen'
};

function populateOrderFilters() {
    setSelectOptions(
        'orderYearFilter',
        [...new Set(orders.map(getOrderYear))].sort().reverse()
    );

    setSelectOptions(
        'orderMonthFilter',
        [...new Set(orders.map(getOrderMonth))],
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

    setSelectOptions(
        'orderStatusFilter',
        [...new Set(orders.map(order => order.status || ''))],
        orderStatusLabelMap
    );

    setSelectOptions(
        'orderReturnStatusFilter',
        [...new Set(orders.map(order => order.return_status || ''))],
        returnStatusLabelMap
    );

    setSelectOptions(
        'orderPaymentStatusFilter',
        [...new Set(orders.map(order => order.payment_status || ''))],
        paymentStatusLabelMap
    );
}

function getOrderFilterValue(id) {
    return document.getElementById(id)?.value || '';
}

function renderOrders() {
    const container = document.getElementById('ordersList');
    const searchInput = document.getElementById('orderSearchInput');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const yearFilter = getOrderFilterValue('orderYearFilter');
    const monthFilter = getOrderFilterValue('orderMonthFilter');
    const statusFilter = getOrderFilterValue('orderStatusFilter');
    const returnStatusFilter = getOrderFilterValue('orderReturnStatusFilter');
    const paymentStatusFilter = getOrderFilterValue('orderPaymentStatusFilter');

    container.innerHTML = '';

    const visibleOrders = orders
        .filter(order => {
            if (yearFilter && getOrderYear(order) !== yearFilter) return false;
            if (monthFilter && getOrderMonth(order) !== monthFilter) return false;
            if (statusFilter && String(order.status || '') !== statusFilter) return false;
            if (returnStatusFilter && String(order.return_status || '') !== returnStatusFilter) return false;
            if (paymentStatusFilter && String(order.payment_status || '') !== paymentStatusFilter) return false;

            return [
                order.order_no,
                order.customer_email,
                order.customer_company,
                order.customer_first_name,
                order.customer_last_name,
                order.customer_phone,
                order.customer_city,
                order.status,
                order.payment_status,
                order.payment_method,
                order.return_status,
                deriveOrderDisplayState(order)
            ]
                .join(' ')
                .toLowerCase()
                .includes(query);
        })
        .sort((a, b) => String(getOrderDate(b)).localeCompare(String(getOrderDate(a))));

    if (visibleOrders.length === 0) {
        container.innerHTML = '<div class="alert alert-info">Keine Bestellungen gefunden.</div>';
        return;
    }

    const totalPages = Math.max(Math.ceil(visibleOrders.length / ordersPerPage), 1);
    currentOrderPage = Math.min(currentOrderPage, totalPages);

    const startIndex = (currentOrderPage - 1) * ordersPerPage;
    const paginatedOrders = visibleOrders.slice(startIndex, startIndex + ordersPerPage);

    paginatedOrders.forEach(order => {
        const card = document.createElement('div');
        card.className = 'card mb-3';

        card.innerHTML = `
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center gap-3">
                    <div>
                        <h5 class="mb-1">${order.order_no}</h5>
                        <div>${order.customer_first_name || ''} ${order.customer_last_name || ''}</div>
                        ${order.customer_company ? `<div class="small text-muted">${order.customer_company}</div>` : ''}
                        <small>${order.customer_email || ''}</small><br>
                        ${getOrderDisplayBadge(order)}
                        ${getPaymentBadge(order.payment_status)}
                        ${getReturnBadge(order.return_status, order.status)}
                    </div>

                    <button class="btn btn-primary btn-sm"
                        onclick="openOrderDetails(${order.id})">
                        Details
                    </button>
                </div>
            </div>
        `;

        container.appendChild(card);
    });
    const pagination = document.createElement('div');
    pagination.className = 'd-flex justify-content-between align-items-center mt-3 flex-wrap gap-2';

    pagination.innerHTML = `
    <div class="text-muted small">
        ${visibleOrders.length} Bestellung${visibleOrders.length === 1 ? '' : 'en'} gefunden,
        Seite ${currentOrderPage} von ${totalPages}
    </div>

    <div class="btn-group">
        <button type="button" class="btn btn-outline-primary btn-sm"
            ${currentOrderPage <= 1 ? 'disabled' : ''}
            onclick="changeOrderPage(-1)">
            Zurück
        </button>

        <button type="button" class="btn btn-outline-primary btn-sm"
            ${currentOrderPage >= totalPages ? 'disabled' : ''}
            onclick="changeOrderPage(1)">
            Weiter
        </button>
    </div>
`;

    container.appendChild(pagination);
}

function changeOrderPage(direction) {
    currentOrderPage += direction;
    renderOrders();
}

async function openOrderDetails(orderId) {
    try {
        const response = await fetch(`/admin/orders/${orderId}`);
        const order = await response.json();

        if (!response.ok) {
            showAlert(order.error || 'Bestellung konnte nicht geladen werden.', 'danger');
            return;
        }

        renderOrderDetails(order);

        const modal = new bootstrap.Modal(document.getElementById('orderDetailsModal'));
        modal.show();

    } catch (error) {
        console.error(error);
        showAlert('Fehler beim Laden der Bestellung.', 'danger');
    }
}

function renderOrderDetails(order) {
    const body = document.getElementById('orderDetailsBody');
    currentOrderItems = order.items || [];

    const status = String(order.status || '').trim().toLowerCase();

    const itemsHtml = currentOrderItems.length
        ? currentOrderItems.map(item => renderOrderItemCard(order, item)).join('')
        : '<div class="alert alert-info">Keine Artikel vorhanden.</div>';

    const canMarkPickedUp = ['reserved', 'confirmed', 'paid', 'active'].includes(status);

    const cancelHtml = canCancelOrder(order) ? `
        <div class="col-12">
            <hr>
            <h5>Bestellung vollständig stornieren</h5>
            <p class="text-muted">
                Storniert die komplette Bestellung inklusive aller noch aktiven Artikel.
            </p>

            <button type="button" class="btn btn-danger"
                onclick="cancelOrder(${order.id})">
                Bestellung stornieren
            </button>
        </div>
    ` : `
        <div class="col-12">
            <hr>
            <h5>Storno</h5>
            <p class="text-muted">
                Diese Bestellung kann nicht mehr vollständig storniert werden.
            </p>
        </div>
    `;

    body.innerHTML = `
        <div class="row g-4">
            <div class="col-12 col-lg-6">
                <h5>Bestellung</h5>
                <p>
                    <strong>Bestellnummer:</strong> ${order.order_no}<br>
                    <strong>Status:</strong> ${getOrderDisplayBadge(order)}<br>

                    ${status === 'cancelled' ? `
                        <strong>Storniert am:</strong> ${order.cancelled_at || '-'}<br>
                        <strong>Storniert von:</strong> ${order.cancelled_by_username || '-'}<br>
                        <strong>Stornogrund:</strong><br>
                        <span class="text-danger">${formatTextValue(order.cancel_reason)}</span><br>
                    ` : ''}

                    <strong>Zahlungsstatus:</strong> ${order.payment_status || '-'}<br>
                    <strong>Zahlungsmethode:</strong> ${order.payment_method || '-'}
                </p>
            </div>

            <div class="col-12 col-lg-6">
                <h5>Kunde</h5>
                <p>
                    <strong>${order.customer_first_name || ''} ${order.customer_last_name || ''}</strong><br>
                    ${order.customer_company ? `${order.customer_company}<br>` : ''}
                    ${order.customer_email || ''}<br>
                    ${order.customer_phone || ''}<br>
                    ${order.customer_address || ''}<br>
                    ${order.customer_zip || ''} ${order.customer_city || ''}
                </p>
            </div>

            <div class="col-12">
                <h5>Artikel</h5>
                ${itemsHtml}
                ${renderOrderFinancialSummary(order)}
            </div>
            ${cancelHtml}
        </div>
    `;
}

function renderOrderItemCard(order, item) {
    const itemStatus = item.itemStatus || item.item_status || 'active';
    const financials = calculateOrderItemFinancials(item);
    const plannedReturnDate = item.adjustedRentalEnd || item.rentalEnd;
    const actualReturnDate = item.actualReturnDate || item.returnedAt || null;
    const lateDays = actualReturnDate && plannedReturnDate
        ? Math.max(calculateRentalDays(plannedReturnDate, actualReturnDate) - 1, 0)
        : 0;
    const lateFee = lateDays * Number(item.adjustedPricePerDay || item.pricePerDay || 0);
    const adjustedStart = item.adjustedRentalStart || item.rentalStart;
    const adjustedEnd = item.adjustedRentalEnd || item.actualReturnDate || item.rentalEnd;
    const adjustedPrice = item.adjustedPricePerDay || item.pricePerDay;
    const isCancelled = itemStatus === 'cancelled';
    const isReturned = String(itemStatus).startsWith('returned_');
    const orderStatus = String(order.status || '').trim().toLowerCase();
    const isExpired = orderStatus === 'expired';
    const canEdit = ['active', 'picked_up'].includes(itemStatus) && !isExpired;
    const canCancelItem = itemStatus === 'active' && !isExpired;
    const isPickedUp = itemStatus === 'picked_up';
    const canReturn = itemStatus === 'picked_up' && !isCancelled && !isReturned && !isExpired;

    return `
        <div class="card mb-3 ${isExpired ? 'opacity-50 bg-light' : ''}">
            <div class="card-body">
                <div class="d-flex justify-content-between gap-3 flex-wrap">
                    <div>
                        <h6 class="mb-1">${item.title}</h6>
                        <div class="small text-muted">Position #${item.id}</div>

                        <div class="mt-2">
                            <strong>Mietzeitraum:</strong>
                            ${adjustedStart || '-'} bis ${adjustedEnd || '-'}
                        </div>

                        <div>
                            <strong>Preis / Tag:</strong>
                            ${Number(adjustedPrice || 0).toFixed(2)} €
                        </div>

                        <div>
                            <strong>Kaution:</strong>
                            ${Number(item.deposit || 0).toFixed(2)} €
                        </div>

                        <div class="mt-2">
                            ${getOrderItemStatusBadge(item)}
                        </div>

                        ${isCancelled ? `
                            <div class="small text-danger mt-2">
                                Storniert am: ${item.cancelledAt || '-'}<br>
                                Grund: ${formatTextValue(item.cancelReason)}
                            </div>
                        ` : ''}

                        ${isReturned ? `
                            <div class="small text-muted mt-2">
                                Rückgabe: ${item.returnedAt || '-'}<br>
                                Kaution: ${formatDepositDecision(item.depositDecision)}
                            </div>
                        ` : ''}
                    </div>

                    <div class="d-flex gap-2 flex-wrap align-items-start">
                        <button type="button"
                            class="btn btn-outline-success btn-sm"
                            ${itemStatus === 'active' ? '' : 'disabled'}
                            onclick="markOrderItemPickedUp(${order.id}, ${item.id})">
                            Als abgeholt markieren
                        </button>
                        <button type="button"
                            class="btn btn-outline-primary btn-sm"
                            ${canEdit ? '' : 'disabled'}
                            onclick="openRentalPeriodModal(${order.id}, ${item.id})">
                            Mietzeitraum verlängern
                        </button>

                        <button type="button"
                            class="btn btn-outline-danger btn-sm"
                            ${canCancelItem ? '' : 'disabled'}
                            onclick="openCancelOrderItemModal(${order.id}, ${item.id})">
                            Artikel stornieren
                        </button>

                        <button type="button"
                            class="btn btn-success btn-sm"
                            ${canReturn ? '' : 'disabled'}
                            onclick="openOrderItemReturnModal(${order.id}, ${item.id})">
                            Rückgabe
                        </button>
                    </div>
                </div>

                ${(item.returnImages || []).length > 0 ? `
                    <div class="row g-2 mt-3">
                        ${(item.returnImages || []).map(image => `
                            <div class="col-6 col-md-3">
                                <img src="${image.imagePath}" class="img-fluid rounded border">
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

<div class="mt-3 p-2 border rounded bg-light">
    <strong>Preisübersicht</strong><br>

    Miettage: ${financials.effectiveDays}<br>
    Tagespreis: ${financials.pricePerDay.toFixed(2)} € inkl. MwSt.<br>
    Miete gesamt: <strong>${financials.rentalTotal.toFixed(2)} € inkl. MwSt.</strong><br>
    Mietzeitraumverlängerung:
    ${financials.extendedDays > 0
            ? `${financials.extendedDays} zusätzliche Tag${financials.extendedDays === 1 ? '' : 'e'}`
            : 'Keine'}<br>
    Kaution:
    ${financials.deposit.toFixed(2)} €<br>
    Gesamtpreis inkl. MwSt. und Kaution:
    <strong>${financials.grossTotalWithDeposit.toFixed(2)} €</strong><br>
    ${financials.additionalCharge > 0 ? `
        Zusatzforderung:
        <span class="text-danger">${financials.additionalCharge.toFixed(2)} €</span><br>
        ${financials.additionalChargeReason ? `<small>${formatTextValue(financials.additionalChargeReason)}</small><br>` : ''}
    ` : ''}

    <hr>
    <strong>Rückgabe Soll/Ist</strong><br>
    Geplante Rückgabe: ${plannedReturnDate || '-'}<br>
    Tatsächliche Rückgabe: ${actualReturnDate || '-'}<br>
    Verspätung: ${lateDays} Tag${lateDays === 1 ? '' : 'e'}<br>
    ${lateDays > 0 ? `
    Verspätungskosten:
    <span class="text-danger">${lateFee.toFixed(2)} €</span><br>
    ` : ''}

    Kaution zurück:
    <span class="text-success">${financials.depositRefund.toFixed(2)} €</span>
    <br>
Kaution einbehalten:
<span class="text-danger">${financials.depositRetained.toFixed(2)} €</span>
</div>
${renderItemPayments(order, item)}
            </div>
        </div>
    `;
}

function loadBackendUser() {
    const backendLoginStatus = document.getElementById('backend-login-status');

    if (!backendLoginStatus) return;

    fetch('/auth-status')
        .then(res => res.json())
        .then(data => {
            backendLoginStatus.textContent = `Angemeldet als: ${data.user}`;
        })
        .catch(err => {
            console.error('Auth-Status Fehler:', err);
            backendLoginStatus.textContent = 'Benutzer konnte nicht geladen werden';
        });
}

async function uploadProductImages(productId) {
    const imageInput = document.getElementById('productImages');

    if (!imageInput || imageInput.files.length === 0) {
        return;
    }

    if (imageInput.files.length > 10) {
        throw new Error('Maximal 10 Bilder pro Produkt erlaubt.');
    }

    const formData = new FormData();

    Array.from(imageInput.files).forEach(file => {
        formData.append('images', file);
    });

    const response = await fetch(`/products/${productId}/images`, {
        method: 'POST',
        body: formData
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || 'Bilder konnten nicht hochgeladen werden.');
    }
}

function showConfirm(message, title = 'Aktion bestätigen') {
    return new Promise(resolve => {
        const modalElement = document.getElementById('confirmModal');
        const titleElement = document.getElementById('confirmModalTitle');
        const bodyElement = document.getElementById('confirmModalBody');
        const confirmBtn = document.getElementById('confirmModalConfirmBtn');

        if (!modalElement || !titleElement || !bodyElement || !confirmBtn) {
            resolve(false);
            return;
        }

        titleElement.textContent = title;
        bodyElement.textContent = message;

        const modal = new bootstrap.Modal(modalElement);

        const cleanup = () => {
            confirmBtn.removeEventListener('click', onConfirm);
            modalElement.removeEventListener('hidden.bs.modal', onCancel);
        };

        const onConfirm = () => {
            cleanup();
            modal.hide();
            resolve(true);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        confirmBtn.addEventListener('click', onConfirm);
        modalElement.addEventListener('hidden.bs.modal', onCancel, { once: true });

        modal.show();
        setTimeout(() => {
            const backdrops = document.querySelectorAll('.modal-backdrop');
            const latestBackdrop = backdrops[backdrops.length - 1];

            if (latestBackdrop) {
                latestBackdrop.style.zIndex = '3080';
            }

            modalElement.style.zIndex = '3090';
        }, 50);

    });
}

function switchBackendView(view) {
    document.getElementById('productsView')?.classList.add('d-none');
    document.getElementById('ordersView')?.classList.add('d-none');
    document.getElementById('openingHoursView')?.classList.add('d-none');

    document.getElementById('nav-products')?.classList.remove('active');
    document.getElementById('nav-orders')?.classList.remove('active');
    document.getElementById('nav-opening-hours')?.classList.remove('active');

    if (view === 'products') {
        document.getElementById('productsView')?.classList.remove('d-none');
        document.getElementById('nav-products')?.classList.add('active');
    }

    if (view === 'orders') {
        document.getElementById('ordersView')?.classList.remove('d-none');
        document.getElementById('nav-orders')?.classList.add('active');
        loadOrders();
    }

    if (view === 'opening-hours') {
        document.getElementById('openingHoursView')?.classList.remove('d-none');
        document.getElementById('nav-opening-hours')?.classList.add('active');
        loadOpeningHoursAdmin();
    }
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

    return `<span class="badge bg-${map[status] || 'secondary'} me-1">${labels[status] || status || '-'}</span>`;
}

function deriveOrderDisplayState(order) {
    const items = order.items || [];

    if (!items.length) {
        return order.status || 'unknown';
    }

    const getItemStatus = item => item.itemStatus || item.item_status || 'active';

    const cancelledItems = items.filter(item => getItemStatus(item) === 'cancelled');
    const returnedItems = items.filter(item => String(getItemStatus(item)).startsWith('returned_'));
    const damagedItems = items.filter(item =>
        ['returned_damaged', 'returned_late_damaged'].includes(getItemStatus(item))
    );

    if (cancelledItems.length === items.length) {
        return 'cancelled';
    }

    if (returnedItems.length === items.length && damagedItems.length > 0) {
        return 'completed_with_issues';
    }

    if (returnedItems.length === items.length) {
        return 'returned';
    }

    if (returnedItems.length > 0) {
        return 'partially_returned';
    }

    if (cancelledItems.length > 0) {
        return 'partially_cancelled';
    }

    return order.status || 'active';
}

function getOrderDisplayBadge(order) {
    const state = deriveOrderDisplayState(order);

    const map = {
        reserved: 'warning',
        expired: 'danger',
        paid: 'info',
        confirmed: 'primary',
        active: 'success',
        returned: 'success',
        partially_returned: 'warning',
        partially_cancelled: 'warning',
        completed_with_issues: 'danger',
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
        partially_returned: 'Teilweise zurückgegeben',
        partially_cancelled: 'Teilweise storniert',
        completed_with_issues: 'Zurückgegeben mit Klärung',
        cancelled: 'Storniert',
        picked_up: 'Abgeholt'
    };

    return `<span class="badge bg-${map[state] || 'secondary'} me-1">${labels[state] || state || '-'}</span>`;
}

function getOrderItemStatusBadge(item) {
    const status = item.itemStatus || item.item_status || 'active';

    const map = {
        active: 'primary',
        cancelled: 'dark',
        returned_ok: 'success',
        returned_late: 'warning',
        returned_damaged: 'danger',
        returned_late_damaged: 'danger',
        picked_up: 'info'
    };

    const labels = {
        active: 'Aktiv',
        cancelled: 'Storniert',
        returned_ok: 'Zurückgegeben',
        returned_late: 'Verspätet zurück',
        returned_damaged: 'Beschädigt zurück',
        returned_late_damaged: 'Verspätet + beschädigt',
        picked_up: 'Abgeholt'
    };

    return `<span class="badge bg-${map[status] || 'secondary'}">${labels[status] || status || '-'}</span>`;
}

function formatDepositDecision(value) {
    const labels = {
        pending: 'Noch offen',
        full_refund: 'Vollständig zurückzahlen',
        partial_refund: 'Teilweise zurückzahlen',
        no_refund: 'Nicht zurückzahlen'
    };

    return labels[value] || value || '-';
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
        returned_late_damaged: 'danger',
        not_required: 'dark'
    };

    const labels = {
        pending: 'Offen',
        returned_ok: 'OK',
        returned_late: 'Verspätet',
        returned_damaged: 'Beschädigt',
        returned_late_damaged: 'Verspätet + beschädigt',
        not_required: 'Geschlossen'
    };

    return `<span class="badge bg-${map[status] || 'secondary'}">
        Rückgabe: ${labels[status] || status || 'pending'}
    </span>`;
}

async function deleteReturnImage(imageId, orderId) {
    const confirmed = await showConfirm(
        'Möchten Sie dieses Rückgabefoto wirklich löschen?',
        'Rückgabefoto löschen'
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(`/admin/return-images/${imageId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Foto konnte nicht gelöscht werden.', 'danger');
            return;
        }

        showAlert(result.message || 'Foto wurde gelöscht.', 'success');

        const detailsResponse = await fetch(`/admin/orders/${orderId}`);
        const updatedOrder = await detailsResponse.json();

        if (detailsResponse.ok) {
            renderOrderDetails(updatedOrder);
        }
    } catch (error) {
        console.error('Fehler beim Löschen des Rückgabefotos:', error);
        showAlert('Foto konnte nicht gelöscht werden.', 'danger');
    }
}

async function cancelOrder(orderId) {
    const confirmed = await showConfirm(
        'Möchten Sie diese Bestellung wirklich vollständig stornieren?',
        'Bestellung stornieren'
    );

    if (!confirmed) return;

    await submitCancelOrder(orderId);
}

async function submitCancelOrder(orderId) {

    try {
        const response = await fetch(`/admin/orders/${orderId}/cancel`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Bestellung konnte nicht storniert werden.', 'danger');
            return;
        }

        showAlert(result.message || 'Bestellung wurde storniert.', 'success');

        await loadOrders();

        const detailsResponse = await fetch(`/admin/orders/${orderId}`);
        const updatedOrder = await detailsResponse.json();

        if (detailsResponse.ok) {
            renderOrderDetails(updatedOrder);
        }

    } catch (error) {
        console.error('Fehler beim Stornieren der Bestellung:', error);
        showAlert('Bestellung konnte nicht storniert werden.', 'danger');
    }
}

function canCancelOrder(order) {
    const status = String(order.status || '').trim().toLowerCase();

    if (['cancelled', 'returned', 'expired', 'picked_up'].includes(status)) {
        return false;
    }

    const items = order.items || [];

    return !items.some(item => {
        const itemStatus = item.itemStatus || item.item_status;
        return itemStatus === 'picked_up' || item.pickedUpAt || item.picked_up_at;
    });
}

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

function renderItemPayments(order, item) {

    const orderStatus = String(order.status || '').toLowerCase();
    const canAcceptPayments = !['cancelled', 'expired'].includes(orderStatus);

    const payments = order.payments || [];

    const itemPayments = payments.filter(payment =>
        Number(payment.orderItemId) === Number(item.id)
    );

    const hasPaidPayment = paymentType => itemPayments.some(payment =>
        payment.paymentType === paymentType &&
        payment.paymentStatus === 'paid'
    );

    const rentalAdjustment = itemPayments
        .filter(payment => payment.paymentType === 'rental_adjustment')
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];

    const openRentalAdjustment = itemPayments
        .filter(payment =>
            payment.paymentType === 'rental_adjustment' &&
            payment.paymentStatus !== 'paid'
        )
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];

    const returnCharge = itemPayments.find(payment =>
        payment.paymentType === 'return_additional_charge'
    );

    const depositRefund = itemPayments.find(payment =>
        payment.paymentType === 'deposit_refund'
    );

    const openCashDepositRefund = itemPayments.find(payment =>
        payment.paymentType === 'deposit_refund' &&
        payment.paymentMethod === 'cash' &&
        ['pending', 'open'].includes(payment.paymentStatus)
    );

    const depositRefundAmount = Number(item.depositRefundAmount || 0);
    const depositAmount = Number(item.deposit || 0);
    const additionalChargeAmount = Number(item.additionalChargeAmount || 0);

    const isDepositFullyOffsetByRepair =
        depositRefundAmount <= 0 &&
        depositAmount > 0 &&
        additionalChargeAmount >= depositAmount;

    const hasCashDepositRefund = itemPayments.some(payment =>
        payment.paymentType === 'deposit_refund' &&
        payment.paymentMethod === 'cash' &&
        payment.paymentStatus === 'paid'
    );

    const rentalPaid = itemPayments.some(payment =>
        payment.paymentType === 'rental' &&
        payment.paymentStatus === 'paid'
    ) || (
            String(order.payment_status || '').toLowerCase() === 'paid' &&
            String(order.payment_method || '').toLowerCase() === 'online'
        );

    const rentalPaidLabel = String(order.payment_method || '').toLowerCase() === 'online'
        ? 'Online bezahlt'
        : 'Bezahlt';

    const itemFinancials = calculateOrderItemFinancials(item);
    const rentalCashAmount = itemFinancials.originalRentalTotal;

    return `
        <div class="mt-3 p-3 border rounded bg-white">
            <strong>Zahlungen</strong><br>

            Miete:
${rentalPaid
            ? `<span class="badge bg-success">${rentalPaidLabel}</span>`
            : '<span class="badge bg-warning">Nicht bezahlt</span>'
        }

${canAcceptPayments && !rentalPaid ? `
                <button type="button"
                    class="btn btn-outline-success btn-sm ms-2"
                    onclick="openManualPaymentModal(
                        ${order.id},
                        ${item.id},
                        'rental',
                        ${Number(rentalCashAmount || 0)}
                    )">
                    Miete bar verbuchen
                </button>
            ` : ''}

            <br>

            Mietzeitraum-Nachzahlung:
            ${rentalAdjustment
            ? formatPaymentStatusBadge(rentalAdjustment.paymentStatus)
            : '<span class="badge bg-secondary">Keine</span>'
        }

            ${canAcceptPayments && openRentalAdjustment ? `
                <button type="button"
                    class="btn btn-outline-success btn-sm ms-2"
                    onclick="openManualPaymentModal(
                    ${openRentalAdjustment.orderId},
                    ${openRentalAdjustment.orderItemId || 'null'},
                    '${openRentalAdjustment.paymentType}',
                    ${Number(openRentalAdjustment.amount || 0)}
                )">
                    Barzahlung erfassen
                </button>
            ` : ''}

            <br>

            Rückgabe-Nachzahlung:
            ${returnCharge
            ? formatPaymentStatusBadge(returnCharge.paymentStatus)
            : '<span class="badge bg-secondary">Keine</span>'}

            <br>

            Kautionsrückerstattung:
            ${depositRefund
            ? formatPaymentStatusBadge(depositRefund.paymentStatus)
            : isDepositFullyOffsetByRepair
                ? '<span class="badge bg-danger">Reparaturkosten mit Kaution verrechnet</span>'
                : '<span class="badge bg-secondary">Nicht erfasst</span>'
        }

            ${openCashDepositRefund && !hasCashDepositRefund ? `
                <button type="button"
                    class="btn btn-outline-danger btn-sm ms-2"
                    onclick="openManualRefundModal(
                        ${order.id},
                        ${item.id},
                        'deposit_refund',
                        ${Math.abs(Number(openCashDepositRefund.amount || 0))}
                    )">
                    Kaution bar erstatten
                </button>
            ` : ''}



            ${canAcceptPayments && returnCharge && !hasPaidPayment('return_additional_charge') ? `
                <button type="button"
                    class="btn btn-outline-success btn-sm ms-2"
                    onclick="openManualPaymentModal(
                        ${returnCharge.orderId},
                        ${returnCharge.orderItemId || 'null'},
                        '${returnCharge.paymentType}',
                        ${Number(returnCharge.amount || 0)}
                    )">
                    Barzahlung erfassen
                </button>
            ` : ''}
        </div>
    `;
}

function openManualPaymentModal(orderId, orderItemId, paymentType, amount) {
    document.querySelector('#manualPaymentModal .modal-title').textContent = 'Barzahlung erfassen';
    document.querySelector('#manualPaymentModal .btn-success').textContent = 'Zahlung erfassen';
    document.querySelector('#manualPaymentModal .btn-success').onclick = submitManualPayment;
    document.getElementById('manualPaymentOrderId').value = orderId;
    document.getElementById('manualPaymentOrderItemId').value = orderItemId || '';
    document.getElementById('manualPaymentType').value = paymentType;
    document.getElementById('manualPaymentAmount').value = Number(amount || 0).toFixed(2);
    document.getElementById('manualPaymentNote').value = '';

    const modal = new bootstrap.Modal(document.getElementById('manualPaymentModal'));
    modal.show();
}

function openManualRefundModal(orderId, orderItemId, paymentType, amount) {
    document.getElementById('manualPaymentOrderId').value = orderId;
    document.getElementById('manualPaymentOrderItemId').value = orderItemId || '';
    document.getElementById('manualPaymentType').value = paymentType;
    document.getElementById('manualPaymentAmount').value = Number(amount || 0).toFixed(2);
    document.getElementById('manualPaymentNote').value = 'Bar-Rückerstattung an Kunden ausgezahlt';

    document.querySelector('#manualPaymentModal .modal-title').textContent = 'Bar-Rückerstattung erfassen';
    document.querySelector('#manualPaymentModal .btn-success').textContent = 'Rückerstattung erfassen';
    document.querySelector('#manualPaymentModal .btn-success').onclick = submitManualRefund;

    new bootstrap.Modal(document.getElementById('manualPaymentModal')).show();
}

async function submitManualPayment() {
    const orderId = document.getElementById('manualPaymentOrderId').value;
    const orderItemId = document.getElementById('manualPaymentOrderItemId').value;
    const paymentType = document.getElementById('manualPaymentType').value;
    const amount = Number(document.getElementById('manualPaymentAmount').value);
    const note = document.getElementById('manualPaymentNote').value.trim();

    if (!orderId || !paymentType || !amount || amount <= 0) {
        showAlert('Bitte gültige Zahlungsdaten eingeben.', 'warning');
        return;
    }

    try {
        const response = await fetch('/admin/order-payments/manual', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                orderId,
                orderItemId: orderItemId || null,
                paymentType,
                amount,
                note
            })
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Zahlung konnte nicht erfasst werden.', 'danger');
            return;
        }

        bootstrap.Modal.getInstance(document.getElementById('manualPaymentModal'))?.hide();

        showAlert(result.message || 'Zahlung wurde erfasst.', 'success');

        const detailsResponse = await fetch(`/admin/orders/${orderId}`);
        const updatedOrder = await detailsResponse.json();

        if (detailsResponse.ok) {
            renderOrderDetails(updatedOrder);
        }

        await loadOrders();

    } catch (error) {
        console.error('Fehler beim Erfassen der Barzahlung:', error);
        showAlert('Zahlung konnte nicht erfasst werden.', 'danger');
    }
}

async function submitManualRefund() {
    const orderId = document.getElementById('manualPaymentOrderId').value;
    const orderItemId = document.getElementById('manualPaymentOrderItemId').value;
    const paymentType = document.getElementById('manualPaymentType').value;
    const amount = Number(document.getElementById('manualPaymentAmount').value);
    const note = document.getElementById('manualPaymentNote').value.trim();

    if (!orderId || !paymentType || !amount || amount <= 0) {
        showAlert('Bitte gültige Rückerstattungsdaten eingeben.', 'warning');
        return;
    }

    try {
        const response = await fetch('/admin/order-payments/manual-refund', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                orderId,
                orderItemId: orderItemId || null,
                paymentType,
                amount,
                note
            })
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Rückerstattung konnte nicht erfasst werden.', 'danger');
            return;
        }

        bootstrap.Modal.getInstance(document.getElementById('manualPaymentModal'))?.hide();

        showAlert(result.message || 'Rückerstattung wurde erfasst.', 'success');

        const detailsResponse = await fetch(`/admin/orders/${orderId}`);
        const updatedOrder = await detailsResponse.json();

        if (detailsResponse.ok) {
            renderOrderDetails(updatedOrder);
        }

        await loadOrders();

    } catch (error) {
        console.error('Fehler beim Erfassen der Rückerstattung:', error);
        showAlert('Rückerstattung konnte nicht erfasst werden.', 'danger');
    }
}

function formatPaymentType(type) {
    const labels = {
        rental: 'Miete',
        rental_adjustment: 'Nachzahlung Mietzeitraum',
        return_additional_charge: 'Nachzahlung Rückgabe',
        deposit_refund: 'Kautionsrückerstattung',
        order_cancellation_refund: 'Storno-Rückerstattung'
    };

    return labels[type] || type || '-';
}

function formatPaymentStatusBadge(status) {
    const map = {
        pending: 'warning',
        paid: 'success',
        failed: 'danger',
        cancelled: 'dark',
        expired: 'secondary'
    };

    const labels = {
        pending: 'Offen',
        paid: 'Bezahlt',
        failed: 'Fehlgeschlagen',
        cancelled: 'Abgebrochen',
        expired: 'Abgelaufen'
    };

    return `<span class="badge bg-${map[status] || 'secondary'}">${labels[status] || status || '-'}</span>`;
}

const weekdayLabels = {
    1: 'Montag',
    2: 'Dienstag',
    3: 'Mittwoch',
    4: 'Donnerstag',
    5: 'Freitag',
    6: 'Samstag',
    0: 'Sonntag'
};

document.addEventListener('DOMContentLoaded', loadOpeningHoursAdmin);

async function loadOpeningHoursAdmin() {
    const container = document.getElementById('openingHoursAdmin');
    if (!container) return;

    try {
        const response = await fetch('/admin/opening-hours');
        const result = await response.json();

        if (!response.ok) {
            container.innerHTML = `<div class="alert alert-danger">${result.error || 'Öffnungszeiten konnten nicht geladen werden.'}</div>`;
            return;
        }

        renderOpeningHoursAdmin(result);
    } catch (error) {
        console.error('Fehler beim Laden der Öffnungszeiten:', error);
        container.innerHTML = '<div class="alert alert-danger">Öffnungszeiten konnten nicht geladen werden.</div>';
    }
}

function renderOpeningHoursAdmin(hours) {
    const container = document.getElementById('openingHoursAdmin');

    const normalized = [1, 2, 3, 4, 5, 6, 0].map(weekday => {
        return hours.find(day => Number(day.weekday) === weekday) || {
            weekday,
            is_open: 0,
            open_time: '',
            close_time: ''
        };
    });

    container.innerHTML = normalized.map(day => `
        <div class="row g-2 align-items-center mb-2 opening-hour-row" data-weekday="${day.weekday}">
            <div class="col-12 col-md-3">
                <strong>${weekdayLabels[day.weekday]}</strong>
            </div>

            <div class="col-12 col-md-2">
                <div class="form-check form-switch">
                    <input class="form-check-input opening-is-open" type="checkbox"
                        ${Number(day.is_open) === 1 ? 'checked' : ''}>
                    <label class="form-check-label">Geöffnet</label>
                </div>
            </div>

            <div class="col-6 col-md-3">
                <input type="time" class="form-control opening-open-time"
                    value="${day.open_time || ''}">
            </div>

            <div class="col-6 col-md-3">
                <input type="time" class="form-control opening-close-time"
                    value="${day.close_time || ''}">
            </div>
        </div>
    `).join('');
}

async function saveOpeningHours() {
    const rows = Array.from(document.querySelectorAll('.opening-hour-row'));

    const openingHours = rows.map(row => {
        const isOpen = row.querySelector('.opening-is-open').checked;

        return {
            weekday: Number(row.dataset.weekday),
            is_open: isOpen ? 1 : 0,
            open_time: row.querySelector('.opening-open-time').value || null,
            close_time: row.querySelector('.opening-close-time').value || null
        };
    });

    try {
        const response = await fetch('/admin/opening-hours', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ openingHours })
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Öffnungszeiten konnten nicht gespeichert werden.', 'danger');
            return;
        }

        showAlert(result.message || 'Öffnungszeiten gespeichert.', 'success');
        await loadOpeningHoursAdmin();
    } catch (error) {
        console.error('Fehler beim Speichern der Öffnungszeiten:', error);
        showAlert('Öffnungszeiten konnten nicht gespeichert werden.', 'danger');
    }
}

function normalizeDecimalInput(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    return String(value).replace(',', '.');
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

    if (actual <= planned) {
        return 0;
    }

    return Math.ceil((actual - planned) / (1000 * 60 * 60 * 24));
}

function todayDateString() {
    return new Date().toISOString().slice(0, 10);
}

function findCurrentOrderItem(itemId) {
    return currentOrderItems.find(item => Number(item.id) === Number(itemId));
}

function openRentalPeriodModal(orderId, itemId) {
    const item = findCurrentOrderItem(itemId);

    if (!item) {
        showAlert('Artikel wurde nicht gefunden.', 'danger');
        return;
    }

    document.getElementById('rentalPeriodOrderId').value = orderId;
    document.getElementById('rentalPeriodItemId').value = itemId;
    const isPickedUp = (item.itemStatus || item.item_status) === 'picked_up';
    const pickedUpDate = item.pickedUpAt || item.picked_up_at || todayDateString();
    document.getElementById('rentalPeriodPaymentMethod').value = 'online';

    const rentalPeriodStartInput = document.getElementById('rentalPeriodStart');

    rentalPeriodStartInput.value = isPickedUp
        ? pickedUpDate.slice(0, 10)
        : item.adjustedRentalStart || item.rentalStart || '';

    rentalPeriodStartInput.disabled = isPickedUp;

    document.getElementById('rentalPeriodEnd').value = item.adjustedRentalEnd || item.rentalEnd || '';
    document.getElementById('rentalPeriodPricePerDay').value = item.adjustedPricePerDay || item.pricePerDay || '';

    updateRentalPeriodPreview();

    ['rentalPeriodEnd'].forEach(id => {
        const element = document.getElementById(id);
        element.oninput = updateRentalPeriodPreview;
        element.onchange = updateRentalPeriodPreview;
    });

    new bootstrap.Modal(document.getElementById('orderItemRentalPeriodModal')).show();
}

function updateRentalPeriodPreview() {
    const itemId = document.getElementById('rentalPeriodItemId').value;
    const item = findCurrentOrderItem(itemId);

    if (!item) return;

    const start = document.getElementById('rentalPeriodStart').value || item.rentalStart;
    const end = document.getElementById('rentalPeriodEnd').value;
    const price = Number(item.adjustedPricePerDay || item.pricePerDay || 0);

    document.getElementById('rentalPeriodPricePerDay').value = price.toFixed(2);

    const currentStart = item.adjustedRentalStart || item.rentalStart;
    const currentEnd = item.adjustedRentalEnd || item.rentalEnd;

    const extensionStartDate = new Date(currentEnd);
    extensionStartDate.setDate(extensionStartDate.getDate() + 1);

    const extensionStart = extensionStartDate.toISOString().slice(0, 10);
    const extensionDays = calculateRentalDays(extensionStart, end);

    const currentDays = calculateRentalDays(currentStart, currentEnd);
    const newDays = calculateRentalDays(currentStart, end);

    const currentTotal = currentDays * price;
    const newTotal = newDays * price;
    const difference = Math.max(extensionDays * price, 0);

    const originalEnd = new Date(currentEnd);
    const selectedEnd = new Date(end);

    const warning = end && selectedEnd <= originalEnd
        ? '<div class="text-danger mt-2">Das neue Mietende muss nach dem bisherigen Mietende liegen.</div>'
        : '';

    document.getElementById('rentalPeriodPreview').innerHTML = `
    Ursprünglicher Preis: ${currentTotal.toFixed(2)} € inkl. MwSt.<br>
    Preis nach Verlängerung: ${newTotal.toFixed(2)} € inkl. MwSt.<br>
    Verlängerungstage: ${extensionDays}<br>
    Kunde muss zusätzlich zahlen: <strong>${difference.toFixed(2)} € inkl. MwSt.</strong>
    ${warning}
`;
}

async function submitOrderItemRentalPeriod() {
    const orderId = document.getElementById('rentalPeriodOrderId').value;
    const itemId = document.getElementById('rentalPeriodItemId').value;
    const saved = await saveOrderItemRentalAdjustment(itemId, orderId);

    if (saved) {
        bootstrap.Modal.getInstance(document.getElementById('orderItemRentalPeriodModal'))?.hide();
    }
}

function openCancelOrderItemModal(orderId, itemId) {
    document.getElementById('cancelOrderItemOrderId').value = orderId;
    document.getElementById('cancelOrderItemId').value = itemId;

    new bootstrap.Modal(document.getElementById('cancelOrderItemModal')).show();
}

async function submitCancelOrderItem() {
    const orderId = document.getElementById('cancelOrderItemOrderId').value;
    const itemId = document.getElementById('cancelOrderItemId').value;

    try {
        const response = await fetch(`/admin/order-items/${itemId}/cancel`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Artikel konnte nicht storniert werden.', 'danger');
            return;
        }

        bootstrap.Modal.getInstance(document.getElementById('cancelOrderItemModal'))?.hide();

        showAlert(result.message || 'Artikel wurde storniert.', 'success');

        await loadOrders();

        const detailsResponse = await fetch(`/admin/orders/${orderId}`);
        const updatedOrder = await detailsResponse.json();

        if (detailsResponse.ok) {
            renderOrderDetails(updatedOrder);
        }
    } catch (error) {
        console.error('Fehler beim Stornieren der Bestellposition:', error);
        showAlert('Artikel konnte nicht storniert werden.', 'danger');
    }
}

function openOrderItemReturnModal(orderId, itemId) {
    const item = findCurrentOrderItem(itemId);

    if (!item) {
        showAlert('Artikel wurde nicht gefunden.', 'danger');
        return;
    }

    document.getElementById('returnOrderId').value = orderId;
    document.getElementById('returnItemId').value = itemId;
    document.getElementById('returnActualDate').value = item.actualReturnDate || todayDateString();
    const isPickedUp = (item.itemStatus || item.item_status) === 'picked_up';
    const pickedUpDate = item.pickedUpAt || item.picked_up_at || item.adjustedRentalStart || item.rentalStart || '';

    const returnAdjustedStartInput = document.getElementById('returnAdjustedStart');

    returnAdjustedStartInput.value = isPickedUp
        ? pickedUpDate.slice(0, 10)
        : item.adjustedRentalStart || item.rentalStart || '';

    returnAdjustedStartInput.disabled = isPickedUp;

    document.getElementById('returnAdjustedEnd').value = item.adjustedRentalEnd || item.actualReturnDate || item.rentalEnd || '';
    document.getElementById('returnPricePerDay').value = item.adjustedPricePerDay || item.pricePerDay || '';
    document.getElementById('returnStatus').value = item.returnStatus || 'returned_ok';
    document.getElementById('returnDepositDecision').value = item.depositDecision || 'pending';
    document.getElementById('returnIsDamaged').checked = Boolean(item.isDamaged);
    document.getElementById('returnDamageDescription').value = item.damageDescription || '';
    document.getElementById('returnIsLate').checked = Boolean(item.isLate);
    document.getElementById('returnLateDescription').value = item.lateDescription || '';
    document.getElementById('returnDepositDeductionPercent').value = item.depositDeductionPercent || '';
    document.getElementById('returnDepositRefundAmount').value = item.depositRefundAmount || '';
    document.getElementById('returnDepositDeductionReason').value = item.depositDeductionReason || '';
    document.getElementById('returnAdditionalChargeReason').value = item.additionalChargeReason || '';
    document.getElementById('returnAdditionalChargeAmount').value = item.additionalChargeAmount || '';
    document.getElementById('returnNotes').value = item.returnNotes || '';
    document.getElementById('returnImageUpload').value = '';
    document.getElementById('returnExistingImages').innerHTML = (item.returnImages || []).map(image => `
        <div class="col-6 col-md-3">
            <img src="${image.imagePath}" class="img-fluid rounded border">
        </div>
    `).join('');

    [
        'returnActualDate',
        'returnAdjustedStart',
        'returnAdjustedEnd',
        'returnPricePerDay',
        'returnStatus',
        'returnDepositDecision',
        'returnIsDamaged',
        'returnIsLate',
        'returnDepositDeductionPercent',
        'returnAdditionalChargeAmount'
    ].forEach(id => {
        const element = document.getElementById(id);
        element.oninput = applyOrderItemReturnModalRules;
        element.onchange = applyOrderItemReturnModalRules;
    });

    applyOrderItemReturnModalRules();

    new bootstrap.Modal(document.getElementById('orderItemReturnModal')).show();
}

function applyOrderItemReturnModalRules(triggerSource = 'auto') {
    const itemId = document.getElementById('returnItemId').value;
    const item = findCurrentOrderItem(itemId);

    if (!item) return;

    const actualReturnDate = document.getElementById('returnActualDate').value;
    const adjustedEnd = document.getElementById('returnAdjustedEnd').value || item.rentalEnd;
    const isDamagedInput = document.getElementById('returnIsDamaged');
    const isLateInput = document.getElementById('returnIsLate');
    const returnStatusInput = document.getElementById('returnStatus');
    const depositDecisionInput = document.getElementById('returnDepositDecision');
    const refundAmountInput = document.getElementById('returnDepositRefundAmount');
    const deductionPercentInput = document.getElementById('returnDepositDeductionPercent');
    const deductionReasonInput = document.getElementById('returnDepositDeductionReason');

    const lateDays = calculateLateDays(actualReturnDate, adjustedEnd);
    const pricePerDay = Number(item.adjustedPricePerDay || item.pricePerDay || 0);
    const lateFee = lateDays * pricePerDay;

    if (lateDays > 0) {
        isLateInput.checked = true;
    }

    const isLate = isLateInput.checked;
    const isDamaged = isDamagedInput.checked;
    const repairCosts = Number(
        normalizeDecimalInput(document.getElementById('returnAdditionalChargeAmount').value) || 0
    );
    const deposit = Number(item.deposit || 0);

    let returnStatus = 'returned_ok';

    if (isDamaged && isLate) {
        returnStatus = 'returned_late_damaged';
    } else if (isDamaged) {
        returnStatus = 'returned_damaged';
    } else if (isLate) {
        returnStatus = 'returned_late';
    }

    const refundAmount = isDamaged
        ? Math.max(deposit - repairCosts, 0)
        : deposit;

    const retainedAmount = Math.max(deposit - refundAmount, 0);
    const customerAdditionalDue = (
        isDamaged
            ? Math.max(repairCosts - deposit, 0)
            : repairCosts
    ) + lateFee;

    returnStatusInput.value = returnStatus;
    depositDecisionInput.value = refundAmount > 0 ? 'full_refund' : 'no_refund';
    refundAmountInput.value = refundAmount.toFixed(2);
    deductionPercentInput.value = deposit > 0
        ? ((retainedAmount / deposit) * 100).toFixed(2)
        : 0;
    deductionReasonInput.value = isDamaged
        ? 'Reparaturkosten mit Kaution verrechnet'
        : '';

    document.getElementById('returnPricePerDay').value =
        Number(item.adjustedPricePerDay || item.pricePerDay || 0).toFixed(2);

    document.getElementById('returnPricePreview').innerHTML = `
        <strong>Rückgabe-Abrechnung</strong><br>
        Status: ${formatReturnStatusLabel(returnStatus)}<br>
        Kaution: ${deposit.toFixed(2)} €<br>
        Reparaturkosten: ${repairCosts.toFixed(2)} €<br>
        Kaution zurück: <span class="text-success">${refundAmount.toFixed(2)} €</span><br>
        Mit Kaution verrechnet: <span class="text-danger">${retainedAmount.toFixed(2)} €</span><br>
        Verspätung: ${lateDays} Tag${lateDays === 1 ? '' : 'e'}<br>
        Verspätungskosten: ${lateFee.toFixed(2)} €<br>
        Kunde muss zusätzlich zahlen: <strong>${customerAdditionalDue.toFixed(2)} €</strong>
    `;
}

function formatReturnStatusLabel(status) {
    const labels = {
        returned_ok: 'Ordnungsgemäß zurückgegeben',
        returned_late: 'Verspätet zurückgegeben',
        returned_damaged: 'Beschädigt zurückgegeben',
        returned_late_damaged: 'Verspätet und beschädigt'
    };

    return labels[status] || status || '-';
}

async function saveOrderItemRentalAdjustment(itemId, orderId) {
    const payload = {
        adjustedRentalStart: document.getElementById('rentalPeriodStart').value || null,
        adjustedRentalEnd: document.getElementById('rentalPeriodEnd').value || null,
        adjustedPricePerDay: normalizeDecimalInput(
            document.getElementById('rentalPeriodPricePerDay').value
        ),
        paymentMethod: document.getElementById('rentalPeriodPaymentMethod').value
    };

    try {
        const response = await fetch(`/admin/order-items/${itemId}/rental-adjustment`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Mietzeitraum konnte nicht gespeichert werden.', 'danger');
            return false;
        }

        showAlert(result.message || 'Mietzeitraum gespeichert.', 'success');

        await loadOrders();

        if (orderId) {
            const detailsResponse = await fetch(`/admin/orders/${orderId}`);
            const updatedOrder = await detailsResponse.json();

            if (detailsResponse.ok) {
                renderOrderDetails(updatedOrder);
            }
        }

        return true;

    } catch (error) {
        console.error('Fehler beim Speichern des Mietzeitraums:', error);
        showAlert('Mietzeitraum konnte nicht gespeichert werden.', 'danger');
        return false;
    }
}

async function saveOrderItemReturn(itemId, orderId) {
    applyOrderItemReturnModalRules();

    const payload = {
        actualReturnDate: document.getElementById('returnActualDate').value || null,
        adjustedRentalStart: document.getElementById('returnAdjustedStart').value || null,
        adjustedRentalEnd: document.getElementById('returnAdjustedEnd').value || null,
        adjustedPricePerDay: normalizeDecimalInput(
            document.getElementById('returnPricePerDay').value
        ),
        returnStatus: document.getElementById('returnStatus').value,
        isDamaged: document.getElementById('returnIsDamaged').checked,
        damageDescription: document.getElementById('returnDamageDescription').value.trim(),
        isLate: document.getElementById('returnIsLate').checked,
        lateDescription: document.getElementById('returnLateDescription').value.trim(),
        depositDecision: document.getElementById('returnDepositDecision').value,
        depositDeductionPercent: document.getElementById('returnDepositDeductionPercent').value || null,
        depositRefundAmount: normalizeDecimalInput(
            document.getElementById('returnDepositRefundAmount').value
        ),
        depositDeductionReason: document.getElementById('returnDepositDeductionReason').value.trim(),
        additionalChargeReason: document.getElementById('returnAdditionalChargeReason').value.trim(),
        additionalChargeAmount: normalizeDecimalInput(
            document.getElementById('returnAdditionalChargeAmount').value
        ),
        additionalChargePaymentMethod: 'online',
        returnNotes: document.getElementById('returnNotes').value.trim()

    };

    try {
        const response = await fetch(`/admin/order-items/${itemId}/return`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Rückgabe konnte nicht gespeichert werden.', 'danger');
            return;
        }

        await sendReturnSummaryEmailForItem(itemId);

        const detailsResponse = await fetch(`/admin/orders/${orderId}`);
        const updatedOrder = await detailsResponse.json();

        if (detailsResponse.ok) {
            currentOrderItems = updatedOrder.items || [];
            renderOrderDetails(updatedOrder);
        }

        bootstrap.Modal.getInstance(document.getElementById('orderItemReturnModal'))?.hide();
        setTimeout(restoreOrderDetailsModalLayer, 300);

        showAlert(result.message || 'Rückgabe gespeichert.', 'success');

        await loadOrders();

        if (orderId) {
            const detailsResponse = await fetch(`/admin/orders/${orderId}`);
            const updatedOrder = await detailsResponse.json();

            if (detailsResponse.ok) {
                renderOrderDetails(updatedOrder);

                setTimeout(() => {
                    const detailsModalElement = document.getElementById('orderDetailsModal');
                    bootstrap.Modal.getOrCreateInstance(detailsModalElement).show();
                }, 300);
            }
        }

    } catch (error) {
        console.error('Fehler beim Speichern der Positionsrückgabe:', error);
        showAlert('Rückgabe konnte nicht gespeichert werden.', 'danger');
    }
}

async function submitOrderItemReturn() {
    showAlert(
        'Achtung: Die Rückgabe wird beim Speichern festgeschrieben und kann danach nicht mehr rückgängig gemacht werden.',
        'warning'
    );

    const confirmed = await showConfirm(
        'Die Rückgabe wird festgeschrieben und kann danach nicht mehr geändert oder rückgängig gemacht werden. Möchten Sie fortfahren?',
        'Rückgabe festschreiben'
    );

    if (!confirmed) {
        return;
    }

    const orderId = document.getElementById('returnOrderId').value;
    const itemId = document.getElementById('returnItemId').value;

    await saveOrderItemReturn(itemId, orderId);
}

async function uploadReturnImagesForCurrentReturn(itemId) {
    const input = document.getElementById('returnImageUpload');

    if (!input || input.files.length === 0) {
        return;
    }

    const formData = new FormData();

    Array.from(input.files).forEach(file => {
        formData.append('images', file);
    });

    const response = await fetch(`/admin/order-items/${itemId}/return-images`, {
        method: 'POST',
        body: formData
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || 'Fotos konnten nicht hochgeladen werden.');
    }

    input.value = '';
}

function calculateOrderItemFinancials(item) {
    const originalDays = calculateRentalDays(item.rentalStart, item.rentalEnd);

    const effectiveStart = item.adjustedRentalStart || item.rentalStart;
    const effectiveEnd = item.adjustedRentalEnd || item.rentalEnd;
    const plannedEnd = item.adjustedRentalEnd || item.rentalEnd;
    const actualReturnDate = item.actualReturnDate || null;
    const lateDays = calculateLateDays(actualReturnDate, plannedEnd);

    const effectiveDays = calculateRentalDays(effectiveStart, effectiveEnd);
    const extendedDays = Math.max(
        calculateRentalDays(item.rentalStart, item.adjustedRentalEnd || item.rentalEnd) - originalDays,
        0
    );

    const pricePerDay = Number(item.adjustedPricePerDay || item.pricePerDay || 0);
    const lateFee = lateDays * pricePerDay;
    const rentalTotal = effectiveDays * pricePerDay;
    const originalRentalTotal = originalDays * Number(item.pricePerDay || 0);
    const rentalAdjustment = rentalTotal - originalRentalTotal;

    const deposit = Number(item.deposit || 0);
    const depositRefund = Number(item.depositRefundAmount ?? deposit);
    const depositRetained = Math.max(deposit - depositRefund, 0);
    const repairCharge = Number(item.additionalChargeAmount || 0);
    const additionalCharge = repairCharge + lateFee;
    const grossTotalWithDeposit = rentalTotal + deposit;
    const customerAdditionalDue = Math.max(repairCharge - deposit, 0) + lateFee;
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
        lateDays,
        lateFee,
        repairCharge,
        additionalChargeReason: item.additionalChargeReason || ''
    };
}

function renderOrderFinancialSummary(order) {
    const items = order.items || [];

    const payments = order.payments || [];

    const paidRentalAdjustments = payments
        .filter(payment =>
            payment.paymentType === 'rental_adjustment' &&
            payment.paymentStatus === 'paid'
        )
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    const paidReturnAdditionalCharges = payments
        .filter(payment =>
            payment.paymentType === 'return_additional_charge' &&
            payment.paymentStatus === 'paid'
        )
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

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
        sum.customerAdditionalDue += f.customerAdditionalDue;
        sum.customerCredit += f.customerCredit;
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
        additionalCharges: 0,
        customerAdditionalDue: 0,
        customerCredit: 0
    });
    const chargeableRentalAdjustment = Math.max(totals.rentalAdjustment, 0);

    const paidDepositRefunds = payments
        .filter(payment =>
            payment.paymentType === 'deposit_refund' &&
            payment.paymentStatus === 'paid'
        )
        .reduce((sum, payment) => sum + Math.abs(Number(payment.amount || 0)), 0);

    const refundableDeposit = Math.max(
        totals.customerCredit - paidDepositRefunds,
        0
    );

    const totalAdditionalDue =
        chargeableRentalAdjustment +
        totals.customerAdditionalDue;

    const totalPaidAdditionalCharges =
        paidRentalAdjustments +
        paidReturnAdditionalCharges;

    const remainingAdditionalDue = Math.max(
        totalAdditionalDue - totalPaidAdditionalCharges,
        0
    );

    const finalBalance =
        remainingAdditionalDue -
        refundableDeposit;

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
                Zusatzforderungen: <span class="text-danger">${totals.additionalCharges.toFixed(2)} €</span><br>
                Bezahlte Mietzeitraum-Nachzahlungen:
                <span class="text-success">${paidRentalAdjustments.toFixed(2)} €</span><br>
                Bezahlte Rückgabe-Nachzahlungen:
                <span class="text-success">${paidReturnAdditionalCharges.toFixed(2)} €</span>
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

async function sendReturnSummaryEmailForItem(itemId) {
    const response = await fetch(`/admin/order-items/${itemId}/send-return-summary`, {
        method: 'POST'
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || 'Abschlussmail konnte nicht versendet werden.');
    }
}

function restoreOrderDetailsModalLayer() {
    const detailsModal = document.getElementById('orderDetailsModal');

    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.style.zIndex = '';
    });

    if (detailsModal && detailsModal.classList.contains('show')) {
        document.body.classList.add('modal-open');
    }
}

function normalizeCategoryName(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ');
}

async function loadCategories() {
    try {
        const response = await fetch('/categories');
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Kategorien konnten nicht geladen werden.');
        }

        availableCategories = result.map(category => category.name);
        renderCategorySuggestions();
    } catch (error) {
        console.error('Fehler beim Laden der Kategorien:', error);
        availableCategories = [];
    }
}

function getSelectedCategories() {
    const input = document.getElementById('category');

    return String(input.value || '')
        .split(',')
        .map(normalizeCategoryName)
        .filter(Boolean);
}

function setSelectedCategories(categories) {
    const input = document.getElementById('category');

    const uniqueCategories = [];
    const seen = new Set();

    categories
        .map(normalizeCategoryName)
        .filter(Boolean)
        .forEach(category => {
            const key = category.toLowerCase();

            if (!seen.has(key)) {
                seen.add(key);
                uniqueCategories.push(category);
            }
        });

    input.value = uniqueCategories.join(', ');

    renderCategoryTags(uniqueCategories);
    renderCategorySuggestions();
}

function categoryExists(categoryName) {
    const key = normalizeCategoryName(categoryName).toLowerCase();

    return availableCategories.some(category =>
        normalizeCategoryName(category).toLowerCase() === key
    );
}

function selectedCategoryExists(categoryName) {
    const key = normalizeCategoryName(categoryName).toLowerCase();

    return getSelectedCategories().some(category =>
        normalizeCategoryName(category).toLowerCase() === key
    );
}

function addCategory(category) {
    const normalized = normalizeCategoryName(category);

    if (!normalized) return;

    if (selectedCategoryExists(normalized)) {
        showAlert('Diese Kategorie ist diesem Produkt bereits zugeordnet.', 'warning');
        return;
    }

    setSelectedCategories([
        ...getSelectedCategories(),
        normalized
    ]);

    if (!categoryExists(normalized)) {
        availableCategories.push(normalized);
        availableCategories.sort((a, b) => a.localeCompare(b, 'de'));
    }

    const input = document.getElementById('categoryInput');

    if (input) {
        input.value = '';
        input.focus();
    }

    renderCategorySuggestions();
}

function removeCategory(category) {
    const key = normalizeCategoryName(category).toLowerCase();

    const categories = getSelectedCategories()
        .filter(item => item.toLowerCase() !== key);

    setSelectedCategories(categories);
}

function renderCategoryTags(categories = getSelectedCategories()) {
    const container = document.getElementById('categoryTags');

    container.innerHTML = '';

    if (categories.length === 0) {
        container.innerHTML =
            '<span class="text-muted small">Keine Kategorien ausgewählt</span>';
        return;
    }

    categories.forEach(category => {
        const badge = document.createElement('span');

        badge.className =
            'badge rounded-pill bg-primary d-inline-flex align-items-center gap-2 px-3 py-2';

        const label = document.createElement('span');
        label.textContent = category;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-close btn-close-white';
        button.setAttribute('aria-label', 'Entfernen');
        button.addEventListener('click', () => removeCategory(category));

        badge.appendChild(label);
        badge.appendChild(button);

        container.appendChild(badge);
    });
}

function renderCategorySuggestions() {
    const container = document.getElementById('categorySuggestionList');

    if (!container) return;

    const query = normalizeCategoryName(
        document.getElementById('categoryInput')?.value || ''
    ).toLowerCase();

    const selected = getSelectedCategories()
        .map(category => category.toLowerCase());

    const suggestions = availableCategories
        .filter(category => !selected.includes(category.toLowerCase()))
        .filter(category =>
            !query || category.toLowerCase().includes(query)
        )
        .sort((a, b) => a.localeCompare(b, 'de'));

    container.innerHTML = '';

    suggestions.forEach(category => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-outline-secondary btn-sm me-2 mb-2';
        button.textContent = category;

        button.addEventListener('click', () => {
            addCategory(category);
        });

        container.appendChild(button);
    });
}

function initCategoryUi() {
    const input = document.getElementById('categoryInput');
    const addBtn = document.getElementById('addCategoryBtn');

    if (!input || !addBtn) return;

    addBtn.addEventListener('click', () => {
        addCategory(input.value);
    });

    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            addCategory(input.value);
        }
    });

    input.addEventListener('input', renderCategorySuggestions);

    renderCategoryTags();
    renderCategorySuggestions();
}

async function uploadReturnImagesBeforeSave() {
    const itemId = document.getElementById('returnItemId').value;
    const orderId = document.getElementById('returnOrderId').value;

    if (!itemId || !orderId) {
        showAlert('Artikel wurde nicht gefunden.', 'danger');
        return;
    }

    try {
        await uploadReturnImagesForCurrentReturn(itemId);

        const detailsResponse = await fetch(`/admin/orders/${orderId}`);
        const updatedOrder = await detailsResponse.json();

        if (detailsResponse.ok) {
            currentOrderItems = updatedOrder.items || [];

            const updatedItem = currentOrderItems.find(
                item => Number(item.id) === Number(itemId)
            );

            document.getElementById('returnExistingImages').innerHTML =
                (updatedItem?.returnImages || []).map(image => `
                    <div class="col-6 col-md-3">
                        <img src="${image.imagePath}" class="img-fluid rounded border">
                    </div>
                `).join('');
        }

        showAlert('Rückgabefotos wurden hochgeladen.', 'success');

    } catch (error) {
        console.error('Fehler beim Hochladen der Rückgabefotos:', error);
        showAlert('Rückgabefotos konnten nicht hochgeladen werden.', 'danger');
    }
}

async function markOrderPickedUp(orderId) {
    const confirmed = await showConfirm(
        'Soll diese Bestellung als abgeholt markiert werden?',
        'Abholung bestätigen'
    );

    if (!confirmed) return;

    const response = await fetch(`/admin/orders/${orderId}/pick-up`, {
        method: 'PUT'
    });

    const result = await response.json();

    if (!response.ok) {
        showAlert(result.error || 'Bestellung konnte nicht als abgeholt markiert werden.', 'danger');
        return;
    }

    showAlert(result.message || 'Bestellung wurde als abgeholt markiert.', 'success');
    await loadOrders();

    const detailsResponse = await fetch(`/admin/orders/${orderId}`);
    const updatedOrder = await detailsResponse.json();

    if (detailsResponse.ok) {
        renderOrderDetails(updatedOrder);
    }

    setTimeout(restoreOrderDetailsModalLayer, 300);
}

async function markOrderItemPickedUp(orderId, itemId) {
    try {
        const response = await fetch(`/admin/order-items/${itemId}/pickup`, {
            method: 'PUT'
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Artikel konnte nicht als abgeholt markiert werden.', 'danger');
            return;
        }

        showAlert(result.message || 'Artikel wurde als abgeholt markiert.', 'success');

        await loadOrders();

        const detailsResponse = await fetch(`/admin/orders/${orderId}`);
        const updatedOrder = await detailsResponse.json();

        if (detailsResponse.ok) {
            renderOrderDetails(updatedOrder);
        }
    } catch (error) {
        console.error('Fehler beim Markieren des Artikels als abgeholt:', error);
        showAlert('Artikel konnte nicht als abgeholt markiert werden.', 'danger');
    }
}

function logout() {
    fetch('/logout', {
        method: 'POST'
    })
        .then(response => {
            if (response.ok) {
                window.location.href = 'index.html';
            } else {
                showAlert('Fehler beim Abmelden', 'danger');
            }
        })
        .catch(error => {
            console.error('Netzwerkfehler beim Logout:', error);
        });
}