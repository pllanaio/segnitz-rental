'use client';

import Image from 'next/image';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/ui/icon';
import { apiGet, apiJson, apiRequest } from '@/lib/api/client';
import { AdminConfirmDialog, useAdminConfirm } from './admin-confirm';
import { assetPath, errorMessage, money } from './admin-utils';
import type {
  AdminMessageResponse,
  AdminProduct,
  AdminProductImage,
  Category,
  Notify,
  ProductDto,
} from './types';
import styles from './admin.module.css';

interface ProductFormState {
  id: number | null;
  productKey: string;
  title: string;
  description: string;
  pricePerDay: string;
  deposit: string;
  categories: string[];
  isActive: boolean;
  images: AdminProductImage[];
}

const EMPTY_FORM: ProductFormState = {
  id: null,
  productKey: '',
  title: '',
  description: '',
  pricePerDay: '',
  deposit: '',
  categories: [],
  isActive: true,
  images: [],
};

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function normalizeProduct(product: ProductDto): AdminProduct {
  const categories = Array.isArray(product.categories)
    ? product.categories.filter((category) => category && typeof category.name === 'string')
    : [];
  return {
    ...product,
    id: Number(product.id),
    product_key: String(product.product_key ?? ''),
    title: String(product.title ?? ''),
    description: product.description ?? '',
    price_per_day: product.price_per_day ?? 0,
    deposit: product.deposit ?? 0,
    image_path: product.image_path ?? null,
    is_active: product.is_active ?? false,
    images: Array.isArray(product.images)
      ? product.images.map((image) => ({ id: Number(image.id), path: String(image.path) }))
      : [],
    categories,
  };
}

function normalizedCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function ProductsView({ notify }: { notify: Notify }) {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [categoryInput, setCategoryInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draggedImageId, setDraggedImageId] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const formTop = useRef<HTMLDivElement>(null);
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase('de'));
  const { confirmation, requestConfirmation, settle } = useAdminConfirm();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [productDtos, categories] = await Promise.all([
        apiGet<ProductDto[]>('/products'),
        apiGet<Category[]>('/categories'),
      ]);
      const nextProducts = productDtos.map(normalizeProduct);
      setProducts(nextProducts);
      setAvailableCategories(categories.map((category) => category.name));
      setForm((current) => {
        if (current.id === null) return current;
        const updated = nextProducts.find((product) => product.id === current.id);
        return updated ? formFromProduct(updated) : EMPTY_FORM;
      });
    } catch (error) {
      notify(errorMessage(error, 'Produkte konnten nicht geladen werden.'), 'danger');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadData]);

  const filteredProducts = useMemo(() => {
    if (!deferredSearch) return products;
    return products.filter((product) => [
      product.title,
      product.description,
      product.product_key,
      product.price_per_day,
      product.deposit,
      Number(product.is_active) === 1 || product.is_active === true ? 'aktiv' : 'inaktiv',
      ...product.categories.map((category) => category.name),
    ].join(' ').toLocaleLowerCase('de').includes(deferredSearch));
  }, [deferredSearch, products]);

  const categorySuggestions = useMemo(() => {
    const query = normalizedCategoryName(categoryInput).toLocaleLowerCase('de');
    const selected = new Set(form.categories.map((category) => category.toLocaleLowerCase('de')));
    return [...availableCategories]
      .filter((category) => !selected.has(category.toLocaleLowerCase('de')))
      .filter((category) => !query || category.toLocaleLowerCase('de').includes(query))
      .sort((left, right) => left.localeCompare(right, 'de'));
  }, [availableCategories, categoryInput, form.categories]);

  function addCategory(value: string) {
    const name = normalizedCategoryName(value);
    if (!name) return;
    if (name.length > 100) {
      notify('Kategorien dürfen maximal 100 Zeichen lang sein.', 'warning');
      return;
    }
    if (form.categories.some((category) => category.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'))) {
      notify('Diese Kategorie ist bereits ausgewählt.', 'warning');
      return;
    }
    setForm((current) => ({ ...current, categories: [...current.categories, name] }));
    setAvailableCategories((current) => current.some((category) => category.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'))
      ? current
      : [...current, name]);
    setCategoryInput('');
  }

  function editProduct(product: AdminProduct) {
    setForm(formFromProduct(product));
    if (fileInput.current) fileInput.current.value = '';
    formTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setCategoryInput('');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.productKey.trim() || !form.title.trim()) {
      notify('Produkt-Key und Titel sind Pflichtfelder.', 'warning');
      return;
    }
    const pricePerDay = Number(form.pricePerDay.replace(',', '.'));
    const deposit = Number(form.deposit.replace(',', '.'));
    if (!Number.isFinite(pricePerDay) || !Number.isFinite(deposit) || pricePerDay < 0 || deposit < 0) {
      notify('Bitte gültige, nicht negative Werte für Preis und Kaution eingeben.', 'warning');
      return;
    }
    const files = Array.from(fileInput.current?.files ?? []);
    if (form.images.length + files.length > 10) {
      notify('Pro Produkt sind maximal 10 Bilder erlaubt.', 'warning');
      return;
    }
    if (files.some((file) => !ACCEPTED_IMAGE_TYPES.has(file.type))) {
      notify('Nur JPEG-, PNG- und WebP-Bilder sind erlaubt.', 'warning');
      return;
    }
    if (files.some((file) => file.size > MAX_IMAGE_BYTES)) {
      notify('Jedes Produktbild darf maximal 5 MiB groß sein.', 'warning');
      return;
    }
    if (form.categories.some((category) => normalizedCategoryName(category).length > 100)) {
      notify('Kategorien dürfen maximal 100 Zeichen lang sein.', 'warning');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        pricePerDay,
        deposit,
        category: form.categories[0] ?? '',
        categories: form.categories,
      };
      const result = form.id === null
        ? await apiJson<AdminMessageResponse>('/products', 'POST', {
            ...payload,
            productKey: form.productKey.trim(),
            imagePath: '',
          })
        : await apiJson<AdminMessageResponse>(`/products/${form.id}`, 'PUT', {
            ...payload,
            isActive: form.isActive,
          });
      const productId = form.id ?? result.productId;
      if (!productId) throw new Error('Die Produkt-ID fehlt in der Serverantwort.');

      if (files.length > 0) {
        const body = new FormData();
        files.forEach((file) => body.append('images', file));
        await apiRequest<AdminMessageResponse>(`/products/${productId}/images`, { method: 'POST', body });
      }

      notify(result.message ?? 'Produkt wurde gespeichert.', 'success');
      await loadData();
      setForm((current) => ({ ...current, id: Number(productId) }));
      if (fileInput.current) fileInput.current.value = '';
    } catch (error) {
      notify(errorMessage(error, 'Produkt konnte nicht gespeichert werden.'), 'danger');
    } finally {
      setSaving(false);
    }
  }

  async function deactivateProduct(product: AdminProduct) {
    const confirmed = await requestConfirmation({
      title: 'Produkt deaktivieren',
      message: `„${product.title}“ wird aus dem öffentlichen Sortiment entfernt. Historische Bestellungen bleiben erhalten.`,
      confirmLabel: 'Produkt deaktivieren',
    });
    if (!confirmed) return;
    try {
      const result = await apiJson<AdminMessageResponse>(`/products/${product.id}`, 'DELETE');
      notify(result.message ?? 'Produkt wurde deaktiviert.', 'success');
      await loadData();
    } catch (error) {
      notify(errorMessage(error, 'Produkt konnte nicht deaktiviert werden.'), 'danger');
    }
  }

  async function deleteImage(image: AdminProductImage) {
    if (form.id === null) return;
    const confirmed = await requestConfirmation({
      title: 'Produktbild löschen',
      message: 'Das Bild wird dauerhaft vom Produkt entfernt.',
      confirmLabel: 'Bild löschen',
    });
    if (!confirmed) return;
    try {
      const result = await apiJson<AdminMessageResponse>(`/product-images/${image.id}`, 'DELETE');
      notify(result.message ?? 'Bild wurde gelöscht.', 'success');
      await loadData();
    } catch (error) {
      notify(errorMessage(error, 'Bild konnte nicht gelöscht werden.'), 'danger');
    }
  }

  async function moveImage(sourceId: number, targetId: number) {
    if (form.id === null || sourceId === targetId) return;
    const sourceIndex = form.images.findIndex((image) => image.id === sourceId);
    const targetIndex = form.images.findIndex((image) => image.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextImages = [...form.images];
    const [moved] = nextImages.splice(sourceIndex, 1);
    nextImages.splice(targetIndex, 0, moved);
    setForm((current) => ({ ...current, images: nextImages }));
    try {
      await apiJson<AdminMessageResponse>(`/products/${form.id}/images/order`, 'PUT', {
        imageIds: nextImages.map((image) => image.id),
      });
      notify('Bildreihenfolge gespeichert.', 'success');
      await loadData();
    } catch (error) {
      notify(errorMessage(error, 'Bildreihenfolge konnte nicht gespeichert werden.'), 'danger');
      await loadData();
    }
  }

  async function moveImageByOffset(imageId: number, offset: number) {
    const index = form.images.findIndex((image) => image.id === imageId);
    const target = form.images[index + offset];
    if (target) await moveImage(imageId, target.id);
  }

  return (
    <section aria-labelledby="products-heading" className={styles.view}>
      <div className={styles.pageHeading} ref={formTop}>
        <div>
          <span className={styles.eyebrow}>Sortiment</span>
          <h1 id="products-heading">Produkte verwalten</h1>
          <p>Produkte, Kategorien, Preise und Bilder an einem Ort pflegen.</p>
        </div>
        {form.id !== null ? <button className="button buttonSecondary" onClick={resetForm} type="button"><Icon name="plus" /> Neues Produkt</button> : null}
      </div>

      <form className={`card ${styles.editorCard}`} id="productForm" onSubmit={submitProduct}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>{form.id === null ? 'Produkt anlegen' : 'Produkt bearbeiten'}</h2>
            <p>{form.id === null ? 'Alle Pflichtangaben ausfüllen und anschließend Bilder ergänzen.' : `Produkt #${form.id}`}</p>
          </div>
          <span className={`${styles.statePill} ${form.isActive ? styles.stateActive : styles.stateInactive}`}>
            {form.isActive ? 'Aktiv' : 'Inaktiv'}
          </span>
        </div>

        <div className={styles.formGrid}>
          <div className="field">
            <label htmlFor="productKey">Produkt-Key *</label>
            <input
              className="input"
              disabled={form.id !== null}
              id="productKey"
              maxLength={100}
              onChange={(event) => setForm((current) => ({ ...current, productKey: event.target.value }))}
              placeholder="z. B. bautrockner"
              required
              value={form.productKey}
            />
          </div>
          <div className={`${styles.spanTwo} field`}>
            <label htmlFor="title">Titel *</label>
            <input className="input" id="title" maxLength={150} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required value={form.title} />
          </div>
          <div className={`${styles.spanThree} field`}>
            <label htmlFor="description">Beschreibung</label>
            <textarea className="textarea" id="description" onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} value={form.description} />
          </div>
          <div className="field">
            <label htmlFor="pricePerDay">Preis pro Tag *</label>
            <input className="input" id="pricePerDay" max="999999.99" min="0" onChange={(event) => setForm((current) => ({ ...current, pricePerDay: event.target.value }))} required step="0.01" type="number" value={form.pricePerDay} />
          </div>
          <div className="field">
            <label htmlFor="deposit">Kaution *</label>
            <input className="input" id="deposit" max="999999.99" min="0" onChange={(event) => setForm((current) => ({ ...current, deposit: event.target.value }))} required step="0.01" type="number" value={form.deposit} />
          </div>
          <label className={styles.switchField}>
            <input
              checked={form.isActive}
              disabled={form.id === null}
              id="isActive"
              onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              type="checkbox"
            />
            <span aria-hidden="true" className={styles.switchTrack}><span /></span>
            <span>{form.id === null ? 'Produkt wird aktiv angelegt' : 'Produkt aktiv'}</span>
          </label>
        </div>

        <div className={styles.editorSection}>
          <label className="fieldLabel" htmlFor="categoryInput">Kategorien</label>
          <div className={styles.tagList} id="categoryTags">
            {form.categories.length === 0 ? <span className="muted">Keine Kategorien ausgewählt</span> : form.categories.map((category) => (
              <span className={styles.tag} key={category}>
                {category}
                <button aria-label={`${category} entfernen`} onClick={() => setForm((current) => ({ ...current, categories: current.categories.filter((item) => item !== category) }))} type="button"><Icon name="close" size={15} /></button>
              </span>
            ))}
          </div>
          <div className={styles.inlineField}>
            <input
              className="input"
              id="categoryInput"
              maxLength={100}
              onChange={(event) => setCategoryInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  addCategory(categoryInput);
                }
              }}
              placeholder="Kategorie hinzufügen"
              value={categoryInput}
            />
            <button className="button buttonSecondary" onClick={() => addCategory(categoryInput)} type="button">Hinzufügen</button>
          </div>
          {categorySuggestions.length > 0 ? (
            <div aria-label="Verfügbare Kategorien" className={styles.suggestionList}>
              {categorySuggestions.slice(0, 12).map((category) => <button key={category} onClick={() => addCategory(category)} type="button">+ {category}</button>)}
            </div>
          ) : null}
        </div>

        <div className={styles.editorSection}>
          <label className="fieldLabel" htmlFor="productImages">Produktbilder</label>
          <input accept={IMAGE_ACCEPT} className="input" id="productImages" multiple ref={fileInput} type="file" />
          <p className={styles.helpText}>Maximal 10 JPEG-, PNG- oder WebP-Bilder mit je höchstens 5 MiB. Das erste Bild wird als Vorschaubild verwendet.</p>

          {form.images.length > 0 ? (
            <div className={styles.imageGrid} id="existingImages">
              {form.images.map((image, index) => (
                <article
                  className={styles.imageCard}
                  draggable
                  key={image.id}
                  onDragEnd={() => setDraggedImageId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDragStart={() => setDraggedImageId(image.id)}
                  onDrop={() => {
                    if (draggedImageId !== null) void moveImage(draggedImageId, image.id);
                    setDraggedImageId(null);
                  }}
                >
                  <div className={styles.imageFrame}>
                    <Image alt={`${form.title || 'Produkt'} – Bild ${index + 1}`} fill sizes="(max-width: 720px) 50vw, 180px" src={assetPath(image.path)} unoptimized />
                    {index === 0 ? <span className={styles.coverLabel}>Titelbild</span> : null}
                  </div>
                  <div className={styles.imageActions}>
                    <button aria-label="Bild nach vorne" disabled={index === 0} onClick={() => void moveImageByOffset(image.id, -1)} type="button">↑</button>
                    <button aria-label="Bild nach hinten" disabled={index === form.images.length - 1} onClick={() => void moveImageByOffset(image.id, 1)} type="button">↓</button>
                    <button aria-label="Bild löschen" className={styles.deleteIcon} onClick={() => void deleteImage(image)} type="button"><Icon name="trash" size={17} /></button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.formActions}>
          {form.id !== null ? <button className="button buttonSecondary" onClick={resetForm} type="button">Bearbeiten abbrechen</button> : null}
          <button className="button" disabled={saving} id="saveProductBtn" type="submit">
            {saving ? 'Wird gespeichert …' : form.id === null ? 'Produkt speichern' : 'Änderungen speichern'}
          </button>
        </div>
      </form>

      <div className={styles.listHeader}>
        <div>
          <h2>Vorhandene Produkte</h2>
          <p>{products.length} Produkte im Katalog</p>
        </div>
        <label className={styles.searchField}>
          <Icon name="search" />
          <span className="srOnly">Produkt suchen</span>
          <input id="backendProductSearchInput" onChange={(event) => setSearch(event.target.value)} placeholder="Produkt suchen …" type="search" value={search} />
        </label>
      </div>

      {loading ? <ProductSkeleton /> : filteredProducts.length === 0 ? (
        <div className="emptyState">Keine Produkte gefunden.</div>
      ) : (
        <div className={styles.productList} id="productList">
          {filteredProducts.map((product) => {
            const active = product.is_active === true || Number(product.is_active) === 1;
            return (
              <article className={`card ${styles.productRow}`} key={product.id}>
                <div className={styles.productThumb}>
                  {product.image_path ? <Image alt={product.title} fill sizes="112px" src={assetPath(product.image_path)} unoptimized /> : <Icon name="package" size={30} />}
                </div>
                <div className={styles.productInfo}>
                  <div className={styles.productTitleLine}>
                    <h3>{product.title}</h3>
                    <span className={`${styles.statePill} ${active ? styles.stateActive : styles.stateInactive}`}>{active ? 'Aktiv' : 'Inaktiv'}</span>
                  </div>
                  <p>{product.description || 'Keine Beschreibung hinterlegt.'}</p>
                  <div className={styles.productMeta}>
                    <span>Key: {product.product_key}</span>
                    {product.categories.map((category) => <span key={`${product.id}-${category.name}`}>{category.name}</span>)}
                  </div>
                </div>
                <div className={styles.priceColumn}>
                  <strong>{money(product.price_per_day)} / Tag</strong>
                  <span>Kaution {money(product.deposit)}</span>
                </div>
                <div className={styles.rowActions}>
                  <button className="button buttonSecondary" onClick={() => editProduct(product)} type="button"><Icon name="edit" size={17} /> Bearbeiten</button>
                  <button className="button buttonDanger" disabled={!active} onClick={() => void deactivateProduct(product)} type="button"><Icon name="trash" size={17} /> Deaktivieren</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <AdminConfirmDialog confirmation={confirmation} settle={settle} />
    </section>
  );
}

function formFromProduct(product: AdminProduct): ProductFormState {
  return {
    id: product.id,
    productKey: product.product_key,
    title: product.title,
    description: product.description ?? '',
    pricePerDay: String(product.price_per_day ?? ''),
    deposit: String(product.deposit ?? ''),
    categories: product.categories.map((category) => category.name),
    isActive: product.is_active === true || Number(product.is_active) === 1,
    images: [...product.images],
  };
}

function ProductSkeleton() {
  return (
    <div aria-label="Produkte werden geladen" className={styles.productList}>
      {[0, 1, 2].map((key) => <div className={`card skeleton ${styles.productSkeleton}`} key={key} />)}
    </div>
  );
}
