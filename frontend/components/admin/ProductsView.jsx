import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { showAlert, showConfirm } from '../../lib/alerts';
import { parseHourlyPrices } from '../../lib/shop';

const EMPTY_FORM = {
    productId: '', productKey: '', title: '', description: '', isActive: true,
    productKind: '', manufacturer: '', model: '', color: '', powerValue: '', powerUnit: 'kW', operatingHours: '', mileageKm: '',
    pricePerDay: '', deposit: '', hourlyEnabled: false, price2: '', price4: '', price6: ''
};
const ATTRIBUTE_COLUMNS = {
    productKind: 'product_kind', manufacturer: 'manufacturer', model: 'model', color: 'color', powerValue: 'power_value',
    powerUnit: 'power_unit', operatingHours: 'operating_hours', mileageKm: 'mileage_km'
};
const SUGGESTIONS_HINT = 'Marke und Modell frei eingeben oder Vorschläge nutzen. Nicht vorhanden: n.V. Neue Angaben stehen nach dem Speichern als Vorschläge zur Verfügung.';

export function normalizeCategoryName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

export function uniqueCategories(categories) {
    const unique = [];
    const seen = new Set();
    categories.map(normalizeCategoryName).filter(Boolean).forEach(category => {
        const key = category.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(category);
        }
    });
    return unique;
}

function suggestionValues(values) {
    const unique = [...new Set(values.filter(Boolean))].filter(value => value !== 'n.V.').sort((a, b) => a.localeCompare(b, 'de'));
    return ['n.V.', ...unique];
}

export function productSuggestions(options, kind, manufacturer) {
    const brand = manufacturer.trim().toLocaleLowerCase('de');
    const entries = options.products.filter(product => !kind || product.product_kind === kind || !product.product_kind);
    const brands = kind ? options.brands[kind] || [] : Object.values(options.brands).flat();
    return {
        manufacturers: suggestionValues([...brands, ...entries.map(product => product.manufacturer)]),
        models: suggestionValues(entries.filter(product => brand && product.manufacturer?.toLocaleLowerCase('de') === brand).map(product => product.model))
    };
}

function productMatches(product, query) {
    return [
        product.title, product.description, product.product_key, product.price_per_day, product.deposit,
        product.is_active ? 'aktiv' : 'inaktiv'
    ].join(' ').toLowerCase().includes(query);
}

