let products = [];
let filteredProducts = [];
let orders = [];

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('productForm');
    const cancelEditBtn = document.getElementById('cancelEditBtn');

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
    container.innerHTML = '';

    if (orders.length === 0) {
        container.innerHTML = '<div class="alert alert-info">Keine Bestellungen vorhanden.</div>';
        return;
    }

    orders.forEach(order => {
        const card = document.createElement('div');
        card.className = 'card mb-3';

        card.innerHTML = `
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <h5>${order.order_no}</h5>
                        <small>${order.customer_email}</small><br>
                        <small>Status: ${order.status}</small>
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

        console.log(order);

        showAlert('Details siehe Konsole (nächster Schritt: Modal bauen)', 'info');

    } catch (error) {
        console.error(error);
        showAlert('Fehler beim Laden der Bestellung.', 'danger');
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
    const productsView = document.getElementById('productsView');
    const ordersView = document.getElementById('ordersView');

    const navProducts = document.getElementById('nav-products');
    const navOrders = document.getElementById('nav-orders');

    if (view === 'products') {
        productsView.classList.remove('d-none');
        ordersView.classList.add('d-none');

        navProducts.classList.add('active');
        navOrders.classList.remove('active');
    }

    if (view === 'orders') {
        productsView.classList.add('d-none');
        ordersView.classList.remove('d-none');

        navProducts.classList.remove('active');
        navOrders.classList.add('active');

        loadOrders(); // wichtig
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