'use client';

import { useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { money } from './admin-utils';
import type { PaymentAction } from './types';
import styles from './admin.module.css';

export interface PaymentSubmission {
  amount: number;
  note: string;
}

export function PaymentDialog({
  action,
  onClose,
  onSubmit,
}: {
  action: PaymentAction | null;
  onClose: () => void;
  onSubmit: (action: PaymentAction, submission: PaymentSubmission) => Promise<boolean>;
}) {
  if (!action) return null;
  return <PaymentDialogForm action={action} key={`${action.mode}-${action.orderId}-${action.orderItemId}-${action.paymentType}`} onClose={onClose} onSubmit={onSubmit} />;
}

function PaymentDialogForm({
  action,
  onClose,
  onSubmit,
}: {
  action: PaymentAction;
  onClose: () => void;
  onSubmit: (action: PaymentAction, submission: PaymentSubmission) => Promise<boolean>;
}) {
  const [note, setNote] = useState(action.mode === 'refund' ? 'Bar-Rückerstattung an Kunden ausgezahlt' : '');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const saved = await onSubmit(action, { amount: action.amount, note: note.trim() });
    setSaving(false);
    if (saved) onClose();
  }

  const refund = action.mode === 'refund';
  return (
    <Dialog
      footer={(
        <>
          <button className="button buttonSecondary" disabled={saving} onClick={onClose} type="button">Abbrechen</button>
          <button className={`button ${refund ? 'buttonDanger' : ''}`} disabled={saving} form="manualPaymentForm" type="submit">
            {saving ? 'Wird gespeichert …' : refund ? 'Rückerstattung erfassen' : 'Zahlung erfassen'}
          </button>
        </>
      )}
      onClose={onClose}
      open
      size="small"
      title={refund ? 'Bar-Rückerstattung erfassen' : 'Barzahlung erfassen'}
    >
      <form className={styles.dialogForm} id="manualPaymentForm" onSubmit={submit}>
        <div className={styles.contextBox}>
          <span>Bestellung #{action.orderId}{action.orderItemId ? ` · Position #${action.orderItemId}` : ''}</span>
          <strong>Vorgemerkter Betrag: {money(action.amount)}</strong>
        </div>
        <label className="field">
          <span className="fieldLabel">Betrag *</span>
          <input autoFocus className="input" readOnly type="text" value={action.amount.toFixed(2)} />
        </label>
        <label className="field">
          <span className="fieldLabel">Notiz</span>
          <textarea className="textarea" onChange={(event) => setNote(event.target.value)} placeholder={refund ? 'Dokumentation der Auszahlung' : 'z. B. im Ladengeschäft erhalten'} value={note} />
        </label>
        <p className={styles.infoCallout}>
          {refund
            ? 'Mit dem Speichern wird die Barauszahlung verbindlich dokumentiert.'
            : 'Nach dem Speichern erhält der Kunde automatisch eine Zahlungsbestätigung per E-Mail.'}
        </p>
      </form>
    </Dialog>
  );
}