function ProductCard({ product }) {
    return (
        <div className="card mb-3 order-overview-card">
            <div className="card-body">
                <div className="row g-3 align-items-center">
                    <div className="col-12 col-md-2">
                        {product.image_path ? <img src={product.image_path} className="img-fluid rounded" alt={product.title} /> : null}
                    </div>
                    <div className="col-12 col-md-6">
                        <h5 className="mb-1">{product.title}</h5>
                        <p className="mb-1 text-muted">{product.description || ''}</p>
                        <small>Key: {product.product_key} | Status: {product.is_active ? 'Aktiv' : 'Inaktiv'}</small>
                    </div>
                    <div className="col-12 col-md-2">
                        <strong>{Number(product.price_per_day).toFixed(2)} € / Tag</strong><br />
                        <span>Kaution: {Number(product.deposit).toFixed(2)} €</span>
                    </div>
                    <div className="col-12 col-md-2 text-md-end">
                        <button type="button" className="btn btn-primary btn-sm mb-2 w-100" data-backend-action="edit-product"
                            data-product-id={product.id}>Bearbeiten</button>
                        <button type="button" className="btn btn-danger btn-sm w-100" data-backend-action="delete-product"
                            data-product-id={product.id}>Löschen</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

const ProductsView = forwardRef(function ProductsView({ visible }, ref) {
    const titleRef = useRef(null);
    const newButtonRef = useRef(null);
    const imagesInputRef = useRef(null);
    const categoryInputRef = useRef(null);
    const existingImagesRef = useRef(null);
    const draggedImageRef = useRef(null);
    const productsRef = useRef([]);

    const [products, setProducts] = useState(null);
    const [searchResult, setSearchResult] = useState(null);
    const [search, setSearch] = useState('');
    const [editorOpen, setEditorOpen] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [editing, setEditing] = useState(false);
    const [categories, setCategories] = useState([]);
    const [categoryInput, setCategoryInput] = useState('');
    const [availableCategories, setAvailableCategories] = useState([]);
    const [attributeOptions, setAttributeOptions] = useState({ brands: {}, products: [] });
    const [suggestionsHint, setSuggestionsHint] = useState(SUGGESTIONS_HINT);
    const [existingImages, setExistingImages] = useState(null);
    const [saving, setSaving] = useState(false);

    const loadProducts = useCallback(async () => {
        try {
            const response = await fetch('/products');
            const list = await response.json();
            productsRef.current = list;
            setProducts(list);
            setSearchResult(null);
            return list;
        } catch (error) {
            console.error('Fehler beim Laden der Produkte:', error);
            showAlert('Produkte konnten nicht geladen werden.', 'danger');
            return null;
        }
    }, []);

    const loadProductAttributeOptions = useCallback(async () => {
        try {
            const response = await fetch('/product-attribute-options');
            if (!response.ok) throw new Error('Vorschläge nicht verfügbar. Marke und Modell können frei eingegeben werden.');
            setAttributeOptions(await response.json());
        } catch (error) {
            setSuggestionsHint(error.message);
        }
    }, []);

    useEffect(() => {
        loadProducts();
        loadProductAttributeOptions();
        (async () => {
            try {
                const response = await fetch('/categories');
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Kategorien konnten nicht geladen werden.');
                setAvailableCategories(result.map(category => category.name));
            } catch (error) {
                console.error('Fehler beim Laden der Kategorien:', error);
                setAvailableCategories([]);
            }
        })();
    }, [loadProducts, loadProductAttributeOptions]);

    const resetForm = () => {
        setForm(EMPTY_FORM);
        setEditing(false);
        setExistingImages(null);
        setCategories([]);
        setCategoryInput('');
        if (imagesInputRef.current) imagesInputRef.current.value = '';
    };

    const openEditor = () => setEditorOpen(true);

    const closeEditor = () => {
        resetForm();
        setEditorOpen(false);
        window.setTimeout(() => {
            const button = newButtonRef.current;
            if (!button) return;
            button.focus({ preventScroll: true });
            button.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
    };

    const editProduct = id => {
        const product = productsRef.current.find(item => item.id === id);
        if (!product) return;

        const hourlyPrices = parseHourlyPrices(product);
        const attributes = Object.fromEntries(Object.entries(ATTRIBUTE_COLUMNS)
            .map(([key, column]) => [key, product[column] ?? (key === 'powerUnit' ? 'kW' : '')]));

        setEditorOpen(true);
        setForm({
            ...EMPTY_FORM,
            ...attributes,
            productId: product.id,
            productKey: product.product_key,
            title: product.title,
            description: product.description || '',
            pricePerDay: product.price_per_day,
            deposit: product.deposit,
            hourlyEnabled: Boolean(hourlyPrices),
            price2: hourlyPrices?.[2] || '',
            price4: hourlyPrices?.[4] || '',
            price6: hourlyPrices?.[6] || '',
            isActive: product.is_active === 1
        });
        setEditing(true);
        setCategories(uniqueCategories(Array.isArray(product.categories)
            ? product.categories.map(category => typeof category === 'string' ? category : category.name)
            : []));
        setExistingImages({ productId: product.id, images: product.images || [] });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const deleteProduct = async id => {
        const confirmed = await showConfirm(
            'Möchten Sie dieses Produkt wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
            'Produkt löschen'
        );
        if (!confirmed) return;

        try {
            const response = await fetch(`/products/${id}`, { method: 'DELETE' });
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
    };

    useImperativeHandle(ref, () => ({
        editProduct,
        deleteProduct,
        showList() {
            setEditorOpen(false);
        }
    }));

    const updateForm = (field, value) => setForm(current => ({ ...current, [field]: value }));

    const uploadProductImages = async productId => {
        const input = imagesInputRef.current;
        if (!input || input.files.length === 0) return;
        if (input.files.length > 10) throw new Error('Maximal 10 Bilder pro Produkt erlaubt.');

        const formData = new FormData();
        Array.from(input.files).forEach(file => formData.append('images', file));

        const response = await fetch(`/products/${productId}/images`, { method: 'POST', body: formData });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Bilder konnten nicht hochgeladen werden.');
    };

    const saveProduct = async event => {
        event.preventDefault();
        if (saving) return;

        const productId = form.productId;
        const payload = {
            productKind: String(form.productKind).trim(),
            manufacturer: String(form.manufacturer).trim(),
            model: String(form.model).trim(),
            color: String(form.color).trim(),
            powerValue: String(form.powerValue).trim(),
            powerUnit: String(form.powerUnit).trim(),
            operatingHours: String(form.operatingHours).trim(),
            mileageKm: String(form.mileageKm).trim(),
            title: form.title.trim(),
            description: form.description.trim(),
            pricePerDay: Number(form.pricePerDay),
            hourlyPrices: form.hourlyEnabled ? { 2: Number(form.price2), 4: Number(form.price4), 6: Number(form.price6) } : null,
            deposit: Number(form.deposit),
            imagePath: '',
            category: categories[0] || '',
            categories,
            isActive: form.isActive
        };

        if (!payload.title || !payload.productKind) {
            showAlert('Bitte Titel und Art ausfüllen.', 'warning');
            return;
        }

        setSaving(true);
        try {
            const response = await fetch(productId ? `/products/${productId}` : '/products', {
                method: productId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (!response.ok) {
                showAlert(result.error || 'Produkt konnte nicht gespeichert werden.', 'danger');
                return;
            }
            const savedProductId = productId || result.productId;
            setForm(current => ({ ...current, productId: savedProductId, productKey: result.productKey || current.productKey }));
            await uploadProductImages(savedProductId);
            await loadProductAttributeOptions();
            showAlert(result.message || 'Produkt gespeichert.', 'success');
            await loadProducts();
            closeEditor();
        } catch (error) {
            console.error('Fehler beim Speichern:', error);
            showAlert('Speichern oder Bilder-Upload fehlgeschlagen. Bitte prüfen und erneut speichern.', 'danger');
        } finally {
            setSaving(false);
        }
    };

    const addCategory = value => {
        const normalized = normalizeCategoryName(value);
        if (!normalized) return;

        if (categories.some(category => normalizeCategoryName(category).toLowerCase() === normalized.toLowerCase())) {
            showAlert('Diese Kategorie ist diesem Produkt bereits zugeordnet.', 'warning');
            return;
        }

        setCategories(uniqueCategories([...categories, normalized]));
        setAvailableCategories(current => current.some(category => normalizeCategoryName(category).toLowerCase() === normalized.toLowerCase())
            ? current
            : [...current, normalized].sort((a, b) => a.localeCompare(b, 'de')));
        setCategoryInput('');
        categoryInputRef.current?.focus();
    };

    const removeCategory = category => {
        const key = normalizeCategoryName(category).toLowerCase();
        setCategories(current => current.filter(item => item.toLowerCase() !== key));
    };

    const saveImageOrder = async (productId, images) => {
        try {
            const response = await fetch(`/products/${productId}/images/order`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageIds: images.map(image => Number(image.id)) })
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
    };

    const deleteProductImage = async (imageId, productId) => {
        const confirmed = await showConfirm('Möchten Sie dieses Bild wirklich löschen?', 'Bild löschen');
        if (!confirmed) return;
        try {
            const response = await fetch(`/product-images/${imageId}`, { method: 'DELETE' });
            const result = await response.json();
            if (!response.ok) {
                showAlert(result.error || 'Bild konnte nicht gelöscht werden.', 'danger');
                return;
            }
            showAlert(result.message || 'Bild gelöscht.', 'success');
            const list = await loadProducts();
            const updatedProduct = list?.find(product => product.id === productId);
            if (updatedProduct) setExistingImages({ productId, images: updatedProduct.images || [] });
        } catch (error) {
            console.error('Fehler beim Löschen des Bildes:', error);
            showAlert('Fehler beim Löschen des Bildes.', 'danger');
        }
    };

    const dragOver = event => {
        event.preventDefault();
        const dragged = draggedImageRef.current;
        const container = existingImagesRef.current;
        if (!dragged || !container) return;

        const others = [...container.querySelectorAll('.draggable-image:not(.dragging)')];
        const after = others.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = event.clientY - box.top - box.height / 2;
            return offset < 0 && offset > closest.offset ? { offset, element: child } : closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;

        setExistingImages(current => {
            const images = current.images.filter(image => String(image.id) !== String(dragged));
            const draggedImage = current.images.find(image => String(image.id) === String(dragged));
            const index = after ? images.findIndex(image => String(image.id) === after.dataset.imageId) : images.length;
            images.splice(index < 0 ? images.length : index, 0, draggedImage);
            return { ...current, images };
        });
    };

    const visibleProducts = searchResult ?? products;
    const selectedKeys = categories.map(category => category.toLowerCase());
    const categoryQuery = normalizeCategoryName(categoryInput).toLowerCase();
    const suggestions = availableCategories
        .filter(category => !selectedKeys.includes(category.toLowerCase()))
        .filter(category => !categoryQuery || category.toLowerCase().includes(categoryQuery))
        .sort((a, b) => a.localeCompare(b, 'de'));
    const { manufacturers, models } = productSuggestions(attributeOptions, form.productKind, String(form.manufacturer));

    return (
        <div id="productsView" className={visible ? undefined : 'd-none'}>
            <div id="productMessage" className="alert d-none" />
            <div id="productEditor" className={editorOpen ? undefined : 'd-none'}>
                <header className="product-editor-heading">
                    <h2 id="productEditorTitle">{editing ? 'Produkt bearbeiten' : 'Produkt anlegen'}</h2>
                    <p>Stammdaten, Merkmale und Mietkonditionen</p>
                </header>
                <form id="productForm" className="product-editor mb-5" onSubmit={saveProduct}>
                    <input type="hidden" id="productId" value={form.productId} readOnly />
                    <section className="product-editor-section" aria-labelledby="productBasicsHeading">
                        <div className="product-section-heading">
                            <h3 id="productBasicsHeading">Stammdaten</h3>
                            <div className="form-check form-switch">
                                <input className="form-check-input" type="checkbox" id="isActive" checked={form.isActive}
                                    onChange={event => updateForm('isActive', event.target.checked)} />
                                <label className="form-check-label" htmlFor="isActive">Produkt aktiv</label>
                            </div>
                        </div>
                        <div className="row g-4">
                            <div className="col-12 col-lg-6">
                                <label className="form-label" htmlFor="productKey">Produkt-Key</label>
                                <input type="text" className="form-control" id="productKey" readOnly placeholder="Wird automatisch vergeben"
                                    value={form.productKey} />
                            </div>
                            <div className="col-12 col-lg-6">
                                <label className="form-label" htmlFor="title">Titel *</label>
                                <input type="text" className="form-control" id="title" maxLength={150} required placeholder="z. B. Minibagger 1,8 t"
                                    ref={titleRef} value={form.title} onChange={event => updateForm('title', event.target.value)} />
                            </div>
                            <div className="col-12">
                                <label className="form-label" htmlFor="description">Beschreibung</label>
                                <textarea className="form-control" id="description" rows={3} placeholder="Einsatzbereich, Ausstattung und Lieferumfang"
                                    value={form.description} onChange={event => updateForm('description', event.target.value)} />
                            </div>
                            <div className="col-12">
                                <label className="form-label" htmlFor="categoryInput">Kategorien</label>
                                <input type="hidden" id="category" value={categories.join(', ')} readOnly />
                                <div id="categoryTags" className="d-flex flex-wrap gap-2 mb-2">
                                    {categories.length === 0
                                        ? <span className="text-muted small">Keine Kategorien ausgewählt</span>
                                        : categories.map(category => (
                                            <span key={category} className="badge rounded-pill bg-primary d-inline-flex align-items-center gap-2 px-3 py-2">
                                                <span>{category}</span>
                                                <button type="button" className="btn-close btn-close-white" aria-label="Entfernen"
                                                    onClick={() => removeCategory(category)} />
                                            </span>
                                        ))}
                                </div>
                                <div className="input-group">
                                    <input type="text" className="form-control" id="categoryInput" placeholder="Kategorie hinzufügen"
                                        ref={categoryInputRef} value={categoryInput}
                                        onChange={event => setCategoryInput(event.target.value)}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter' || event.key === ',') {
                                                event.preventDefault();
                                                addCategory(categoryInput);
                                            }
                                        }} />
                                    <button type="button" className="btn btn-outline-primary" id="addCategoryBtn"
                                        onClick={() => addCategory(categoryInput)}>Hinzufügen</button>
                                </div>
                                <div id="categorySuggestionList" className="mt-2">
                                    {suggestions.map(category => (
                                        <button key={category} type="button" className="btn btn-outline-secondary btn-sm me-2 mb-2"
                                            onClick={() => addCategory(category)}>{category}</button>
                                    ))}
                                </div>
                                <div className="form-text">Mehrere Kategorien möglich.</div>
                            </div>
                        </div>
                    </section>
                    <section className="product-editor-section" aria-labelledby="productAttributesHeading">
                        <h3 id="productAttributesHeading">Artikelmerkmale</h3>
                        <div className="row g-4">
                            <div className="col-12 col-lg-4">
                                <label className="form-label" htmlFor="productKind">Art *</label>
                                <select className="form-select" id="productKind" required value={form.productKind}
                                    onChange={event => updateForm('productKind', event.target.value)}>
                                    <option value="">Bitte auswählen</option>
                                    <option>Baumaschine</option>
                                    <option>Auto</option>
                                    <option>Werkzeug</option>
                                </select>
                            </div>
                            <div className="col-12 col-lg-4">
                                <label className="form-label" htmlFor="manufacturer">Hersteller / Marke</label>
                                <input className="form-control" id="manufacturer" maxLength={120} list="manufacturerOptions"
                                    placeholder="Auswählen oder eingeben" autoComplete="off" value={form.manufacturer}
                                    onChange={event => updateForm('manufacturer', event.target.value)} />
                                <datalist id="manufacturerOptions">
                                    {manufacturers.map(value => <option key={value} value={value} />)}
                                </datalist>
                            </div>
                            <div className="col-12 col-lg-4">
                                <label className="form-label" htmlFor="productModel">Modell</label>
                                <input className="form-control" id="productModel" maxLength={160} list="modelOptions"
                                    placeholder="Auswählen oder eingeben" autoComplete="off" value={form.model}
                                    onChange={event => updateForm('model', event.target.value)} />
                                <datalist id="modelOptions">
                                    {models.map(value => <option key={value} value={value} />)}
                                </datalist>
                            </div>
                            <div className="col-12"><p className="form-text m-0" id="productSuggestionsHint">{suggestionsHint}</p></div>
                            <div className="col-12 col-lg-4">
                                <label className="form-label" htmlFor="productColor">Farbe <span className="product-optional">(optional)</span></label>
                                <input className="form-control" id="productColor" maxLength={80} placeholder="z. B. Gelb / Schwarz"
                                    value={form.color} onChange={event => updateForm('color', event.target.value)} />
                            </div>
                            <div className="col-12 col-lg-4">
                                <label className="form-label" htmlFor="powerValue">Leistung <span className="product-optional">(optional)</span></label>
                                <div className="input-group">
                                    <input type="number" className="form-control" id="powerValue" min="0" max="999999.99" step="0.01"
                                        value={form.powerValue} onChange={event => updateForm('powerValue', event.target.value)} />
                                    <select className="form-select product-unit" id="powerUnit" aria-label="Einheit der Leistung"
                                        value={form.powerUnit} onChange={event => updateForm('powerUnit', event.target.value)}>
                                        <option>kW</option>
                                        <option>PS</option>
                                        <option>W</option>
                                    </select>
                                </div>
                            </div>
                            <div className="col-12 col-lg-4">
                                <label className="form-label" htmlFor="operatingHours">Betriebsstunden <span className="product-optional">(optional)</span></label>
                                <div className="input-group">
                                    <input type="number" className="form-control" id="operatingHours" min="0" max="99999999.99" step="0.01"
                                        value={form.operatingHours} onChange={event => updateForm('operatingHours', event.target.value)} />
                                    <span className="input-group-text">h</span>
                                </div>
                            </div>
                            <div className="col-12 col-lg-4">
                                <label className="form-label" htmlFor="mileageKm">km-Stand <span className="product-optional">(optional)</span></label>
                                <div className="input-group">
                                    <input type="number" className="form-control" id="mileageKm" min="0" max="99999999.99" step="0.01"
                                        value={form.mileageKm} onChange={event => updateForm('mileageKm', event.target.value)} />
                                    <span className="input-group-text">km</span>
                                </div>
                            </div>
                        </div>
                    </section>
                    <section className="product-editor-section" aria-labelledby="productPricingHeading">
                        <h3 id="productPricingHeading">Mietkonditionen</h3>
                        <div className="row g-4">
                            <div className="col-12 col-md-6">
                                <label className="form-label" htmlFor="pricePerDay">Preis pro Tag *</label>
                                <div className="input-group">
                                    <input type="number" step="0.01" min="0" max="999999.99" className="form-control" id="pricePerDay" required
                                        value={form.pricePerDay} onChange={event => updateForm('pricePerDay', event.target.value)} />
                                    <span className="input-group-text">EUR</span>
                                </div>
                            </div>
                            <div className="col-12 col-md-6">
                                <label className="form-label" htmlFor="deposit">Kaution *</label>
                                <div className="input-group">
                                    <input type="number" step="0.01" min="0" max="999999.99" className="form-control" id="deposit" required
                                        value={form.deposit} onChange={event => updateForm('deposit', event.target.value)} />
                                    <span className="input-group-text">EUR</span>
                                </div>
                            </div>
                            <div className="col-12">
                                <label className="form-check">
                                    <input type="checkbox" className="form-check-input" id="hourlyEnabled" checked={form.hourlyEnabled}
                                        onChange={event => updateForm('hourlyEnabled', event.target.checked)} />
                                    <span className="form-check-label">Stundentarife anbieten (8 Stunden zum Tagespreis)</span>
                                </label>
                            </div>
                            <div className="col-12">
                                <div className="row g-3" id="hourlyPricesFields">
                                    {[2, 4, 6].map(hours => (
                                        <div className="col-12 col-sm-4" key={hours}>
                                            <label className="form-label" htmlFor={`price${hours}Hours`}>{hours} Stunden – Gesamtpreis</label>
                                            <div className="input-group">
                                                <input id={`price${hours}Hours`} type="number" min="0.01" step="0.01" className="form-control"
                                                    value={form[`price${hours}`]} onChange={event => updateForm(`price${hours}`, event.target.value)} />
                                                <span className="input-group-text">EUR</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>
                    <section className="product-editor-section" aria-labelledby="productPhotosHeading">
                        <h3 id="productPhotosHeading">Produktfotos</h3>
                        <div className="product-photo-upload">
                            <label className="form-label" htmlFor="productImages"><i className="bi bi-upload" aria-hidden="true" /> Bilder auswählen</label>
                            <input type="file" className="form-control" id="productImages" accept="image/*" multiple ref={imagesInputRef} />
                            <div className="form-text">Bis zu 10 Bilder. Die Bilder werden mit dem Produkt gespeichert.</div>
                        </div>
                        <div className={existingImages?.images.length ? 'mt-3' : 'mt-3 d-none'} id="existingImagesWrapper">
                            <p className="form-label">Vorhandene Bilder</p>
                            <div id="existingImages" className="row g-2" ref={existingImagesRef}>
                                {(existingImages?.images || []).map(image => (
                                    <div key={image.id} className={`col-6 col-md-3 draggable-image${draggedImageRef.current === image.id ? ' dragging' : ''}`}
                                        draggable data-image-id={image.id}
                                        onDragStart={event => {
                                            draggedImageRef.current = image.id;
                                            event.currentTarget.classList.add('dragging');
                                        }}
                                        onDragEnd={event => {
                                            event.currentTarget.classList.remove('dragging');
                                            draggedImageRef.current = null;
                                            saveImageOrder(existingImages.productId, existingImages.images);
                                        }}
                                        onDragOver={dragOver}>
                                        <div className="card h-100">
                                            <img src={image.path} className="card-img-top" style={{ height: 120, objectFit: 'cover' }} alt="" />
                                            <div className="card-body p-2">
                                                <small className="text-muted d-block mb-2">Ziehen zum Sortieren</small>
                                                <button type="button" className="btn btn-danger btn-sm w-100"
                                                    onClick={() => deleteProductImage(image.id, existingImages.productId)}>Löschen</button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                    <div className="product-editor-actions">
                        <span className="form-text">* Pflichtfelder</span>
                        <button type="button" className="btn btn-outline-primary" id="resetProductBtn" onClick={resetForm}>Zurücksetzen</button>
                        <button type="button" className="btn btn-danger" id="cancelEditBtn" onClick={closeEditor}>Abbrechen</button>
                        <button type="submit" className="btn btn-primary" id="saveProductBtn" disabled={saving}>
                            {editing ? 'Änderungen speichern' : 'Produkt speichern'}
                        </button>
                    </div>
                </form>
            </div>
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-3 mb-3">
                <h2 className="mb-0">Vorhandene Produkte</h2>
                <div className="d-flex align-items-center flex-wrap gap-2">
                    <button type="button" className={editorOpen ? 'btn btn-primary d-none' : 'btn btn-primary'} id="newProductBtn"
                        ref={newButtonRef}
                        onClick={() => {
                            resetForm();
                            openEditor();
                            window.setTimeout(() => titleRef.current?.focus(), 0);
                        }}>
                        <i className="bi bi-plus-lg" aria-hidden="true" /> Produkt anlegen
                    </button>
                    <input type="search" id="backendProductSearchInput" className="form-control w-auto" placeholder="Produkt suchen..."
                        value={search}
                        onChange={event => {
                            setSearch(event.target.value);
                            const nextQuery = event.target.value.trim().toLowerCase();
                            setSearchResult((products || []).filter(product => productMatches(product, nextQuery)));
                        }} />
                </div>
            </div>

            <div id="productList">
                {visibleProducts === null ? null : visibleProducts.length === 0
                    ? <div className="alert alert-info">Keine Produkte gefunden.</div>
                    : visibleProducts.map(product => <ProductCard key={product.id} product={product} />)}
            </div>
        </div>
    );
});

export default ProductsView;
