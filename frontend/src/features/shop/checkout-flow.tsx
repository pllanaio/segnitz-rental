'use client';

import { useCallback, useMemo, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { apiJson } from '@/lib/api/client';
import type { AuthStatus, CartItem, ProfileDto } from '@/lib/api/types';
import { formatCurrency, safeCheckoutUrl } from '@/lib/format';
import { CartContents, CostSummary, calculateCartTotals } from './cart-view';
import { SignaturePad } from './signature-pad';
import styles from './shop.module.css';

interface CustomerForm {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  zip: string;
  city: string;
}

interface CheckoutResponse {
  message?: string;
  orderId: number;
  orderNo: string;
  checkoutUrl?: string;
  paymentPending?: boolean;
  amountDue?: number | string;
  emailSent?: boolean;
}

interface MollieCheckoutResponse {
  checkoutUrl?: string;
  paymentPending?: boolean;
  alreadyPaid?: boolean;
  message?: string;
}

const emptyCustomer: CustomerForm = {
  firstName: '', lastName: '', company: '', email: '', phone: '', address: '', zip: '', city: '',
};

function profileToCustomer(profile: ProfileDto): CustomerForm {
  return {
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
    company: profile.company ?? '',
    email: profile.email ?? '',
    phone: profile.phone ?? '',
    address: profile.address ?? '',
    zip: profile.zip ?? '',
    city: profile.city ?? '',
  };
}

function validateCustomer(customer: CustomerForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!customer.firstName.trim()) errors.firstName = 'Bitte geben Sie Ihren Vornamen ein.';
  if (!customer.lastName.trim()) errors.lastName = 'Bitte geben Sie Ihren Nachnamen ein.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) errors.email = 'Bitte geben Sie eine gültige E-Mail-Adresse ein.';
  if (!/^\d{1,50}$/.test(customer.phone)) errors.phone = 'Die Telefonnummer darf nur Ziffern enthalten.';
  if (!/^[a-zA-Z0-9äöüÄÖÜß\s]+$/.test(customer.address.trim())) errors.address = 'Bitte verwenden Sie nur Buchstaben, Ziffern und Leerzeichen.';
  if (!/^\d{1,20}$/.test(customer.zip)) errors.zip = 'Die Postleitzahl darf nur Ziffern enthalten.';
  if (!customer.city.trim()) errors.city = 'Bitte geben Sie den Ort ein.';
  return errors;
}

function Stepper({ step }: { step: number }) {
  const labels = ['Produkte', 'Warenkorb', 'Ihre Daten', 'Abschluss'];
  return (
    <nav aria-label="Fortschritt der Bestellung" className={styles.stepper}>
      {labels.map((label, index) => {
        const number = index + 1;
        const active = number === step;
        const done = number < step;
        return (
          <div aria-current={active ? 'step' : undefined} className={`${styles.stepperItem} ${active ? styles.stepActive : ''} ${done ? styles.stepDone : ''}`} key={label}>
            <span>{done ? <Icon name="check" size={16} /> : number}</span><strong>{label}</strong>
          </div>
        );
      })}
    </nav>
  );
}

