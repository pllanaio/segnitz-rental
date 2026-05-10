let products = [];
let filteredProducts = [];
let orders = [];
let currentOrderItems = [];

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('productForm');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const orderSearchInput = document.getElementById('orderSearchInput');

    loadBackendUser();
    loadProducts();

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

    const payload = {
        productKey: document.getElementById('productKey').value.trim(),
        title: document.getElementById('title').value.trim(),
        description: document.getElementById('description').value.trim(),
        pricePerDay: Number(document.getElementById('pricePerDay').value),
        deposit: Number(document.getElementById('deposit').value),
        imagePath: '',
        category: document.getElementById('category').value.trim(),
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
    document.getElementById('category').value = product.category || '';
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
        renderOrders();

    } catch (error) {
        console.error('Fehler beim Laden der Bestellungen:', error);
        showAlert('Bestellungen konnten nicht geladen werden.', 'danger');
    }
}

function renderOrders() {
    const container = document.getElementById('ordersList');
    const searchInput = document.getElementById('orderSearchInput');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

    container.innerHTML = '';

    const visibleOrders = orders.filter(order => {
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
            deriveOrderDisplayState(order)
        ]
            .join(' ')
            .toLowerCase()
            .includes(query);
    });

    if (visibleOrders.length === 0) {
        container.innerHTML = '<div class="alert alert-info">Keine Bestellungen gefunden.</div>';
        return;
    }

    visibleOrders.forEach(order => {
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
    const adjustedStart = item.adjustedRentalStart || item.rentalStart;
    const adjustedEnd = item.adjustedRentalEnd || item.actualReturnDate || item.rentalEnd;
    const adjustedPrice = item.adjustedPricePerDay || item.pricePerDay;
    const isCancelled = itemStatus === 'cancelled';
    const isReturned = String(itemStatus).startsWith('returned_');
    const canEdit = itemStatus === 'active';
    const canReturn = !isCancelled;

    return `
        <div class="card mb-3">
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
                            class="btn btn-outline-primary btn-sm"
                            ${canEdit ? '' : 'disabled'}
                            onclick="openRentalPeriodModal(${order.id}, ${item.id})">
                            Zeitraum ändern
                        </button>

                        <button type="button"
                            class="btn btn-outline-danger btn-sm"
                            ${canEdit ? '' : 'disabled'}
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

    Ursprüngliche Miete brutto:
    ${financials.originalGross.toFixed(2)} €<br>

    Aktuelle Miete brutto:
    ${financials.adjustedGross.toFixed(2)} €<br>

    Differenz Mietzeitraum:
    <span class="${financials.rentalDeltaGross > 0 ? 'text-danger' : financials.rentalDeltaGross < 0 ? 'text-success' : ''}">
        ${financials.rentalDeltaGross.toFixed(2)} €
    </span><br>

    Kaution:
    ${financials.deposit.toFixed(2)} €<br>

    Kaution zurück:
    <span class="text-success">${financials.depositRefund.toFixed(2)} €</span><br>

    Kaution einbehalten:
    <span class="text-danger">${financials.depositRetained.toFixed(2)} €</span><br>

    Reparaturkosten / Zusatzforderung:
    <span class="text-danger">${financials.additionalCharge.toFixed(2)} €</span>
    ${financials.additionalChargeReason ? `<br><small>${formatTextValue(financials.additionalChargeReason)}</small>` : ''}
</div>

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
        cancelled: 'dark'
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
        cancelled: 'Storniert'
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
        returned_late_damaged: 'danger'
    };

    const labels = {
        active: 'Aktiv',
        cancelled: 'Storniert',
        returned_ok: 'Zurückgegeben',
        returned_late: 'Verspätet zurück',
        returned_damaged: 'Beschädigt zurück',
        returned_late_damaged: 'Verspätet + beschädigt'
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

function cancelOrder(orderId) {
    document.getElementById('cancelOrderId').value = orderId;
    document.getElementById('cancelReason').value = '';

    const modal = new bootstrap.Modal(document.getElementById('cancelOrderModal'));
    modal.show();
}

async function submitCancelOrder() {
    const orderId = document.getElementById('cancelOrderId').value;
    const reason = document.getElementById('cancelReason').value.trim();

    if (!reason) {
        showAlert('Bitte geben Sie einen Stornogrund ein.', 'warning');
        return;
    }

    try {
        const response = await fetch(`/admin/orders/${orderId}/cancel`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cancelReason: reason
            })
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Bestellung konnte nicht storniert werden.', 'danger');
            return;
        }

        bootstrap.Modal.getInstance(document.getElementById('cancelOrderModal'))?.hide();

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
    return !['cancelled', 'returned', 'expired'].includes(status);
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

function calculateLateDays(actualReturnDate, adjustedRentalEnd) {
    if (!actualReturnDate || !adjustedRentalEnd) return 0;

    const actual = new Date(actualReturnDate);
    const end = new Date(adjustedRentalEnd);

    if (actual <= end) return 0;

    return Math.ceil((actual - end) / (1000 * 60 * 60 * 24));
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
    document.getElementById('rentalPeriodStart').value = item.adjustedRentalStart || item.rentalStart || '';
    document.getElementById('rentalPeriodEnd').value = item.adjustedRentalEnd || item.rentalEnd || '';
    document.getElementById('rentalPeriodPricePerDay').value = item.adjustedPricePerDay || item.pricePerDay || '';

    updateRentalPeriodPreview();

    ['rentalPeriodStart', 'rentalPeriodEnd', 'rentalPeriodPricePerDay'].forEach(id => {
        const element = document.getElementById(id);
        element.oninput = updateRentalPeriodPreview;
        element.onchange = updateRentalPeriodPreview;
    });

    new bootstrap.Modal(document.getElementById('orderItemRentalPeriodModal')).show();
}

function updateRentalPeriodPreview() {
    const start = document.getElementById('rentalPeriodStart').value;
    const end = document.getElementById('rentalPeriodEnd').value;
    const price = Number(normalizeDecimalInput(document.getElementById('rentalPeriodPricePerDay').value) || 0);
    const days = calculateRentalDays(start, end);
    const total = days * price;

    document.getElementById('rentalPeriodPreview').innerHTML = `
        Tage: ${days}<br>
        Gesamt netto: ${total.toFixed(2)} €
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
    document.getElementById('cancelOrderItemReason').value = '';

    new bootstrap.Modal(document.getElementById('cancelOrderItemModal')).show();
}

async function submitCancelOrderItem() {
    const orderId = document.getElementById('cancelOrderItemOrderId').value;
    const itemId = document.getElementById('cancelOrderItemId').value;
    const reason = document.getElementById('cancelOrderItemReason').value.trim();

    if (!reason) {
        showAlert('Bitte geben Sie einen Stornogrund ein.', 'warning');
        return;
    }

    try {
        const response = await fetch(`/admin/order-items/${itemId}/cancel`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cancelReason: reason
            })
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
    document.getElementById('returnAdjustedStart').value = item.adjustedRentalStart || item.rentalStart || '';
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

function applyOrderItemReturnModalRules() {
    const itemId = document.getElementById('returnItemId').value;
    const item = findCurrentOrderItem(itemId);

    if (!item) return;

    const actualReturnDate = document.getElementById('returnActualDate').value;
    const adjustedEnd = document.getElementById('returnAdjustedEnd').value || item.rentalEnd;

    const isDamagedInput = document.getElementById('returnIsDamaged');
    const isLateInput = document.getElementById('returnIsLate');
    const returnStatusInput = document.getElementById('returnStatus');
    const depositDecisionInput = document.getElementById('returnDepositDecision');
    const deductionPercentInput = document.getElementById('returnDepositDeductionPercent');
    const refundAmountInput = document.getElementById('returnDepositRefundAmount');
    const deductionReasonInput = document.getElementById('returnDepositDeductionReason');

    const selectedStatus = returnStatusInput.value;

    if (selectedStatus === 'returned_damaged' || selectedStatus === 'returned_late_damaged') {
        isDamagedInput.checked = true;
    }

    if (selectedStatus === 'returned_late' || selectedStatus === 'returned_late_damaged') {
        isLateInput.checked = true;
    }

    const lateDays = calculateLateDays(actualReturnDate, adjustedEnd);

    if (lateDays > 0) {
        isLateInput.checked = true;
    }

    const isLate = isLateInput.checked;
    const isDamaged = isDamagedInput.checked;

    if (isDamaged && isLate) {
        returnStatusInput.value = 'returned_late_damaged';
        depositDecisionInput.value = 'no_refund';
        deductionPercentInput.value = 100;
    } else if (isDamaged) {
        returnStatusInput.value = 'returned_damaged';
        depositDecisionInput.value = 'no_refund';
        deductionPercentInput.value = 100;
    } else if (isLate) {
        returnStatusInput.value = 'returned_late';
    } else {
        returnStatusInput.value = 'returned_ok';
    }

    if (depositDecisionInput.value === 'full_refund') {
        deductionPercentInput.value = 0;
    }

    if (depositDecisionInput.value === 'no_refund') {
        deductionPercentInput.value = 100;
    }

    const deposit = Number(item.deposit || 0);
    const deductionPercent = Number(deductionPercentInput.value || 0);
    const refundAmount = Math.max(deposit - (deposit * deductionPercent / 100), 0);

    refundAmountInput.value = refundAmount.toFixed(2);

    const reasons = [];
    if (isDamagedInput.checked) reasons.push('Beschädigt');
    if (isLateInput.checked) reasons.push('Verspätet');
    deductionReasonInput.value = reasons.join(', ');

    const start = document.getElementById('returnAdjustedStart').value || item.rentalStart;
    const end = document.getElementById('returnAdjustedEnd').value || actualReturnDate || item.rentalEnd;
    const price = Number(normalizeDecimalInput(document.getElementById('returnPricePerDay').value) || 0);
    const days = calculateRentalDays(start, end);
    const net = days * price;
    const gross = net * 1.19;

    const additionalCharge = Number(normalizeDecimalInput(
        document.getElementById('returnAdditionalChargeAmount').value
    ) || 0);

    const customerAdditionalDue = additionalCharge;
    const customerCredit = refundAmount;

    document.getElementById('returnPricePreview').innerHTML = `
    <strong>Preisübersicht für diesen Artikel</strong><br>
    Miettage: ${days}<br>
    Miete netto: ${net.toFixed(2)} €<br>
    Miete brutto: ${gross.toFixed(2)} €<hr>

    Kaution: ${deposit.toFixed(2)} €<br>
    Kaution zurück: ${refundAmount.toFixed(2)} €<br>
    Kaution einbehalten: ${(deposit - refundAmount).toFixed(2)} €<hr>

    Zusätzliche Reparaturkosten: ${additionalCharge.toFixed(2)} €<br>
    Kunde zusätzlich zu zahlen: ${customerAdditionalDue.toFixed(2)} €<br>
    Kunde erhält zurück: ${customerCredit.toFixed(2)} €
`;
}

async function saveOrderItemRentalAdjustment(itemId, orderId) {
    const payload = {
        adjustedRentalStart: document.getElementById('rentalPeriodStart').value || null,
        adjustedRentalEnd: document.getElementById('rentalPeriodEnd').value || null,
        adjustedPricePerDay: normalizeDecimalInput(
            document.getElementById('rentalPeriodPricePerDay').value
        )
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

        await uploadReturnImagesForCurrentReturn(itemId);
        await sendReturnSummaryEmailForItem(itemId);

        bootstrap.Modal.getInstance(document.getElementById('orderItemReturnModal'))?.hide();

        showAlert(result.message || 'Rückgabe gespeichert.', 'success');

        await loadOrders();

        if (orderId) {
            const detailsResponse = await fetch(`/admin/orders/${orderId}`);
            const updatedOrder = await detailsResponse.json();

            if (detailsResponse.ok) {
                renderOrderDetails(updatedOrder);
            }
        }

    } catch (error) {
        console.error('Fehler beim Speichern der Positionsrückgabe:', error);
        showAlert('Rückgabe konnte nicht gespeichert werden.', 'danger');
    }
}

async function submitOrderItemReturn() {
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
}

function calculateOrderItemFinancials(item) {
    const taxRate = 0.19;

    const originalStart = item.rentalStart;
    const originalEnd = item.rentalEnd;
    const adjustedStart = item.adjustedRentalStart || item.rentalStart;
    const adjustedEnd = item.adjustedRentalEnd || item.actualReturnDate || item.rentalEnd;

    const originalDays = calculateRentalDays(originalStart, originalEnd);
    const adjustedDays = calculateRentalDays(adjustedStart, adjustedEnd);

    const originalPricePerDay = Number(item.pricePerDay || 0);
    const adjustedPricePerDay = Number(item.adjustedPricePerDay || item.pricePerDay || 0);

    const originalNet = originalDays * originalPricePerDay;
    const adjustedNet = adjustedDays * adjustedPricePerDay;

    const originalGross = originalNet * (1 + taxRate);
    const adjustedGross = adjustedNet * (1 + taxRate);

    const rentalDeltaGross = adjustedGross - originalGross;

    const deposit = Number(item.deposit || 0);
    const depositRefund = Number(item.depositRefundAmount || deposit);
    const depositRetained = Math.max(deposit - depositRefund, 0);

    const additionalCharge = Number(item.additionalChargeAmount || 0);

    return {
        originalDays,
        adjustedDays,
        originalNet,
        adjustedNet,
        originalGross,
        adjustedGross,
        rentalDeltaGross,
        deposit,
        depositRefund,
        depositRetained,
        additionalCharge,
        additionalChargeReason: item.additionalChargeReason || '',
        customerAdditionalDue: Math.max(rentalDeltaGross, 0) + additionalCharge,
        customerCredit: Math.max(-rentalDeltaGross, 0) + depositRefund
    };
}

function renderOrderFinancialSummary(order) {
    const items = order.items || [];

    const totals = items.reduce((sum, item) => {
        const f = calculateOrderItemFinancials(item);

        sum.originalGross += f.originalGross;
        sum.adjustedGross += f.adjustedGross;
        sum.rentalDeltaGross += f.rentalDeltaGross;
        sum.deposit += f.deposit;
        sum.depositRefund += f.depositRefund;
        sum.depositRetained += f.depositRetained;
        sum.additionalCharges += f.additionalCharge;
        sum.customerAdditionalDue += f.customerAdditionalDue;
        sum.customerCredit += f.customerCredit;

        return sum;
    }, {
        originalGross: 0,
        adjustedGross: 0,
        rentalDeltaGross: 0,
        deposit: 0,
        depositRefund: 0,
        depositRetained: 0,
        additionalCharges: 0,
        customerAdditionalDue: 0,
        customerCredit: 0
    });

    return `
        <div class="card mt-4">
            <div class="card-header">
                <strong>Gesamtpreisberechnung</strong>
            </div>
            <div class="card-body">
                <div class="row g-3">
                    <div class="col-12 col-md-6">
                        <strong>Miete</strong><br>
                        Ursprünglich brutto: ${totals.originalGross.toFixed(2)} €<br>
                        Aktuell brutto: ${totals.adjustedGross.toFixed(2)} €<br>
                        Differenz: ${totals.rentalDeltaGross.toFixed(2)} €
                    </div>

                    <div class="col-12 col-md-6">
                        <strong>Kaution</strong><br>
                        Gesamt: ${totals.deposit.toFixed(2)} €<br>
                        Zurück an Kunden: ${totals.depositRefund.toFixed(2)} €<br>
                        Einbehalten: ${totals.depositRetained.toFixed(2)} €
                    </div>

                    <div class="col-12 col-md-6">
                        <strong>Zusatzforderungen</strong><br>
                        Reparaturkosten / Schäden: ${totals.additionalCharges.toFixed(2)} €
                    </div>

                    <div class="col-12 col-md-6">
                        <strong>Abrechnung</strong><br>
                        Kunde zusätzlich zu zahlen:
                        <span class="text-danger">${totals.customerAdditionalDue.toFixed(2)} €</span><br>

                        Kunde erhält zurück / gutgeschrieben:
                        <span class="text-success">${totals.customerCredit.toFixed(2)} €</span>
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