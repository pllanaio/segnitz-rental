(function (root) {
    'use strict';
    const escape = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    const money = cents => Number.isSafeInteger(cents) ? `${(cents / 100).toFixed(2).replace('.', ',')} €` : 'nicht verfügbar';
    function render(summary, payments = []) {
        if (!summary || summary.version !== 1 || summary.currency !== 'EUR') {
            return '<div class="alert alert-warning" role="status">Finanzstatus nicht verfügbar. Bitte die Bestellung erneut laden.</div>';
        }
        const rows = [
            ['Miete offen inkl. MwSt.', 'rentalDueCents'],
            ['Kaution noch einzuzahlen', 'depositDueCents'],
            ['Kaution erhalten', 'depositReceivedCents'],
            ['Kaution derzeit gehalten', 'depositHeldCents'],
            ['Kaution verrechnet / einbehalten', 'depositRetainedCents'],
            ['Verrechnete Mietverlängerung', 'offsetCents'],
            ['Zusatzforderungen offen', 'additionalDueCents'],
            ['Erstattungsanspruch offen', 'refundDueCents'],
            ['Davon Erstattung fehlgeschlagen', 'refundFailedCents'],
            ['Bereits erstattet', 'refundedCents'],
            ['Rückbelastung in Klärung', 'disputedCents']
        ];
        const links = payments.filter(payment => ['rental_adjustment', 'return_additional_charge'].includes(payment.paymentType) && ['pending', 'open', 'authorized'].includes(payment.paymentStatus)).map(payment => {
            try {
                const url = new URL(payment.checkoutUrl);
                return url.protocol === 'https:' ? `<p><a class="btn btn-primary" href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">Nachzahlung online bezahlen</a></p>` : '';
            } catch { return ''; }
        }).join('');
        return `<div class="card mt-4 checkout-summary" data-finance-status="${escape(summary.status)}"><div class="card-body">
            <h5>Finanzübersicht</h5>${links}
            <p role="status">${escape(summary.statusLabel)}</p>
            ${rows.filter(([, key]) => Number.isSafeInteger(summary[key])).map(([label, key]) => `<div class="checkout-summary-row"><span>${label}</span><strong>${money(summary[key])}</strong></div>`).join('')}
            <div class="checkout-summary-total-row mt-3"><span>Noch zu zahlen</span><strong>${money(summary.customerDueCents)}</strong></div>
            <p class="small text-muted mt-2">Fällige Zahlungen, gehaltene Kaution und Erstattungen sind getrennte Vorgänge. Eine Erstattung gilt erst nach bestätigter Auszahlung als abgeschlossen.</p>
        </div></div>`;
    }
    const api = Object.freeze({ render, money });
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.OrderFinanceView = api;
})(typeof window === 'object' ? window : globalThis);