function TextField({ id, label, value, error, required = true, type = 'text', maxLength, inputMode, onChange }: {
  id: keyof CustomerForm;
  label: string;
  value: string;
  error?: string;
  required?: boolean;
  type?: string;
  maxLength?: number;
  inputMode?: 'numeric' | 'email' | 'tel' | 'text';
  onChange: (id: keyof CustomerForm, value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className={`input ${error ? 'inputError' : ''}`}
        id={id}
        inputMode={inputMode}
        maxLength={maxLength}
        name={id}
        onChange={(event) => onChange(id, event.target.value)}
        required={required}
        type={type}
        value={value}
      />
      {error ? <p className="fieldError" id={errorId}>{error}</p> : null}
    </div>
  );
}

export function CheckoutFlow({ items, auth, profile, onCartChanged, onBackToCatalog, notify }: {
  items: CartItem[];
  auth: AuthStatus | undefined;
  profile: ProfileDto | undefined;
  onCartChanged: () => Promise<void> | void;
  onBackToCatalog: () => void;
  notify: (message: string, tone?: 'success' | 'danger' | 'info' | 'warning') => void;
}) {
  const [step, setStep] = useState(2);
  const [customer, setCustomer] = useState<CustomerForm>(() => profile
    ? profileToCustomer(profile)
    : { ...emptyCustomer, email: auth?.user ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signature, setSignature] = useState('');
  const [agbs, setAgbs] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'cash'>('online');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CheckoutResponse | null>(null);
  const [retryingPayment, setRetryingPayment] = useState(false);
  const totals = useMemo(() => calculateCartTotals(items), [items]);
  const handleSignatureChange = useCallback((value: string) => setSignature(value), []);

  async function refreshCartAfterOrder() {
    try {
      await onCartChanged();
    } catch {
      notify('Die Bestellung wurde gespeichert, der Warenkorbstatus konnte aber nicht aktualisiert werden. Bitte laden Sie die Seite neu.', 'warning');
    }
  }

  function updateCustomer(id: keyof CustomerForm, value: string) {
    if (id === 'phone' || id === 'zip') value = value.replace(/\D/g, '');
    setCustomer((current) => ({ ...current, [id]: value }));
    setErrors((current) => ({ ...current, [id]: '' }));
  }

  function moveNext() {
    if (step === 2) {
      if (!items.length) {
        notify('Ihr Warenkorb ist leer.', 'warning');
        onBackToCatalog();
        return;
      }
      setStep(3);
      return;
    }
    if (step === 3) {
      const nextErrors = validateCustomer(customer);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) {
        notify('Bitte prüfen Sie die markierten Eingaben.', 'warning');
        return;
      }
      setStep(4);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function submit() {
    if (!signature) {
      notify('Bitte hinterlegen Sie Ihre Unterschrift.', 'warning');
      return;
    }
    if (!agbs || !privacy) {
      notify('Bitte bestätigen Sie die AGB und Datenschutzerklärung.', 'warning');
      return;
    }

    const customerElements = [
      ['FirstName', customer.firstName],
      ['LastName', customer.lastName],
      ['CustomerCompany', customer.company],
      ['CustomerEmail', customer.email],
      ['CustomerPhone', customer.phone],
      ['CustomerAddress', customer.address],
      ['CustomerZip', customer.zip],
      ['CustomerCity', customer.city],
    ].map(([name, value]) => ({ name, value }));
    const completionElements = [
      { name: 'Signature', value: signature },
      { name: 'agbs', value: 'on', checked: true },
      { name: 'dsgvo', value: 'on', checked: true },
      { name: 'paymentMethod', value: paymentMethod, checked: true },
      { name: 'email', value: customer.email },
    ];

    setSubmitting(true);
    try {
      const response = await apiJson<CheckoutResponse>('/data', 'POST', {
        form: [
          { step: 1, elements: [] },
          { step: 2, elements: [] },
          { step: 3, elements: customerElements },
          { step: 4, elements: completionElements },
        ],
        paymentMethod,
      });
      const checkoutUrl = safeCheckoutUrl(response.checkoutUrl);
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      setResult(response);
      await refreshCartAfterOrder();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Die Bestellung konnte nicht abgeschlossen werden.', 'danger',);
    } finally {
      setSubmitting(false);
    }
  }

  async function retryPayment() {
    if (!result?.orderId) return;
    setRetryingPayment(true);
    try {
      const response = await apiJson<MollieCheckoutResponse>(`/orders/${result.orderId}/mollie-checkout`, 'POST');
      const checkoutUrl = safeCheckoutUrl(response.checkoutUrl);
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
      } else if (response.alreadyPaid) {
        setResult((current) => current ? {
          ...current,
          message: response.message ?? 'Die Online-Zahlung ist bereits eingegangen.',
          paymentPending: false,
        } : current);
        await refreshCartAfterOrder();
        notify(response.message ?? 'Die Online-Zahlung ist bereits eingegangen.', 'success');
      } else {
        notify(response.message || 'Die Online-Zahlung wird noch vorbereitet. Bitte versuchen Sie es gleich erneut.', 'info');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Die Zahlungsseite konnte nicht geladen werden.', 'danger');
    } finally {
      setRetryingPayment(false);
    }
  }

  if (result) {
    return (
      <main className={styles.checkoutMain}>
        <div className={styles.completionCard}>
          <span className={styles.completionIcon}><Icon name={result.paymentPending ? 'clock' : 'check'} size={34} /></span>
          <p className={styles.eyebrow}>{result.paymentPending ? 'Zahlung wird vorbereitet' : 'Bestellung bestätigt'}</p>
          <h1>{result.paymentPending ? 'Nur noch ein Schritt' : 'Vielen Dank für Ihre Bestellung'}</h1>
          <p>{result.message || 'Wir haben Ihre Bestellung erhalten und senden Ihnen die Details per E-Mail.'}</p>
          <dl className={styles.orderFacts}>
            <div><dt>Bestellnummer</dt><dd>{result.orderNo}</dd></div>
            <div><dt>Zahlungsart</dt><dd>{paymentMethod === 'online' ? 'Online-Zahlung' : 'Bar bei Abholung'}</dd></div>
            {result.amountDue != null ? <div><dt>Fälliger Betrag</dt><dd>{formatCurrency(result.amountDue)}</dd></div> : null}
          </dl>
          <div className={styles.completionActions}>
            {result.paymentPending ? <button className="button" disabled={retryingPayment} onClick={retryPayment} type="button">{retryingPayment ? 'Wird geladen …' : 'Zur Online-Zahlung'}</button> : null}
            <button className="button buttonSecondary" onClick={onBackToCatalog} type="button">Zur Produktübersicht</button>
            {auth?.loggedIn ? <a className="button buttonSecondary" href="/profile.html">Bestellungen im Profil</a> : null}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.checkoutMain}>
      <Stepper step={step} />
      <section className={styles.checkoutCard}>
        {step === 2 ? (
          <>
            <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>Schritt 2 von 4</p><h1>Warenkorb prüfen</h1><p>Kontrollieren Sie Mietartikel und Zeiträume vor der Bestellung.</p></div></header>
            <div className={styles.checkoutGrid}>
              <CartContents items={items} notify={notify} onChanged={onCartChanged} />
              <CostSummary items={items} />
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>Schritt 3 von 4</p><h1>Persönliche Daten</h1><p>Diese Angaben verwenden wir für Mietvertrag und Bestätigung.</p></div>{auth?.loggedIn ? <span className={styles.accountHint}><Icon name="user" size={17} /> Angemeldet als {auth.user}</span> : null}</header>
            <form className={styles.customerForm} noValidate onSubmit={(event) => event.preventDefault()}>
              <TextField error={errors.firstName} id="firstName" label="Vorname" maxLength={100} onChange={updateCustomer} value={customer.firstName} />
              <TextField error={errors.lastName} id="lastName" label="Nachname" maxLength={100} onChange={updateCustomer} value={customer.lastName} />
              <div className={styles.fullField}><TextField id="company" label="Firma" maxLength={255} onChange={updateCustomer} required={false} value={customer.company} /></div>
              <TextField error={errors.email} id="email" inputMode="email" label="E-Mail" maxLength={254} onChange={updateCustomer} type="email" value={customer.email} />
              <TextField error={errors.phone} id="phone" inputMode="numeric" label="Telefon" maxLength={50} onChange={updateCustomer} type="tel" value={customer.phone} />
              <div className={styles.fullField}><TextField error={errors.address} id="address" label="Straße und Hausnummer" maxLength={255} onChange={updateCustomer} value={customer.address} /></div>
              <TextField error={errors.zip} id="zip" inputMode="numeric" label="PLZ" maxLength={20} onChange={updateCustomer} value={customer.zip} />
              <TextField error={errors.city} id="city" label="Ort" maxLength={100} onChange={updateCustomer} value={customer.city} />
            </form>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>Schritt 4 von 4</p><h1>Bestellung abschließen</h1><p>Unterschrift, Einwilligungen und Zahlungsart bestätigen.</p></div></header>
            <div className={styles.finalGrid}>
              <div>
                <div className={styles.confirmationCopy}>
                  <h2>Ihre verbindliche Reservierung</h2>
                  <p>Mit Ihrer Unterschrift bestätigen Sie die Richtigkeit Ihrer Daten, die ausgewählten Mietartikel und die vereinbarten Mietzeiträume.</p>
                </div>
                <SignaturePad onChange={handleSignatureChange} />
                <div className={styles.consentList}>
                  <label><input checked={agbs} name="agbs" onChange={(event) => setAgbs(event.target.checked)} type="checkbox" /> <span>Ich stimme den Allgemeinen Geschäftsbedingungen zu. *</span></label>
                  <label><input checked={privacy} name="dsgvo" onChange={(event) => setPrivacy(event.target.checked)} type="checkbox" /> <span>Ich stimme der Verarbeitung meiner Daten gemäß Datenschutzerklärung zu. *</span></label>
                </div>
                <fieldset className={styles.paymentMethods}>
                  <legend>Zahlungsart</legend>
                  <label className={paymentMethod === 'online' ? styles.paymentSelected : ''}>
                    <input checked={paymentMethod === 'online'} name="paymentMethod" onChange={() => setPaymentMethod('online')} type="radio" value="online" />
                    <span><strong>Online bezahlen</strong><small>Sicher über unseren Zahlungsanbieter</small></span>
                  </label>
                  <label className={paymentMethod === 'cash' ? styles.paymentSelected : ''}>
                    <input checked={paymentMethod === 'cash'} name="paymentMethod" onChange={() => setPaymentMethod('cash')} type="radio" value="cash" />
                    <span><strong>Bar bei Abholung</strong><small>Miete und Kaution vor Ort bezahlen</small></span>
                  </label>
                </fieldset>
              </div>
              <CostSummary items={items} />
            </div>
          </>
        ) : null}

        <footer className={styles.checkoutNav}>
          <button className="button buttonSecondary" onClick={() => {
            if (step === 2) onBackToCatalog(); else setStep((current) => current - 1);
          }} type="button"><Icon name="arrow-left" size={17} /> Zurück</button>
          {step < 4 ? <button className="button" onClick={moveNext} type="button">Weiter <Icon name="arrow-right" size={17} /></button> : <button className="button buttonAccent" disabled={submitting} onClick={submit} type="button">{submitting ? 'Bestellung wird angelegt …' : `Zahlungspflichtig bestellen · ${formatCurrency(totals.grandTotal)}`}</button>}
        </footer>
      </section>
    </main>
  );
}
