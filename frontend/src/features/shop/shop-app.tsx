'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { AlertRegion } from '@/components/ui/alert-region';
import { Brand } from '@/components/ui/brand';
import { Icon } from '@/components/ui/icon';
import { useAlerts } from '@/hooks/use-alerts';
import { normalizeProducts } from '@/lib/api/adapters';
import { apiJson, setCsrfToken } from '@/lib/api/client';
import type { AuthStatus, CartResponse, Category, OpeningStatus, Product, ProductDto, ProfileDto } from '@/lib/api/types';
import { CartDialog } from './cart-view';
import { CheckoutFlow } from './checkout-flow';
import { PaymentReturn } from './payment-return';
import { ProductCard } from './product-card';
import { ProductDialog } from './product-dialog';
import styles from './shop.module.css';

const PAGE_SIZE = 12;

export function ShopApp() {
  const { alerts, dismiss, notify } = useAlerts();
  const { data: productDtos, error: productError, isLoading: productsLoading } = useSWR<ProductDto[]>('/products');
  const { data: bestsellerDtos } = useSWR<ProductDto[]>('/products/bestsellers');
  const { data: categories = [] } = useSWR<Category[]>('/categories');
  const { data: cart = { cartId: null, items: [] }, mutate: mutateCart } = useSWR<CartResponse>('/cart');
  const { data: auth, isLoading: authLoading, mutate: mutateAuth } = useSWR<AuthStatus>('/auth-status');
  const { data: profile, isLoading: profileLoading } = useSWR<ProfileDto>(auth?.loggedIn ? '/my-profile' : null);
  const { data: opening } = useSWR<OpeningStatus>('/opening-hours/status');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    if (auth && !auth.loggedIn) setCsrfToken(null);
  }, [auth]);

  const products = useMemo(() => normalizeProducts(productDtos).filter((product) => product.isActive), [productDtos]);
  const bestsellers = useMemo(() => normalizeProducts(bestsellerDtos).filter((product) => product.isActive), [bestsellerDtos]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('de');
    return products.filter((product) => {
      const categoryMatch = category === 'all' || product.categories.some((item) => item.slug === category || item.name === category);
      const searchMatch = !term || `${product.title} ${product.description} ${product.key} ${product.categories.map((item) => item.name).join(' ')}`.toLocaleLowerCase('de').includes(term);
      return categoryMatch && searchMatch;
    });
  }, [category, products, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function selectCategory(value: string) {
    setCategory(value);
    setPage(1);
    setMobileNav(false);
  }

  async function onAdded(message: string) {
    await mutateCart();
    notify(message, 'success');
  }

  async function logout() {
    try {
      await apiJson('/logout', 'POST');
      setCsrfToken(null);
      await Promise.all([mutateAuth(), mutateCart()]);
      notify('Sie wurden erfolgreich abgemeldet.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Die Abmeldung ist fehlgeschlagen.', 'danger');
    }
  }

  if (checkout) {
    return (
      <div className={styles.shopShell}>
        <AlertRegion alerts={alerts} dismiss={dismiss} />
        <header className={styles.checkoutHeader}><Brand compact /><a href="/index.html">Mietübersicht</a></header>
        {authLoading || (auth?.loggedIn && profileLoading) ? (
          <main className={styles.checkoutMain}><div className={`${styles.checkoutLoading} skeleton`} aria-label="Kundendaten werden geladen" /></main>
        ) : (
          <CheckoutFlow
            auth={auth}
            items={cart.items}
            notify={notify}
            onBackToCatalog={() => setCheckout(false)}
            onCartChanged={async () => { await mutateCart(); }}
            profile={profile}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.shopShell}>
      <AlertRegion alerts={alerts} dismiss={dismiss} />
      <header className={styles.mobileHeader}>
        <button aria-expanded={mobileNav} aria-label="Navigation öffnen" className="iconButton" onClick={() => setMobileNav((value) => !value)} type="button"><Icon name="menu" /></button>
        <Brand compact />
        <button aria-label={`Warenkorb mit ${cart.items.length} Artikeln öffnen`} className={`iconButton ${styles.cartButton}`} onClick={() => setCartOpen(true)} type="button"><Icon name="cart" /><span>{cart.items.length}</span></button>
      </header>

      <aside className={`${styles.sidebar} ${mobileNav ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarBrand}><Brand /><p>Werkzeuge einfach mieten</p></div>
        <div className={styles.openingStatus} id="openingStatusBox">
          <span className={opening?.isOpen ? styles.openDot : styles.closedDot} />
          <div><strong id="openingStatusLabel">{opening?.label ?? 'Status wird geladen …'}</strong>{opening?.openTime && opening?.closeTime ? <small>{opening.openTime} – {opening.closeTime} Uhr</small> : <small>Aktueller Abholstatus</small>}</div>
        </div>

        <nav aria-label="Konto" className={styles.accountNav}>
          {auth?.loggedIn ? (
            <>
              <p>Angemeldet als <strong>{auth.user}</strong></p>
              {auth.role === 'global_admin' ? <a className={styles.sidebarLink} href="/backend.html"><Icon name="lock" size={18} /> Administration</a> : null}
              <a className={styles.sidebarLink} href="/profile.html"><Icon name="user" size={18} /> Mein Profil</a>
              <button className={styles.sidebarLink} onClick={logout} type="button"><Icon name="logout" size={18} /> Abmelden</button>
            </>
          ) : (
            <>
              <a className={styles.sidebarPrimary} href="/login.html"><Icon name="user" size={18} /> Anmelden</a>
              <a className={styles.sidebarSecondary} href="/register.html">Konto erstellen</a>
            </>
          )}
        </nav>

        <nav aria-label="Produktkategorien" className={styles.categoryNav} id="categoryFilterList">
          <p>Produktkategorien</p>
          <button aria-current={category === 'all' ? 'page' : undefined} className={category === 'all' ? styles.categoryActive : ''} onClick={() => selectCategory('all')} type="button"><span>Alle Produkte</span><small>{products.length}</small></button>
          {categories.map((item) => (
            <button aria-current={category === item.slug ? 'page' : undefined} className={category === item.slug ? styles.categoryActive : ''} key={item.id} onClick={() => selectCategory(item.slug)} type="button"><span>{item.name}</span><small>{products.filter((product) => product.categories.some((productCategory) => productCategory.id === item.id)).length}</small></button>
          ))}
        </nav>
        <p className={styles.sidebarFooter}>Segnitz Rental<br />Sicher und transparent mieten.</p>
      </aside>

      <main className={styles.catalogMain}>
        <PaymentReturn onDone={() => { void mutateCart(); }} />
        <div className={styles.catalogTopbar}>
          <div><p className={styles.eyebrow}>Segnitz Rental</p><h1>Was möchten Sie mieten?</h1><p>Verfügbarkeit prüfen, Zeitraum wählen und direkt reservieren.</p></div>
          <div className={styles.catalogActions}>
            <label className={styles.searchBox} htmlFor="productSearchInput"><Icon name="search" size={19} /><span className="srOnly">Produkt suchen</span><input id="productSearchInput" onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Produkt suchen …" type="search" value={search} /></label>
            <button aria-label={`Warenkorb mit ${cart.items.length} Artikeln öffnen`} className={`button buttonSecondary ${styles.desktopCart}`} onClick={() => setCartOpen(true)} type="button"><Icon name="cart" /><span>Warenkorb</span><strong id="cartItemCount">{cart.items.length}</strong></button>
          </div>
        </div>

        {category === 'all' && !search && bestsellers.length ? (
          <section className={styles.featuredSection} id="bestsellerSection">
            <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>Häufig gebucht</p><h2>Beliebte Mietartikel</h2></div></div>
            <div className={styles.productGridFeatured} id="bestsellerGrid">{bestsellers.slice(0, 3).map((product) => <ProductCard featured key={product.id} onSelect={setSelectedProduct} product={product} />)}</div>
          </section>
        ) : null}

        <section className={styles.productSection}>
          <div className={styles.sectionTitle}>
            <div><p className={styles.eyebrow}>{category === 'all' ? 'Gesamtes Sortiment' : 'Gefilterte Auswahl'}</p><h2 id="productSectionTitle">{category === 'all' ? 'Produkte zur Vermietung' : categories.find((item) => item.slug === category)?.name ?? 'Produkte'}</h2></div>
            {!productsLoading ? <span>{filtered.length} {filtered.length === 1 ? 'Artikel' : 'Artikel'}</span> : null}
          </div>
          {productsLoading ? <div className={styles.productGrid}>{Array.from({ length: 6 }, (_, index) => <div className={`${styles.productSkeleton} skeleton`} key={index} />)}</div> : null}
          {productError ? <div className="emptyState"><div><Icon name="info" size={34} /><h3>Produkte konnten nicht geladen werden</h3><p>Bitte laden Sie die Seite erneut.</p></div></div> : null}
          {!productsLoading && !productError && !visible.length ? <div className="emptyState"><div><Icon name="search" size={34} /><h3>Keine passenden Produkte</h3><p>Ändern Sie Suche oder Kategorie.</p><button className="button buttonSecondary" onClick={() => { setSearch(''); selectCategory('all'); }} type="button">Filter zurücksetzen</button></div></div> : null}
          {!productsLoading && !productError && visible.length ? <div className={styles.productGrid} id="productGrid">{visible.map((product) => <ProductCard key={product.id} onSelect={setSelectedProduct} product={product} />)}</div> : null}
          {pageCount > 1 ? (
            <nav aria-label="Produktseiten" className={styles.pagination} id="productPagination">
              <button aria-label="Vorherige Seite" className="iconButton" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><Icon name="arrow-left" /></button>
              <span>Seite {page} von {pageCount}</span>
              <button aria-label="Nächste Seite" className="iconButton" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button"><Icon name="arrow-right" /></button>
            </nav>
          ) : null}
        </section>
      </main>

      {mobileNav ? <button aria-label="Navigation schließen" className={styles.navBackdrop} onClick={() => setMobileNav(false)} type="button" /> : null}
      <ProductDialog key={selectedProduct?.id ?? 'closed'} onAdded={onAdded} onClose={() => setSelectedProduct(null)} product={selectedProduct} />
      <CartDialog
        items={cart.items}
        notify={notify}
        onChanged={async () => { await mutateCart(); }}
        onCheckout={() => { setCartOpen(false); setCheckout(true); }}
        onClose={() => setCartOpen(false)}
        open={cartOpen}
      />
    </div>
  );
}
