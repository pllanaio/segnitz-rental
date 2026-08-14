'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { apiJson } from '@/lib/api/client';
import type { CartItem } from '@/lib/api/types';
import { calculateRentalDays, formatCurrency, imageSource, localIsoDate } from '@/lib/format';
import styles from './shop.module.css';

export interface CartTotals {
  rentalGross: number;
  rentalNet: number;
  vat: number;
  deposit: number;
  grandTotal: number;
}

export function calculateCartTotals(items: CartItem[]): CartTotals {
  const rentalGross = items.reduce((total, item) => total + Number(item.pricePerDay) * calculateRentalDays(item.rentalStart, item.rentalEnd) * Number(item.quantity || 1), 0);
  const rentalNet = rentalGross / 1.19;
  const deposit = items.reduce((total, item) => total + Number(item.deposit) * Number(item.quantity || 1), 0);
  return { rentalGross, rentalNet, vat: rentalGross - rentalNet, deposit, grandTotal: rentalGross + deposit };
}

function CartLine({ item, onChanged, notify }: {
  item: CartItem;
  onChanged: () => Promise<void> | void;
  notify: (message: string, tone?: 'success' | 'danger' | 'info' | 'warning') => void;
}) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(item.rentalStart);
  const [end, setEnd] = useState(item.rentalEnd);
  const [busy, setBusy] = useState(false);
  const days = calculateRentalDays(item.rentalStart, item.rentalEnd);

  async function save() {
    setBusy(true);
    try {
      await apiJson(`/cart/items/${item.id}`, 'PUT', { rentalStart: start, rentalEnd: end });
      await onChanged();
      setEditing(false);
      notify('Mietzeitraum wurde aktualisiert.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Mietzeitraum konnte nicht gespeichert werden.', 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await apiJson(`/cart/items/${item.id}`, 'DELETE');
      await onChanged();
      notify(`${item.title} wurde entfernt.`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Der Artikel konnte nicht entfernt werden.', 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={styles.cartLine}>
      <Image alt="" height={110} src={imageSource(item.imagePath)} unoptimized width={140} />
      <div className={styles.cartLineContent}>
        <div className={styles.cartLineHeading}>
          <div><h3>{item.title}</h3><p>{days} {days === 1 ? 'Tag' : 'Tage'} · {formatCurrency(item.pricePerDay)} / Tag</p></div>
          <strong>{formatCurrency(Number(item.pricePerDay) * days)}</strong>
        </div>
        {editing ? (
          <div className={styles.cartEditRow}>
            <label>Von<input className="input" min={localIsoDate()} onChange={(event) => {
              setStart(event.target.value);
              if (end < event.target.value) setEnd(event.target.value);
            }} type="date" value={start} /></label>
            <label>Bis<input className="input" min={start} onChange={(event) => setEnd(event.target.value)} type="date" value={end} /></label>
            <button className="button" disabled={busy || !start || !end || end < start} onClick={save} type="button">Speichern</button>
            <button className="button buttonGhost" onClick={() => setEditing(false)} type="button">Abbrechen</button>
          </div>
        ) : (
          <div className={styles.cartLineActions}>
            <span><Icon name="calendar" size={16} /> {new Intl.DateTimeFormat('de-DE').format(new Date(`${item.rentalStart}T00:00:00`))} – {new Intl.DateTimeFormat('de-DE').format(new Date(`${item.rentalEnd}T00:00:00`))}</span>
            <button className="button buttonGhost" disabled={busy} onClick={() => setEditing(true)} type="button"><Icon name="edit" size={16} /> Zeitraum ändern</button>
            <button className="button buttonGhost" disabled={busy} onClick={remove} type="button"><Icon name="trash" size={16} /> Entfernen</button>
          </div>
        )}
      </div>
    </article>
  );
}

export function CostSummary({ items, compact = false }: { items: CartItem[]; compact?: boolean }) {
  const totals = calculateCartTotals(items);
  return (
    <section className={`${styles.costSummary} ${compact ? styles.costSummaryCompact : ''}`} aria-label="Kostenübersicht">
      <h3>Kostenübersicht</h3>
      <div><span>Mietpreis netto</span><strong>{formatCurrency(totals.rentalNet)}</strong></div>
      <div><span>Mehrwertsteuer 19 %</span><strong>{formatCurrency(totals.vat)}</strong></div>
      <div><span>Mietpreis brutto</span><strong>{formatCurrency(totals.rentalGross)}</strong></div>
      <div className={styles.summaryDeposit}><span>Kaution</span><strong>{formatCurrency(totals.deposit)}</strong></div>
      <p>Die Kaution wird nach Rückgabe und Zustandsprüfung vollständig oder teilweise erstattet.</p>
      <div className={styles.summaryTotal}><span>Heute zu zahlen</span><strong>{formatCurrency(totals.grandTotal)}</strong></div>
    </section>
  );
}

export function CartContents({ items, onChanged, notify }: {
  items: CartItem[];
  onChanged: () => Promise<void> | void;
  notify: (message: string, tone?: 'success' | 'danger' | 'info' | 'warning') => void;
}) {
  if (!items.length) {
    return <div className="emptyState"><div><Icon name="cart" size={34} /><h3>Ihr Warenkorb ist leer</h3><p>Wählen Sie einen Mietartikel und einen Zeitraum aus.</p></div></div>;
  }

  return <div className={styles.cartLines}>{items.map((item) => <CartLine item={item} key={item.id} notify={notify} onChanged={onChanged} />)}</div>;
}

export function CartDialog({ open, items, onClose, onCheckout, onChanged, notify }: {
  open: boolean;
  items: CartItem[];
  onClose: () => void;
  onCheckout: () => void;
  onChanged: () => Promise<void> | void;
  notify: (message: string, tone?: 'success' | 'danger' | 'info' | 'warning') => void;
}) {
  const [clearing, setClearing] = useState(false);

  async function clearCart() {
    setClearing(true);
    try {
      await apiJson('/cart', 'DELETE');
      await onChanged();
      notify('Der Warenkorb wurde geleert.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Der Warenkorb konnte nicht geleert werden.', 'danger');
    } finally {
      setClearing(false);
    }
  }

  return (
    <Dialog
      description={`${items.length} ${items.length === 1 ? 'Mietartikel' : 'Mietartikel'}`}
      footer={(
        <>
          {items.length ? <button className="button buttonGhost" disabled={clearing} onClick={clearCart} type="button"><Icon name="trash" size={17} /> Leeren</button> : null}
          <span className={styles.footerSpacer} />
          <button className="button buttonSecondary" onClick={onClose} type="button">Weiter auswählen</button>
          <button className="button" disabled={!items.length} onClick={onCheckout} type="button">Zur Kasse <Icon name="arrow-right" size={17} /></button>
        </>
      )}
      onClose={onClose}
      open={open}
      size="large"
      title="Warenkorb"
    >
      <div className={styles.cartDialogGrid}>
        <CartContents items={items} notify={notify} onChanged={onChanged} />
        {items.length ? <CostSummary compact items={items} /> : null}
      </div>
    </Dialog>
  );
}
