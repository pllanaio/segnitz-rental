import { allowAddressChars, allowOnlyDigits } from '../../lib/shop';

const FIELDS = [
    { id: 'FirstName', label: 'Vorname', type: 'text', column: 'col-12 col-lg-6', required: true },
    { id: 'LastName', label: 'Nachname', type: 'text', column: 'col-12 col-lg-6', required: true },
    { id: 'CustomerCompany', label: 'Firma', type: 'text', column: 'col-12', required: false },
    { id: 'CustomerEmail', label: 'E-Mail', type: 'email', column: 'col-12 col-lg-6', required: true },
    { id: 'CustomerPhone', label: 'Telefon', type: 'tel', column: 'col-12 col-lg-6', required: true, filter: allowOnlyDigits },
    { id: 'CustomerAddress', label: 'Adresse', type: 'text', column: 'col-12', required: true, filter: allowAddressChars },
    { id: 'CustomerZip', label: 'PLZ', type: 'text', column: 'col-12 col-lg-4', required: true, filter: allowOnlyDigits },
    { id: 'CustomerCity', label: 'Ort', type: 'text', column: 'col-12 col-lg-8', required: true }
];

export default function CheckoutCustomerStep({ values, errors, fieldRefs, onChange }) {
    return (
        <div className="row g-3">
            {FIELDS.map(field => (
                <div className={field.column} key={field.id}>
                    <label className="form-label" htmlFor={field.id}>
                        {field.label}{field.required ? <> <span className="required-marker">*</span></> : null}
                    </label>
                    <input type={field.type} className={errors[field.id] ? 'form-control is-invalid' : 'form-control'}
                        id={field.id} name={field.id} value={values[field.id]}
                        aria-invalid={errors[field.id] ? 'true' : undefined}
                        ref={element => { fieldRefs.current[field.id] = element; }}
                        onChange={event => {
                            const value = field.filter ? field.filter(event.target.value) : event.target.value;
                            onChange(field.id, value);
                        }} />
                    {field.required
                        ? <div className="invalid-feedback" id={`${field.id}Feedback`}>{errors[field.id] || ''}</div>
                        : null}
                </div>
            ))}
        </div>
    );
}
