let products = [];
let filteredProducts = [];
let orders = [];

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
            order.customer_first_name,
            order.customer_last_name,
            order.customer_phone,
            order.customer_city,
            order.status,
            order.payment_status,
            order.payment_method,
            order.return_status,
            order.deposit_decision
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
                        <small>${order.customer_email || ''}</small><br>
                        ${getStatusBadge(order.status)}
                        ${getPaymentBadge(order.payment_status)}
                        ${getReturnBadge(order.return_status)}
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

    const cancelHtml = canCancelOrder(order) ? `
        <div class="col-12">
            <hr>
            <h5>Bestellung stornieren</h5>
            <p class="text-muted">
                Storniert die Bestellung vollständig. Mietzeiträume werden dadurch wieder frei.
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
                Diese Bestellung kann nicht mehr storniert werden.
            </p>
        </div>
    `;

    body.innerHTML = `
        <div class="row g-4">
            <div class="col-12 col-lg-6">
                <h5>Bestellung</h5>
                <p>
                    <strong>Bestellnummer:</strong> ${order.order_no}<br>
                    <strong>Status:</strong> ${getStatusBadge(order.status)}<br>

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

            ${cancelHtml}

            ${canShowReturnSection ? `
<div class="col-12">
    <hr>
    <h5>Rückgabe / Kaution bearbeiten</h5>
    <p>
        <strong>Zuletzt bearbeitet von:</strong> ${order.return_processed_by_username || '-'}<br>
        <strong>Bearbeitet am:</strong> ${order.return_case_processed_at || '-'}
    </p>

    <div class="row g-3">
        <div class="col-12 col-md-4">
            <label class="form-label">Rückgabestatus</label>
            <select class="form-select" id="returnStatus">
                <option value="returned_ok" ${order.return_status === 'returned_ok' ? 'selected' : ''}>Ordnungsgemäß zurückgegeben</option>
                <option value="returned_late" ${order.return_status === 'returned_late' ? 'selected' : ''}>Verspätet zurückgegeben</option>
                <option value="returned_damaged" ${order.return_status === 'returned_damaged' ? 'selected' : ''}>Beschädigt zurückgegeben</option>
                <option value="returned_late_damaged" ${order.return_status === 'returned_late_damaged' ? 'selected' : ''}>Verspätet und beschädigt</option>
            </select>
        </div>

        <div class="col-12 col-md-4">
            <label class="form-label">Kautionsentscheidung</label>
            <select class="form-select" id="depositDecision">
                <option value="full_refund" ${order.deposit_decision === 'full_refund' ? 'selected' : ''}>Vollständig zurückzahlen</option>
                <option value="partial_refund" ${order.deposit_decision === 'partial_refund' ? 'selected' : ''}>Teilweise zurückzahlen</option>
                <option value="no_refund" ${order.deposit_decision === 'no_refund' ? 'selected' : ''}>Nicht zurückzahlen</option>
                <option value="pending" ${!order.deposit_decision || order.deposit_decision === 'pending' ? 'selected' : ''}>Noch offen</option>
            </select>
        </div>

        <div class="col-12 col-md-4">
            <label class="form-label">Rückzahlungsbetrag</label>
            <input type="number" step="0.01" min="0" class="form-control" id="depositRefundAmount"
                value="${order.deposit_refund_amount || ''}">
        </div>

        <div class="col-12 col-md-6">
            <div class="form-check mt-2">
                <input class="form-check-input" type="checkbox" id="isDamaged" ${order.is_damaged ? 'checked' : ''}>
                <label class="form-check-label" for="isDamaged">Artikel beschädigt zurückgegeben</label>
            </div>

            <textarea class="form-control mt-2" id="damageDescription" rows="3"
                placeholder="Beschreibung der Beschädigung">${order.damage_description || ''}</textarea>
        </div>

        <div class="col-12 col-md-6">
            <div class="form-check mt-2">
                <input class="form-check-input" type="checkbox" id="isLate" ${order.is_late ? 'checked' : ''}>
                <label class="form-check-label" for="isLate">Artikel verspätet zurückgegeben</label>
            </div>

            <textarea class="form-control mt-2" id="lateDescription" rows="3"
                placeholder="Beschreibung der Verspätung">${order.late_description || ''}</textarea>
        </div>

        <div class="col-12 col-md-4">
            <label class="form-label">Kautionsabzug</label>
            <input type="number" step="0.01" min="0" class="form-control" id="depositDeductionAmount"
                value="${order.deposit_deduction_amount || ''}">
        </div>

        <div class="col-12 col-md-8">
            <label class="form-label">Grund für Kautionsabzug</label>
            <input type="text" class="form-control" id="depositDeductionReason"
                value="${order.deposit_deduction_reason || ''}">
        </div>

        <div class="col-12">
            <label class="form-label">Interne Rückgabe-Notiz</label>
            <textarea class="form-control" id="returnNotes" rows="3">${order.return_notes || ''}</textarea>
        </div>

        <div class="col-12">
            <label class="form-label">Rückgabefotos hochladen</label>
            <input type="file" class="form-control" id="returnImageUpload" accept="image/*" multiple>
            <small class="text-muted">Maximal 10 Bilder, je 5 MB.</small>
        </div>

        <div class="col-12">
            <button type="button" class="btn btn-outline-primary" onclick="uploadReturnImages(${order.id})">
                Fotos hochladen
            </button>
        </div>

        <div class="col-12">
            <h6 class="mt-3">Vorhandene Rückgabefotos</h6>
            <div class="row g-2">
                ${(order.returnImages || []).length === 0
                ? '<div class="col-12 text-muted">Noch keine Fotos vorhanden.</div>'
                : order.returnImages.map(image => `
                        <div class="col-6 col-md-3">
                            <div class="card h-100">
                                <a href="/${image.imagePath}" target="_blank">
                                    <img src="/${image.imagePath}" class="card-img-top"
                                        style="height: 140px; object-fit: cover;">
                                </a>
                                <div class="card-body p-2">
                                    <button type="button" class="btn btn-danger btn-sm w-100"
                                        onclick="deleteReturnImage(${image.id}, ${order.id})">
                                        Foto löschen
                                    </button>
                                </div>
                            </div>
                        </div>
                    `).join('')
            }
            </div>
        </div>

        <div class="col-12">
            <button type="button" class="btn btn-success" onclick="saveOrderReturn(${order.id})">
                Rückgabe speichern
            </button>
        </div>
    </div>
