import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { showAlert } from '../../lib/alerts';

const EMPTY = { code: '', percent: '', validFrom: '', validUntil: '', active: true };

const CouponsView = forwardRef(function CouponsView({ visible }, ref) {
    const formRef = useRef(null);
    const [coupons, setCoupons] = useState({ status: 'idle', items: [], error: '' });
    const [form, setForm] = useState(EMPTY);
    const [edited, setEdited] = useState(null);
    const [saving, setSaving] = useState(false);

    const loadCoupons = async () => {
        setCoupons(current => ({ ...current, status: 'loading' }));
        try {
            const response = await fetch('/admin/coupons');
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            setCoupons({ status: 'loaded', items: result.items, error: '' });
        } catch (error) {
            setCoupons({ status: 'error', items: [], error: error.message });
        }
    };

    useImperativeHandle(ref, () => ({ load: loadCoupons }));

    const reset = () => {
        setEdited(null);
        setForm(EMPTY);
    };

    const edit = coupon => {
        setEdited(coupon);
        setForm({ code: coupon.code, percent: coupon.percent, validFrom: coupon.validFrom || '', validUntil: coupon.validUntil || '', active: Boolean(coupon.active) });
        formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const save = async event => {
        event.preventDefault();
        setSaving(true);
        try {
            const body = {
                code: form.code,
                percent: Number(form.percent),
                validFrom: form.validFrom || null,
                validUntil: form.validUntil || null,
                active: form.active,
                revision: edited?.revision
            };
            const response = await fetch(edited ? `/admin/coupons/${edited.id}` : '/admin/coupons', {
                method: edited ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            reset();
            await loadCoupons();
            showAlert('Gutscheincode gespeichert.', 'success');
        } catch (error) {
            showAlert(error.message, 'danger');
        } finally {
            setSaving(false);
        }
    };

    const update = field => event => setForm(current => ({
        ...current,
        [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value
    }));

    let list = null;
    if (coupons.status === 'loading') list = 'Gutscheine werden geladen …';
    else if (coupons.status === 'error') list = coupons.error;
    else if (coupons.status === 'loaded') {
        list = coupons.items.length ? coupons.items.map(coupon => (
            <article className="card mb-3" key={coupon.id}>
                <div className="card-body d-flex flex-wrap justify-content-between gap-3 align-items-center">
                    <div>
                        <h3 className="h5">{coupon.code} · {Number(coupon.percent).toLocaleString('de-DE')} %</h3>
                        <span className={`badge ${coupon.active ? 'bg-success' : 'bg-secondary'}`}>{coupon.active ? 'Aktiviert' : 'Deaktiviert'}</span>
                        <p className="mb-0 mt-2">
                            {coupon.validFrom ? `Ab ${coupon.validFrom}` : 'Ab sofort'} · {coupon.validUntil ? `Bis einschließlich ${coupon.validUntil}` : 'Unbegrenzt gültig'}
                        </p>
                    </div>
                    <button type="button" className="btn btn-outline-primary" data-edit-coupon={coupon.id} onClick={() => edit(coupon)}>Bearbeiten</button>
                </div>
            </article>
        )) : <p>Noch keine Gutscheincodes angelegt.</p>;
    }

    return (
        <section id="couponsView" className={visible ? undefined : 'd-none'}>
            <h2>Gutscheine &amp; Rabatte</h2>
            <p>Pro Bestellung kann ein Code auf die ursprüngliche Mietsumme angewendet werden. Kaution, spätere Verlängerungen und Zusatzforderungen bleiben unverändert.</p>
            <form id="couponForm" className="card p-4 mb-4" ref={formRef} onSubmit={save}>
                <h3 className="h5" id="couponEditorTitle">{edited ? 'Gutscheincode bearbeiten' : 'Gutscheincode anlegen'}</h3>
                <div className="row g-3">
                    <div className="col-md-6">
                        <label className="form-label" htmlFor="couponCode">Code</label>
                        <input className="form-control" id="couponCode" required minLength={3} maxLength={40}
                            pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,39}" placeholder="SOMMER10" value={form.code} onChange={update('code')} />
                    </div>
                    <div className="col-md-6">
                        <label className="form-label" htmlFor="couponPercent">Rabatt in Prozent</label>
                        <input className="form-control" id="couponPercent" type="number" min="0.01" max="100" step="0.01" required
                            value={form.percent} onChange={update('percent')} />
                    </div>
                    <div className="col-md-6">
                        <label className="form-label" htmlFor="couponFrom">Gültig ab (leer = sofort)</label>
                        <input className="form-control" id="couponFrom" type="date" value={form.validFrom} onChange={update('validFrom')} />
                    </div>
                    <div className="col-md-6">
                        <label className="form-label" htmlFor="couponUntil">Gültig bis einschließlich (leer = unbegrenzt)</label>
                        <input className="form-control" id="couponUntil" type="date" value={form.validUntil} onChange={update('validUntil')} />
                    </div>
                    <div className="col-12">
                        <label className="form-check">
                            <input className="form-check-input" type="checkbox" id="couponActive" checked={form.active} onChange={update('active')} />
                            <span className="form-check-label">Code aktiviert</span>
                        </label>
                    </div>
                    <div className="col-12 d-flex gap-2 flex-wrap">
                        <button type="submit" className="btn btn-primary" id="couponSave" disabled={saving}>Gutscheincode speichern</button>
                        <button type="button" className="btn btn-outline-secondary" id="couponReset" onClick={reset}>Neuer Code / Zurücksetzen</button>
                    </div>
                </div>
            </form>
            <div id="couponList" aria-live="polite">{list}</div>
        </section>
    );
});

export default CouponsView;
