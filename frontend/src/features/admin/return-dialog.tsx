'use client';

import Image from 'next/image';
import { useMemo, useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import {
  assetPath,
  depositDecisionLabel,
  lateDays,
  localIsoDate,
  money,
  numberValue,
} from './admin-utils';
import type { AdminOrderItem, AdminPayment, AdminReturnImage } from './types';
import styles from './admin.module.css';

const RETURN_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_RETURN_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_RETURN_IMAGE_FILES = 10;

export function returnFileValidationError(files: File[]): string | null {
  if (files.length > MAX_RETURN_IMAGE_FILES) {
    return 'Maximal 10 Rückgabefotos pro Upload.';
  }
  if (files.some((file) => !RETURN_IMAGE_TYPES.has(file.type))) {
    return 'Rückgabefotos müssen JPEG-, PNG- oder WebP-Dateien sein.';
  }
  if (files.some((file) => file.size > MAX_RETURN_IMAGE_SIZE)) {
    return 'Jedes Rückgabefoto darf maximal 5 MiB groß sein.';
  }
  return null;
}

export interface ReturnSubmission {
  actualReturnDate: string;
  adjustedRentalStart: string | null;
  adjustedRentalEnd: string | null;
  adjustedPricePerDay: number;
  returnStatus: string;
  isDamaged: boolean;
  damageDescription: string;
  isLate: boolean;
  lateDescription: string;
  depositDecision: string;
  depositDeductionPercent: number;
  depositRefundAmount: number;
  depositDeductionReason: string;
  additionalChargeReason: string;
  additionalChargeAmount: number;
  additionalChargePaymentMethod: 'online' | 'cash';
  returnNotes: string;
}

export function ReturnDialog({
  item,
  payments,
  onClose,
  onDeleteImage,
  onSubmit,
  onUpload,
}: {
  item: AdminOrderItem | null;
  payments: AdminPayment[];
  onClose: () => void;
  onDeleteImage: (image: AdminReturnImage) => Promise<void>;
  onSubmit: (item: AdminOrderItem, submission: ReturnSubmission, files: File[]) => Promise<boolean>;
  onUpload: (item: AdminOrderItem, files: File[]) => Promise<boolean>;
}) {
  if (!item) return null;
  return (
    <ReturnDialogForm
      item={item}
      key={item.id}
      onClose={onClose}
      onDeleteImage={onDeleteImage}
      onSubmit={onSubmit}
      onUpload={onUpload}
      payments={payments}
    />
  );
}

function ReturnDialogForm({
  item,
  payments,
  onClose,
  onDeleteImage,
  onSubmit,
  onUpload,
}: {
  item: AdminOrderItem;
  payments: AdminPayment[];
  onClose: () => void;
  onDeleteImage: (image: AdminReturnImage) => Promise<void>;
  onSubmit: (item: AdminOrderItem, submission: ReturnSubmission, files: File[]) => Promise<boolean>;
  onUpload: (item: AdminOrderItem, files: File[]) => Promise<boolean>;
}) {
  const agreedStart = item.adjustedRentalStart || item.rentalStart || '';
  const agreedEnd = item.adjustedRentalEnd || item.rentalEnd || '';
  const earliestReturnDate = String(item.pickedUpAt || item.picked_up_at || agreedStart).slice(0, 10);
  const price = numberValue(item.adjustedPricePerDay || item.pricePerDay);
  const deposit = numberValue(item.deposit);
  const [actualDate, setActualDate] = useState(item.actualReturnDate || localIsoDate());
  const [damaged, setDamaged] = useState(Boolean(item.isDamaged));
  const [damageDescription, setDamageDescription] = useState(item.damageDescription ?? '');
  const [additionalReason, setAdditionalReason] = useState(item.additionalChargeReason ?? '');
  const [additionalAmount, setAdditionalAmount] = useState(String(item.additionalChargeAmount ?? ''));
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'cash'>('online');
  const [notes, setNotes] = useState(item.returnNotes ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const settlement = useMemo(() => {
    const daysLate = lateDays(actualDate, agreedEnd);
    const lateFee = daysLate * price;
    const repairCosts = Math.max(numberValue(additionalAmount.replace(',', '.')), 0);
    const openRentalAdjustment = payments
      .filter((payment) => Number(payment.orderItemId) === item.id
        && payment.paymentType === 'rental_adjustment'
        && ['pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'].includes(String(payment.paymentStatus)))
      .reduce((sum, payment) => sum + numberValue(payment.amount), 0);
    const obligations = repairCosts + lateFee + openRentalAdjustment;
    const refund = Math.max(deposit - obligations, 0);
    const retained = Math.max(deposit - refund, 0);
    const customerDue = Math.max(obligations - deposit, 0);
    const status = damaged && daysLate > 0
      ? 'returned_late_damaged'
      : damaged
        ? 'returned_damaged'
        : daysLate > 0
          ? 'returned_late'
          : 'returned_ok';
    const decision = refund >= deposit && deposit > 0
      ? 'full_refund'
      : refund > 0
        ? 'partial_refund'
        : 'no_refund';
    const reasons = [
      repairCosts > 0 ? 'Zusatzkosten mit Kaution verrechnet' : '',
      openRentalAdjustment > 0 ? 'Offene Mietverlängerung mit Kaution verrechnet' : '',
      lateFee > 0 ? 'Verspätungskosten mit Kaution verrechnet' : '',
    ].filter(Boolean).join(' | ');
    return {
      daysLate,
      lateFee,
      repairCosts,
      openRentalAdjustment,
      refund,
      retained,
      customerDue,
      status,
      decision,
      deductionPercent: deposit > 0 ? (retained / deposit) * 100 : 0,
      reasons,
    };
  }, [actualDate, additionalAmount, agreedEnd, damaged, deposit, item.id, payments, price]);

  const formValid = Boolean(actualDate)
    && (!damaged || damageDescription.trim().length > 0)
    && (settlement.repairCosts <= 0 || additionalReason.trim().length > 0);

  function buildSubmission(): ReturnSubmission {
    return {
      actualReturnDate: actualDate,
      adjustedRentalStart: agreedStart || null,
      adjustedRentalEnd: agreedEnd || null,
      adjustedPricePerDay: price,
      returnStatus: settlement.status,
      isDamaged: damaged,
      damageDescription: damageDescription.trim(),
      isLate: settlement.daysLate > 0,
      lateDescription: settlement.daysLate > 0 ? `${settlement.daysLate} Tag${settlement.daysLate === 1 ? '' : 'e'} verspätet` : '',
      depositDecision: settlement.decision,
      depositDeductionPercent: settlement.deductionPercent,
      depositRefundAmount: settlement.refund,
      depositDeductionReason: settlement.reasons,
      additionalChargeReason: additionalReason.trim(),
      additionalChargeAmount: settlement.repairCosts,
      additionalChargePaymentMethod: paymentMethod,
      returnNotes: notes.trim(),
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formValid) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setSaving(true);
    const saved = await onSubmit(item, buildSubmission(), files);
    setSaving(false);
    if (saved) onClose();
  }

  async function uploadFiles() {
    if (files.length === 0) return;
    setUploading(true);
    const uploaded = await onUpload(item, files);
    setUploading(false);
    if (uploaded) {
      setFiles([]);
      setInputKey((current) => current + 1);
    }
  }

  return (
    <Dialog
      description="Die Rückgabe wird positionsbezogen dokumentiert und anschließend festgeschrieben."
      footer={(
        <>
          <button className="button buttonSecondary" disabled={saving} onClick={onClose} type="button">Abbrechen</button>
          <button className={`button ${confirming ? 'buttonDanger' : ''}`} disabled={!formValid || saving} form="returnItemForm" type="submit">
            {saving ? 'Wird gespeichert …' : confirming ? 'Rückgabe endgültig festschreiben' : 'Rückgabe prüfen'}
          </button>
        </>
      )}
      onClose={onClose}
      open
      size="large"
      title="Rückgabe abwickeln"
    >
      <form className={styles.dialogForm} id="returnItemForm" onSubmit={submit}>
        <div className={styles.contextBox}>
          <strong>{item.title || `Position #${item.id}`}</strong>
          <span>Position #{item.id} · {agreedStart} bis {agreedEnd}</span>
        </div>

        <div className={styles.threeColumnForm}>
          <label className="field">
            <span className="fieldLabel">Rückgabedatum *</span>
            <input className="input" max={localIsoDate()} min={earliestReturnDate || undefined} onChange={(event) => { setActualDate(event.target.value); setConfirming(false); }} required type="date" value={actualDate} />
          </label>
          <label className="field">
            <span className="fieldLabel">Mietbeginn</span>
            <input className="input" disabled type="date" value={agreedStart} />
          </label>
          <label className="field">
            <span className="fieldLabel">Vereinbartes Mietende</span>
            <input className="input" disabled type="date" value={agreedEnd} />
          </label>
        </div>

        <div className={styles.checkGrid}>
          <label className={styles.checkboxCard}>
            <input checked={damaged} onChange={(event) => { setDamaged(event.target.checked); setConfirming(false); }} type="checkbox" />
            <span><strong>Artikel beschädigt</strong><small>Schäden und Zusatzkosten dokumentieren</small></span>
          </label>
          <div className={`${styles.checkboxCard} ${settlement.daysLate > 0 ? styles.checkboxCardActive : ''}`}>
            <Icon name="clock" />
            <span><strong>{settlement.daysLate > 0 ? 'Verspätet' : 'Pünktlich'}</strong><small>{settlement.daysLate} Tag{settlement.daysLate === 1 ? '' : 'e'} Verspätung</small></span>
          </div>
        </div>

        {damaged ? (
          <label className="field">
            <span className="fieldLabel">Schadensbeschreibung *</span>
            <textarea className="textarea" onChange={(event) => { setDamageDescription(event.target.value); setConfirming(false); }} placeholder="Festgestellten Schaden konkret dokumentieren" required value={damageDescription} />
          </label>
        ) : null}

        <div className={styles.twoColumnForm}>
          <label className="field">
            <span className="fieldLabel">Zusätzliche Reparaturkosten / Forderung</span>
            <input className="input" onChange={(event) => { setAdditionalReason(event.target.value); setConfirming(false); }} placeholder="z. B. Reinigung oder Ersatzteil" value={additionalReason} />
          </label>
          <label className="field">
            <span className="fieldLabel">Zusätzlicher Betrag</span>
            <input className="input" min="0" onChange={(event) => { setAdditionalAmount(event.target.value); setConfirming(false); }} step="0.01" type="number" value={additionalAmount} />
          </label>
        </div>
        {settlement.repairCosts > 0 && !additionalReason.trim() ? <p className="fieldError">Für eine Zusatzforderung ist eine Begründung erforderlich.</p> : null}

        {settlement.customerDue > 0 ? (
          <label className="field">
            <span className="fieldLabel">Nachzahlung begleichen über</span>
            <select className="select" onChange={(event) => { setPaymentMethod(event.target.value as 'online' | 'cash'); setConfirming(false); }} value={paymentMethod}>
              <option value="online">Mollie-Zahlungslink</option>
              <option value="cash">Barzahlung vor Ort</option>
            </select>
          </label>
        ) : null}

        <label className="field">
          <span className="fieldLabel">Interne Notiz</span>
          <textarea className="textarea" onChange={(event) => { setNotes(event.target.value); setConfirming(false); }} value={notes} />
        </label>

        <div className={styles.editorSection}>
          <div className={styles.sectionHeading}>
            <div><h3>Rückgabefotos</h3><p>Die Bilder sind ausschließlich für angemeldete Administratoren abrufbar.</p></div>
          </div>
          {(item.returnImages ?? []).length > 0 ? (
            <div className={styles.returnImageGrid}>
              {(item.returnImages ?? []).map((image) => (
                <article className={styles.returnImage} key={image.id}>
                  <a href={assetPath(image.imagePath)} rel="noopener noreferrer" target="_blank">
                    <Image alt={`Rückgabefoto ${image.id}`} fill sizes="180px" src={assetPath(image.imagePath)} unoptimized />
                  </a>
                  <button className="button buttonDanger" onClick={() => void onDeleteImage(image)} type="button"><Icon name="trash" size={16} /> Löschen</button>
                </article>
              ))}
            </div>
          ) : <p className="muted">Noch keine Rückgabefotos vorhanden.</p>}
          <input accept="image/jpeg,image/png,image/webp" className="input" key={inputKey} multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} type="file" />
          {files.length > 0 ? (
            <div className={styles.fileSelection}>
              <span>{files.length} Datei{files.length === 1 ? '' : 'en'} ausgewählt</span>
              <button className="button buttonSecondary" disabled={uploading} onClick={() => void uploadFiles()} type="button">{uploading ? 'Wird hochgeladen …' : 'Fotos jetzt hochladen'}</button>
            </div>
          ) : null}
        </div>

        <div className={styles.summaryPanel}>
          <h3>Rückgabevorschau</h3>
          <SummaryRow label="Rückgabestatus" value={returnStatusLabel(settlement.status)} />
          <SummaryRow label="Verspätungskosten" value={money(settlement.lateFee)} warning={settlement.lateFee > 0} />
          <SummaryRow label="Offene Mietverlängerung" value={money(settlement.openRentalAdjustment)} warning={settlement.openRentalAdjustment > 0} />
          <SummaryRow label="Ursprüngliche Kaution" value={money(deposit)} />
          <SummaryRow label="Kaution zurück" positive value={money(settlement.refund)} />
          <SummaryRow label="Kaution einbehalten" value={money(settlement.retained)} warning={settlement.retained > 0} />
          <SummaryRow label="Kautionsentscheidung" value={depositDecisionLabel(settlement.decision)} />
          <SummaryRow emphasis label="Kunde muss zusätzlich zahlen" value={money(settlement.customerDue)} warning={settlement.customerDue > 0} />
        </div>

        {confirming ? (
          <p className={styles.dangerCallout}><Icon name="info" /> Achtung: Die Rückgabe wird mit dem nächsten Klick festgeschrieben und kann danach nicht rückgängig gemacht werden.</p>
        ) : null}
      </form>
    </Dialog>
  );
}

function SummaryRow({
  label,
  value,
  emphasis = false,
  positive = false,
  warning = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  positive?: boolean;
  warning?: boolean;
}) {
  const className = [emphasis ? styles.summaryTotal : styles.summaryRow, positive ? styles.positiveText : '', warning ? styles.dangerText : ''].filter(Boolean).join(' ');
  return <div className={className}><span>{label}</span><strong>{value}</strong></div>;
}

function returnStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    returned_ok: 'Ordnungsgemäß zurückgegeben',
    returned_late: 'Verspätet zurückgegeben',
    returned_damaged: 'Beschädigt zurückgegeben',
    returned_late_damaged: 'Verspätet und beschädigt',
  };
  return labels[status] ?? status;
}