</div>
` : ''}

        </div>
    `;
}

async function saveOrderReturn(orderId) {
    const payload = {
        returnStatus: document.getElementById('returnStatus').value,
        isDamaged: document.getElementById('isDamaged').checked,
        damageDescription: document.getElementById('damageDescription').value.trim(),
        isLate: document.getElementById('isLate').checked,
        lateDescription: document.getElementById('lateDescription').value.trim(),
        depositDecision: document.getElementById('depositDecision').value,
        depositRefundAmount: document.getElementById('depositRefundAmount').value || null,
        depositDeductionAmount: document.getElementById('depositDeductionAmount').value || null,
        depositDeductionReason: document.getElementById('depositDeductionReason').value.trim(),
        returnNotes: document.getElementById('returnNotes').value.trim()
    };

    try {
        const response = await fetch(`/admin/orders/${orderId}/return`, {
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

        showAlert(result.message || 'Rückgabe wurde gespeichert.', 'success');

        await loadOrders();

        const detailsResponse = await fetch(`/admin/orders/${orderId}`);
        const updatedOrder = await detailsResponse.json();

        if (detailsResponse.ok) {
            renderOrderDetails(updatedOrder);
        }

    } catch (error) {
        console.error('Fehler beim Speichern der Rückgabe:', error);
        showAlert('Rückgabe konnte nicht gespeichert werden.', 'danger');
    }
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

async function uploadReturnImages(orderId) {
    const input = document.getElementById('returnImageUpload');

    if (!input || input.files.length === 0) {
        showAlert('Bitte wählen Sie mindestens ein Foto aus.', 'warning');
        return;
    }

    const formData = new FormData();

    Array.from(input.files).forEach(file => {
        formData.append('images', file);
    });

    try {
        const response = await fetch(`/admin/orders/${orderId}/return-images`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (!response.ok) {
            showAlert(result.error || 'Fotos konnten nicht hochgeladen werden.', 'danger');
            return;
        }

        showAlert(result.message || 'Fotos wurden hochgeladen.', 'success');

        const detailsResponse = await fetch(`/admin/orders/${orderId}`);
        const updatedOrder = await detailsResponse.json();

        if (detailsResponse.ok) {
            renderOrderDetails(updatedOrder);
        }

    } catch (error) {
        console.error('Fehler beim Foto-Upload:', error);
        showAlert('Fotos konnten nicht hochgeladen werden.', 'danger');
    }
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