'use strict';
let managedCoupons = [];
let editedCoupon = null;
async function loadCoupons() {
    const list = document.getElementById('couponList');
    list.textContent = 'Gutscheine werden geladen …';
    try {
        const response = await fetch('/admin/coupons');
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        managedCoupons = result.items;
        list.innerHTML = managedCoupons.length ? managedCoupons.map(coupon => `<article class="card mb-3"><div class="card-body d-flex flex-wrap justify-content-between gap-3 align-items-center"><div><h3 class="h5">${escapeHtml(coupon.code)} · ${Number(coupon.percent).toLocaleString('de-DE')} %</h3><span class="badge ${coupon.active ? 'bg-success' : 'bg-secondary'}">${coupon.active ? 'Aktiviert' : 'Deaktiviert'}</span><p class="mb-0 mt-2">${coupon.validFrom ? `Ab ${escapeHtml(coupon.validFrom)}` : 'Ab sofort'} · ${coupon.validUntil ? `Bis einschließlich ${escapeHtml(coupon.validUntil)}` : 'Unbegrenzt gültig'}</p></div><button type="button" class="btn btn-outline-primary" data-edit-coupon="${coupon.id}">Bearbeiten</button></div></article>`).join('') : '<p>Noch keine Gutscheincodes angelegt.</p>';
    } catch (error) { list.textContent = error.message; }
}
function resetCouponEditor() {
    editedCoupon = null; document.getElementById('couponForm').reset(); document.getElementById('couponActive').checked = true;
    document.getElementById('couponEditorTitle').textContent = 'Gutscheincode anlegen';
}
document.getElementById('couponReset').addEventListener('click', resetCouponEditor);
document.getElementById('couponList').addEventListener('click', event => {
    const button = event.target.closest('[data-edit-coupon]'); if (!button) return;
    editedCoupon = managedCoupons.find(c => c.id === Number(button.dataset.editCoupon)); if (!editedCoupon) return;
    for (const [id, value] of Object.entries({ couponCode: editedCoupon.code, couponPercent: editedCoupon.percent, couponFrom: editedCoupon.validFrom || '', couponUntil: editedCoupon.validUntil || '' })) document.getElementById(id).value = value;
    document.getElementById('couponActive').checked = Boolean(editedCoupon.active);
    document.getElementById('couponEditorTitle').textContent = 'Gutscheincode bearbeiten'; document.getElementById('couponForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('couponForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = document.getElementById('couponSave'); button.disabled = true;
    try {
        const body = { code: document.getElementById('couponCode').value, percent: Number(document.getElementById('couponPercent').value), validFrom: document.getElementById('couponFrom').value || null, validUntil: document.getElementById('couponUntil').value || null, active: document.getElementById('couponActive').checked, revision: editedCoupon?.revision };
        const response = await fetch(editedCoupon ? `/admin/coupons/${editedCoupon.id}` : '/admin/coupons', { method: editedCoupon ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        resetCouponEditor(); await loadCoupons(); showAlert('Gutscheincode gespeichert.', 'success');
    } catch (error) { showAlert(error.message, 'danger'); } finally { button.disabled = false; }
});
