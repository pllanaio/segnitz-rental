let products = [];

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('productForm');
    const cancelEditBtn = document.getElementById('cancelEditBtn');

    loadBackendUser();
    loadProducts();

    form.addEventListener('submit', saveProduct);
    cancelEditBtn.addEventListener('click', resetForm);
});

async function loadProducts() {
    const productList = document.getElementById('productList');

    try {
        const response = await fetch('/products');
        products = await response.json();

        productList.innerHTML = '';

        if (products.length === 0) {
            productList.innerHTML = '<div class="alert alert-info">Noch keine Produkte angelegt.</div>';
            return;
        }

        products.forEach(product => {
            productList.appendChild(createProductCard(product));
        });
    } catch (error) {
        console.error('Fehler beim Laden der Produkte:', error);
        showMessage('Produkte konnten nicht geladen werden.', 'danger');
    }
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
        imagePath: document.getElementById('imagePath').value.trim(),
        isActive: document.getElementById('isActive').checked
    };

    if (!payload.productKey || !payload.title) {
        showMessage('Produkt-Key und Titel sind Pflichtfelder.', 'warning');
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
            showMessage(result.error || 'Produkt konnte nicht gespeichert werden.', 'danger');
            return;
        }
        const savedProductId = productId || result.productId;

        await uploadProductImages(savedProductId);
        
        showMessage(result.message || 'Produkt gespeichert.', 'success');
        resetForm();
        loadProducts();
    } catch (error) {
        console.error('Fehler beim Speichern:', error);
        showMessage('Fehler beim Speichern des Produkts.', 'danger');
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
    document.getElementById('imagePath').value = product.image_path || '';
    document.getElementById('isActive').checked = product.is_active === 1;

    document.getElementById('saveProductBtn').textContent = 'Änderungen speichern';
    document.getElementById('cancelEditBtn').classList.remove('d-none');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteProduct(id) {
    if (!confirm('Produkt wirklich löschen?')) {
        return;
    }

    try {
        const response = await fetch(`/products/${id}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (!response.ok) {
            showMessage(result.error || 'Produkt konnte nicht gelöscht werden.', 'danger');
            return;
        }

        showMessage(result.message || 'Produkt gelöscht.', 'success');
        loadProducts();
    } catch (error) {
        console.error('Fehler beim Löschen:', error);
        showMessage('Fehler beim Löschen des Produkts.', 'danger');
    }
}

function resetForm() {
    document.getElementById('productForm').reset();
    document.getElementById('productId').value = '';
    document.getElementById('productKey').disabled = false;
    document.getElementById('isActive').checked = true;
    document.getElementById('saveProductBtn').textContent = 'Produkt speichern';
    document.getElementById('cancelEditBtn').classList.add('d-none');
}

function showMessage(message, type) {
    const box = document.getElementById('productMessage');

    box.className = `alert alert-${type}`;
    box.textContent = message;
    box.classList.remove('d-none');
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

function logout() {
    fetch('/logout', {
        method: 'POST'
    })
        .then(response => {
            if (response.ok) {
                window.location.href = 'index.html';
            } else {
                alert('Fehler beim Abmelden');
            }
        })
        .catch(error => {
            console.error('Netzwerkfehler beim Logout:', error);
        });
}