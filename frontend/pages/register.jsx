import { useRef, useState } from 'react';
import PageHead from '../components/PageHead';
import GlobalAlerts from '../components/GlobalAlerts';
import Preloader from '../components/Preloader';
import { SidebarLegal, SidebarLogo } from '../components/SidebarBrand';

const REQUIRED_FIELD_IDS = [
    'firstName',
    'lastName',
    'email',
    'phone',
    'address',
    'zip',
    'city',
    'password',
    'passwordRepeat'
];

const EMPTY_FORM = {
    firstName: '',
    lastName: '',
    company: '',
    email: '',
    phone: '',
    address: '',
    zip: '',
    city: '',
    password: '',
    passwordRepeat: ''
};

const REQUIRED_MESSAGE = 'Dieses Pflichtfeld muss ausgefüllt werden.';

function RequiredMarker() {
    return <span className="required-marker">*</span>;
}

export default function RegisterPage() {
    const fieldRefs = useRef({});
    const [values, setValues] = useState(EMPTY_FORM);
    const [errors, setErrors] = useState({});
    const [message, setMessage] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const updateField = (fieldId, value) => {
        const nextValues = { ...values, [fieldId]: value };
        setValues(nextValues);

        if (!REQUIRED_FIELD_IDS.includes(fieldId)) return;

        setErrors(current => {
            const next = { ...current };
            if (value.trim()) delete next[fieldId];

            if (
                (fieldId === 'password' || fieldId === 'passwordRepeat') &&
                nextValues.password &&
                nextValues.passwordRepeat &&
                nextValues.password === nextValues.passwordRepeat
            ) {
                delete next.passwordRepeat;
            }

            return next;
        });
    };

    const validateRequiredFields = () => {
        const nextErrors = {};
        let firstInvalidField = null;

        REQUIRED_FIELD_IDS.forEach(fieldId => {
            if (!values[fieldId].trim()) {
                nextErrors[fieldId] = REQUIRED_MESSAGE;
                firstInvalidField = firstInvalidField || fieldId;
            }
        });

        if (values.password && values.passwordRepeat && values.password !== values.passwordRepeat) {
            nextErrors.passwordRepeat = 'Die Passwörter stimmen nicht überein.';
            firstInvalidField = firstInvalidField || 'passwordRepeat';
        }

        setErrors(nextErrors);
        if (firstInvalidField) fieldRefs.current[firstInvalidField]?.focus();

        return Object.keys(nextErrors).length === 0;
    };

    const submit = async event => {
        event.preventDefault();

        if (submitting) return;

        if (!validateRequiredFields()) {
            setMessage({ text: 'Bitte füllen Sie alle rot markierten Pflichtfelder aus.', type: 'danger' });
            return;
        }

        const data = {
            firstName: values.firstName.trim(),
            lastName: values.lastName.trim(),
            company: values.company.trim(),
            email: values.email.trim(),
            phone: values.phone.trim(),
            address: values.address.trim(),
            zip: values.zip.trim(),
            city: values.city.trim(),
            password: values.password
        };

        setSubmitting(true);

        try {
            const res = await fetch('/register-customer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await res.json().catch(() => ({}));

            if (!res.ok) {
                setMessage({ text: result.error || 'Fehler bei der Registrierung.', type: 'danger' });
                return;
            }

            setMessage({ text: 'Registrierung erfolgreich! Bitte E-Mail bestätigen.', type: 'success' });
            setValues(EMPTY_FORM);
            setErrors({});
        } catch (error) {
            console.error('Registrierung fehlgeschlagen:', error);
            setMessage({
                text: 'Die Registrierung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.',
                type: 'danger'
            });
        } finally {
            setSubmitting(false);
        }
    };

    const input = (fieldId, props = {}) => (
        <>
            <input className={`form-control${errors[fieldId] ? ' is-invalid' : ''}`} id={fieldId}
                ref={element => { fieldRefs.current[fieldId] = element; }}
                value={values[fieldId]} onChange={event => updateField(fieldId, event.target.value)}
                aria-invalid={errors[fieldId] ? 'true' : undefined} {...props} />
            {REQUIRED_FIELD_IDS.includes(fieldId)
                ? <div className="invalid-feedback" id={`${fieldId}Feedback`}>{errors[fieldId] || ''}</div>
                : null}
        </>
    );

    return (
        <>
            <PageHead title="Segnitz Rental - Registrierung" />
            <GlobalAlerts />

            <div className="container-fluid min-vh-100 p-0">
                <div className="row g-0 min-vh-100">
                    <aside className="col-12 col-md-3 col-xl-2 bg-primary text-white p-4">
                        <SidebarLogo />
                        <a href="/index.html">
                            <button type="button" className="btn btn-light w-100 mt-4">
                                <i className="bi bi-arrow-left-circle" /> Zurück zur Startseite
                            </button>
                        </a>
                        <a href="/login.html">
                            <button type="button" className="btn btn-outline-light w-100 mt-2">
                                <i className="bi bi-person-lock" /> Zum Login
                            </button>
                        </a>
                        <SidebarLegal />
                    </aside>

                    <main className="col-12 col-md-9 col-xl-10 p-4 p-lg-5">
                        <div id="qbox-container_form" className="w-100">
                            <div id="steps-container">
                                <div className="step d-block">
                                    <div className="mx-auto" style={{ maxWidth: 760 }}>
                                        <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-4">
                                            <div>
                                                <h4 className="mb-1">Konto erstellen</h4>
                                                <p className="text-muted mb-0">
                                                    Erstellen Sie Ihr Kundenkonto für schnellere
                                                    Bestellungen und Zugriff auf Ihre Mietvorgänge.
                                                </p>
                                            </div>
                                            <span className="badge bg-primary">
                                                <i className="bi bi-envelope-check" /> E-Mail bestätigen
                                            </span>
                                        </div>

                                        <div id="msg" className={message ? `alert alert-${message.type}` : 'alert d-none'}>
                                            {message?.text}
                                        </div>

                                        <div className="card">
                                            <div className="card-body p-4">
                                                <form id="registerForm" onSubmit={submit}>
                                                    <div className="row g-3">
                                                        <div className="col-12 col-lg-6">
                                                            <label className="form-label" htmlFor="firstName">Vorname <RequiredMarker /></label>
                                                            {input('firstName', { placeholder: 'Vorname', required: true })}
                                                        </div>
                                                        <div className="col-12 col-lg-6">
                                                            <label className="form-label" htmlFor="lastName">Nachname <RequiredMarker /></label>
                                                            {input('lastName', { placeholder: 'Nachname', required: true })}
                                                        </div>
                                                        <div className="col-12">
                                                            <label className="form-label" htmlFor="company">Firma</label>
                                                            {input('company', { placeholder: 'Firma', autoComplete: 'organization' })}
                                                        </div>
                                                        <div className="col-12 col-lg-6">
                                                            <label className="form-label" htmlFor="email">E-Mail <RequiredMarker /></label>
                                                            {input('email', { type: 'email', placeholder: 'name@beispiel.de', required: true })}
                                                        </div>
                                                        <div className="col-12 col-lg-6">
                                                            <label className="form-label" htmlFor="phone">Telefon <RequiredMarker /></label>
                                                            {input('phone', { placeholder: 'Telefon', required: true })}
                                                        </div>
                                                        <div className="col-12">
                                                            <label className="form-label" htmlFor="address">Adresse <RequiredMarker /></label>
                                                            {input('address', { placeholder: 'Adresse', required: true })}
                                                        </div>
                                                        <div className="col-12 col-lg-4">
                                                            <label className="form-label" htmlFor="zip">PLZ <RequiredMarker /></label>
                                                            {input('zip', { placeholder: 'PLZ', required: true })}
                                                        </div>
                                                        <div className="col-12 col-lg-8">
                                                            <label className="form-label" htmlFor="city">Ort <RequiredMarker /></label>
                                                            {input('city', { placeholder: 'Ort', required: true })}
                                                        </div>
                                                        <div className="col-12"><hr className="my-2" /></div>
                                                        <div className="col-12 col-lg-6">
                                                            <label className="form-label" htmlFor="password">Passwort <RequiredMarker /></label>
                                                            {input('password', { type: 'password', placeholder: 'Passwort', required: true })}
                                                        </div>
                                                        <div className="col-12 col-lg-6">
                                                            <label className="form-label" htmlFor="passwordRepeat">Passwort wiederholen <RequiredMarker /></label>
                                                            {input('passwordRepeat', { type: 'password', placeholder: 'Passwort wiederholen', required: true })}
                                                        </div>
                                                        <div className="col-12">
                                                            <button type="submit" id="registerSubmitButton" className="btn btn-success w-100 mt-2"
                                                                disabled={submitting}>
                                                                {submitting
                                                                    ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Registrierung läuft...</>
                                                                    : <><i className="bi bi-person-plus" /> Registrieren</>}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </form>
                                            </div>
                                        </div>

                                        <p className="text-center mt-3 mb-0">
                                            Bereits registriert? <a href="/login.html" className="link-primary">Zum Login</a>
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </main>
                </div>
            </div>

            <Preloader />
        </>
    );
}
