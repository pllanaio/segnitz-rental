'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { addCalendarDay, money, numberValue, rentalDays } from './admin-utils';
import type { AdminOrderItem } from './types';
import styles from './admin.module.css';

export interface RentalAdjustmentSubmission {
  adjustedRentalStart: string;
  adjustedRentalEnd: string;
  adjustedPricePerDay: number;
  paymentMethod: 'online' | 'cash';
}

export function RentalPeriodDialog({
  item,
  orderPaymentMethod,
  onClose,
  onSubmit,
}: {
  item: AdminOrderItem | null;
  orderPaymentMethod: string | null | undefined;
  onClose: () => void;
  onSubmit: (item: AdminOrderItem, submission: RentalAdjustmentSubmission) => Promise<boolean>;
}) {
  if (!item) return null;
  return <RentalPeriodForm item={item} key={item.id} onClose={onClose} onSubmit={onSubmit} orderPaymentMethod={orderPaymentMethod} />;
}

function RentalPeriodForm({
  item,
  orderPaymentMethod,
  onClose,
  onSubmit,
}: {
  item: AdminOrderItem;
  orderPaymentMethod: string | null | undefined;
  onClose: () => void;
  onSubmit: (item: AdminOrderItem, submission: RentalAdjustmentSubmission) => Promise<boolean>;
}) {
  const start = item.adjustedRentalStart || item.rentalStart || '';
  const currentEnd = item.adjustedRentalEnd || item.rentalEnd || '';
  const price = numberValue(item.adjustedPricePerDay || item.pricePerDay);
  const paymentMethod = orderPaymentMethod === 'cash' ? 'cash' : 'online';
  const [end, setEnd] = useState(currentEnd);
  const [saving, setSaving] = useState(false);
  const preview = useMemo(() => {
    const currentDays = rentalDays(start, currentEnd);
    const newDays = rentalDays(start, end);
    const extensionDays = rentalDays(addCalendarDay(currentEnd), end);
    return {
      currentTotal: currentDays * price,
      newTotal: newDays * price,
      extensionDays,
      difference: Math.max(extensionDays * price, 0),
      valid: Boolean(end && currentEnd && end > currentEnd),
    };
  }, [currentEnd, end, price, start]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview.valid) return;
    setSaving(true);
    const saved = await onSubmit(item, {
      adjustedRentalStart: start,
      adjustedRentalEnd: end,
      adjustedPricePerDay: price,
      paymentMethod,
    });
    setSaving(false);
    if (saved) onClose();
  }

  return (
    <Dialog
      footer={(
        <>
          <button className="button buttonSecondary" disabled={saving} onClick={onClose} type="button">Abbrechen</button>
          <button className="button" disabled={!preview.valid || saving} form="rentalPeriodForm" type="submit">{saving ? 'Wird gespeichert …' : 'Verlängerung speichern'}</button>
        </>
      )}
      onClose={onClose}
      open
      size="medium"
      title="Mietzeitraum verlängern"
    >
      <form className={styles.dialogForm} id="rentalPeriodForm" onSubmit={submit}>
        <div className={styles.contextBox}>
          <strong>{item.title || `Position #${item.id}`}</strong>
          <span>Vereinbarter Tagespreis: {money(price)}</span>
        </div>
        <div className={styles.twoColumnForm}>
          <label className="field">
            <span className="fieldLabel">Mietbeginn</span>
            <input className="input" disabled type="date" value={start} />
          </label>
          <label className="field">
            <span className="fieldLabel">Neues Mietende *</span>
            <input autoFocus className="input" min={addCalendarDay(currentEnd)} onChange={(event) => setEnd(event.target.value)} required type="date" value={end} />
          </label>
        </div>
        {!preview.valid && end ? <p className="fieldError">Das neue Mietende muss nach dem bisherigen Mietende liegen.</p> : null}
        <div className={styles.summaryPanel}>
          <SummaryRow label="Ursprünglicher Mietpreis" value={money(preview.currentTotal)} />
          <SummaryRow label="Mietpreis nach Verlängerung" value={money(preview.newTotal)} />
          <SummaryRow label="Verlängerungstage" value={String(preview.extensionDays)} />
          <SummaryRow emphasis label="Zusätzliche Zahlung" value={money(preview.difference)} />
        </div>
        <p className={styles.infoCallout}>
          {paymentMethod === 'cash'
            ? 'Die Nachzahlung wird als offener Barzahlungsvorgang vorgemerkt.'
            : 'Für die Nachzahlung wird nach dem Speichern ein Mollie-Zahlungsvorgang angelegt.'}
        </p>
      </form>
    </Dialog>
  );
}

function SummaryRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={emphasis ? styles.summaryTotal : styles.summaryRow}><span>{label}</span><strong>{value}</strong></div>;
}
