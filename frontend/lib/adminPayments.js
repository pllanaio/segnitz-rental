// Admin payment and refund actions of an order ("Zahlungen & Erstattungen").
// buildOrderPaymentActions() returns plain descriptors; components/admin/PaymentActions.jsx
// renders them and the order sheet assigns them to their payment rows.
import { getSafeCheckoutUrl } from './orders.js';

export function formatPaymentType(type) {
    const labels = {
        invoice_payment: 'Mietrechnung',
        initial_payment: 'Initialzahlung',
        rental: 'Miete',
        deposit: 'Kaution',
        rental_adjustment: 'Nachzahlung Mietzeitraum',
        return_additional_charge: 'Nachzahlung Rückgabe',
        rental_refund: 'Mieterstattung',
        deposit_refund: 'Kautionsrückerstattung',
        order_cancellation_refund: 'Storno-Rückerstattung',
        duplicate_payment_refund: 'Erstattung einer Doppelzahlung',
        refund_record: 'Erstattung über Mollie',
        chargeback: 'Rückbelastung (Chargeback)'
    };

    return labels[type] || type || '-';
}

const OPEN_ADDITIONAL_STATUSES = ['pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'];

function posButton(order, posTargets, paymentType, orderItemId, className = 'btn btn-outline-primary btn-sm') {
    const key = `${paymentType}:${orderItemId || ''}`;
    const payment = posTargets.get(key);
    if (!payment) return null;
    posTargets.delete(key);
    const active = payment.posTerminalId && ['pending', 'open', 'authorized'].includes(payment.paymentStatus);
    return {
        kind: 'pos',
        className,
        orderId: order.id,
        posItem: orderItemId || '',
        posType: paymentType,
        posRecord: active ? payment.id : '',
        label: active ? 'Zahlung prüfen' : 'Kartenzahlung vor Ort'
    };
}

function matchersFor(buttons) {
    return buttons.filter(Boolean).flatMap(button => {
        if (button.kind === 'manual-payment' || button.kind === 'manual-refund') {
            return [{ type: button.paymentType, item: button.itemId ?? '' }];
        }
        if (button.kind === 'pos') return [{ type: button.posType, item: button.posItem ?? '' }];
        if (button.kind === 'retry-refund') return [{ paymentId: String(button.paymentId) }];
        return [];
    });
}

function action(key, title, subtitle, amount, buttons, layout = 'standard') {
    const list = buttons.filter(Boolean);
    return { key, title, subtitle, amount, buttons: list, layout, matchers: matchersFor(list) };
}

export function buildOrderPaymentActions(order) {
    const latestPayments = new Map();
    for (const payment of [...(order.payments || [])].sort((a, b) => Number(a.id) - Number(b.id))) {
        latestPayments.set(payment.paymentType + ':' + (payment.orderItemId || ''), payment);
    }
    const payments = (order.payments || []).filter(payment =>
        !['initial_payment', 'rental', 'deposit', 'rental_adjustment', 'return_additional_charge'].includes(payment.paymentType) ||
        latestPayments.get(payment.paymentType + ':' + (payment.orderItemId || '')) === payment);
    const hasOriginalCashPayment = refund => {
        const sourceTypes = refund.paymentType === 'deposit_refund'
            ? (payments.some(p => p.paymentType === 'deposit' && p.paymentStatus === 'paid') ? ['deposit'] : ['initial_payment'])
            : (order.payment_method === 'invoice' ? ['initial_payment', 'deposit', 'rental_adjustment'] : ['initial_payment', 'rental_adjustment']);
        const sources = (order.payments || []).filter(source =>
            sourceTypes.includes(source.paymentType) && source.paymentStatus === 'paid' &&
            Number(source.amount) > 0 &&
            (!refund.orderItemId || !source.orderItemId || Number(source.orderItemId) === Number(refund.orderItemId)));
        if (refund.paymentType === 'deposit_refund' && sources.some(source =>
            source.paymentMethod === 'online' || source.molliePaymentId)) return false;
        return sources.filter(source => source.paymentMethod === 'cash' && !source.molliePaymentId)
            .reduce((sum, source) => sum + Number(source.amount), 0) + 0.001 >= Math.abs(Number(refund.amount));
    };
    const orderStatus = String(order.status || '').toLowerCase();
    const paymentStatus = String(order.payment_status || '').toLowerCase();
    const actions = [];
    const orderIsClosed = ['cancelled', 'expired'].includes(orderStatus);

    const latestInitialPayment = payments.filter(payment => payment.paymentType === 'initial_payment')
        .sort((a, b) => Number(b.id) - Number(a.id))[0];
    const failedInitialPos = latestInitialPayment?.posTerminalId && latestInitialPayment.molliePaymentId &&
        ['failed', 'cancelled', 'expired'].includes(latestInitialPayment.paymentStatus) ? latestInitialPayment : null;
    const openInitialPayments = payments.filter(payment =>
        order.payment_method !== 'invoice' && ['rental', 'deposit'].includes(payment.paymentType) &&
        ((payment.paymentMethod === 'cash' && ['pending', 'open'].includes(payment.paymentStatus)) ||
            (failedInitialPos && payment.molliePaymentId === failedInitialPos.molliePaymentId &&
                ['failed', 'cancelled', 'expired'].includes(payment.paymentStatus))) &&
        !payment.orderItemId);

    const initialAmount = openInitialPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const initialPaid = paymentStatus === 'paid' || payments.some(payment =>
        payment.paymentType === 'initial_payment' && payment.paymentMethod === 'cash' && payment.paymentStatus === 'paid');

    const posTargets = new Map();
    if (!orderIsClosed && initialAmount > 0 && !initialPaid) posTargets.set('initial_payment:', { paymentType: 'initial_payment', orderItemId: null });
    payments.filter(payment => ['initial_payment', 'rental_adjustment', 'return_additional_charge'].includes(payment.paymentType))
        .sort((a, b) => Number(a.id) - Number(b.id)).forEach(payment => {
            if ((payment.paymentMethod === 'cash' || payment.paymentMethod === 'online') && !orderIsClosed &&
                ['pending', 'open', 'failed', 'cancelled', 'expired', 'authorized'].includes(payment.paymentStatus)) {
                posTargets.set(`${payment.paymentType}:${payment.orderItemId || ''}`, payment);
            } else posTargets.delete(`${payment.paymentType}:${payment.orderItemId || ''}`);
        });
    if (!orderIsClosed && initialAmount > 0 && !initialPaid && !posTargets.has('initial_payment:')) {
        posTargets.set('initial_payment:', { paymentType: 'initial_payment', orderItemId: null });
    }

    if (!orderIsClosed && initialAmount > 0 && !initialPaid) {
        actions.push(action('initial', 'Miete und Kaution',
            'Miete und Kaution gemeinsam bezahlen oder Kauf auf Rechnung vereinbaren.', initialAmount, [
                { kind: 'manual-payment', className: 'btn btn-success btn-sm', orderId: order.id, itemId: '', paymentType: 'initial_payment', amount: initialAmount, label: 'Barzahlung erfassen' },
                posButton(order, posTargets, 'initial_payment', null),
                { kind: 'transfer', className: 'btn btn-outline-primary btn-sm', orderId: order.id, label: 'Kauf auf Rechnung · 14 Tage' }
            ]));
    }

    const additional = (paymentType, title, subtitle) => payments
        .filter(payment => !orderIsClosed && payment.paymentType === paymentType &&
            ['cash', 'online'].includes(payment.paymentMethod) && OPEN_ADDITIONAL_STATUSES.includes(payment.paymentStatus))
        .forEach(payment => {
            const checkoutUrl = payment.paymentMethod === 'online' && ['pending', 'open', 'authorized'].includes(payment.paymentStatus)
                ? getSafeCheckoutUrl(payment.checkoutUrl) : null;
            actions.push(action(`${paymentType}-${payment.id}`, title, subtitle, Number(payment.amount || 0), [
                checkoutUrl ? { kind: 'checkout-link', className: 'btn btn-outline-primary btn-sm', href: checkoutUrl, label: 'Zahlungslink öffnen' } : null,
                { kind: 'manual-payment', className: 'btn btn-success btn-sm', orderId: payment.orderId, itemId: payment.orderItemId || '', paymentType, amount: Number(payment.amount || 0), label: 'Barzahlung erfassen' },
                posButton(order, posTargets, paymentType, payment.orderItemId),
                { kind: 'additional-transfer', className: 'btn btn-outline-primary btn-sm', orderId: order.id, item: payment.orderItemId, type: paymentType, label: 'Überweisung · 14 Tage' }
            ]));
        });

    additional('rental_adjustment', 'Mietzeitraum-Verlängerung', 'Offene Nachzahlung aus einer Verlängerung.');
    additional('return_additional_charge', 'Rückgabe-Nachzahlung', 'Offene Nachzahlung aus verspäteter oder beschädigter Rückgabe.');

    payments.filter(payment =>
        payment.paymentType === 'deposit_refund' && payment.paymentMethod === 'cash' && order.payment_method !== 'online' &&
        hasOriginalCashPayment(payment) && ['pending', 'open'].includes(payment.paymentStatus))
        .forEach(payment => {
            const amount = Math.abs(Number(payment.amount || 0));
            actions.push(action(`deposit-refund-${payment.id}`, 'Kautionsrückerstattung', 'Kaution wurde zur Auszahlung vor Ort vorgemerkt.', amount, [
                { kind: 'manual-refund', className: 'btn btn-outline-danger btn-sm', orderId: payment.orderId, itemId: payment.orderItemId || '', paymentType: 'deposit_refund', amount, label: 'Kaution vor Ort erstatten' }
            ]));
        });

    payments.filter(payment =>
        ['rental_refund', 'order_cancellation_refund'].includes(payment.paymentType) && payment.paymentMethod === 'cash' &&
        hasOriginalCashPayment(payment) && ['pending', 'open'].includes(payment.paymentStatus))
        .forEach(payment => {
            const amount = Math.abs(Number(payment.amount || 0));
            actions.push(action(`cash-refund-${payment.id}`,
                payment.paymentType === 'rental_refund' ? 'Mieterstattung – vorzeitige Rückgabe' : 'Storno-Rückerstattung',
                'Der bereits kassierte Betrag ist vor Ort zurückzuzahlen.', amount, [
                    { kind: 'manual-refund', className: 'btn btn-outline-danger btn-sm', orderId: payment.orderId, itemId: payment.orderItemId || '', paymentType: payment.paymentType, amount, label: 'Erstattung in bar erfassen' }
                ]));
        });

    const retryableRefundTypes = new Set(['rental_refund', 'deposit_refund', 'order_cancellation_refund', 'duplicate_payment_refund']);
    const latestOnlineRefundByTarget = new Map();
    payments
        .filter(payment => retryableRefundTypes.has(payment.paymentType) && payment.paymentMethod === 'online')
        .sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
        .forEach(payment => {
            latestOnlineRefundByTarget.set([payment.paymentType, payment.orderItemId || 'order', payment.molliePaymentId || 'unknown'].join(':'), payment);
        });

    [...latestOnlineRefundByTarget.values()]
        .filter(payment => ['failed', 'cancelled'].includes(payment.paymentStatus))
        .forEach(payment => {
            actions.push(action(`retry-${payment.id}`, 'Online-Erstattung fehlgeschlagen',
                `${formatPaymentType(payment.paymentType)} muss erneut bei Mollie beauftragt werden.`, Math.abs(Number(payment.amount || 0)), [
                    { kind: 'retry-refund', className: 'btn btn-outline-warning btn-sm', paymentId: payment.id, orderId: order.id, label: 'Erstattung erneut versuchen' }
                ]));
        });

    posTargets.forEach((payment, key) => {
        const active = payment.posTerminalId && ['pending', 'open', 'authorized'].includes(payment.paymentStatus);
        actions.push(action(`pos-${key}`, `Kartenzahlung vor Ort · ${formatPaymentType(payment.paymentType)}`,
            active ? 'Zahlungsstatus bei Mollie prüfen.' : 'Betrag an ein freigegebenes Mollie-Tap-Gerät senden.', null, [{
                kind: 'pos',
                className: 'btn btn-primary btn-sm',
                orderId: order.id,
                posItem: payment.orderItemId || '',
                posType: payment.paymentType,
                posRecord: active ? payment.id : '',
                label: active ? 'Zahlung prüfen' : 'Kartenzahlung vor Ort'
            }], 'pos-only'));
    });

    return actions;
}

// Item actions of the order sheet (pickup, extension, cancellation, return).
export function buildItemActions(order) {
    const items = order.items || [];
    const orderStatus = String(order.status || '').trim().toLowerCase();
    const orderPaymentIsPaid = order.pickupAllowed === true || String(order.payment_status || '').toLowerCase() === 'paid';
    const isExpired = orderStatus === 'expired';

    return items.flatMap(item => {
        const state = item.itemStatus || item.item_status || 'active';
        const isCancelled = state === 'cancelled';
        const isReturned = String(state).startsWith('returned_');
        const suffix = items.length > 1 ? ` · ${item.title}` : '';
        const buttons = [];

        if (state === 'active') {
            const canPickUp = !isExpired && orderPaymentIsPaid && order.handoverStatus === 'signed';
            buttons.push({
                action: 'mark-item-picked-up', className: 'btn btn-outline-success btn-sm order-sheet-pickup', disabled: !canPickUp,
                title: canPickUp ? undefined : 'Erst nach festgeschriebenem Übergabeprotokoll und erfüllter Zahlungsbedingung möglich.',
                label: 'Als abgeholt markieren' + suffix
            });
        }
        if (state === 'picked_up') {
            buttons.push({
                action: 'open-rental-period', className: 'btn btn-outline-primary btn-sm',
                disabled: !(!isExpired && orderPaymentIsPaid), label: 'Mietzeitraum verlängern' + suffix
            });
        }
        if (state === 'active' && items.length > 1) {
            const canCancelItem = !isExpired && !(String(order.payment_method || '').toLowerCase() === 'online' && !orderPaymentIsPaid);
            buttons.push({
                action: 'open-cancel-item', className: 'btn btn-outline-danger btn-sm', disabled: !canCancelItem,
                label: 'Artikel stornieren' + suffix
            });
        }
        if (state === 'picked_up') {
            const canReturn = !isCancelled && !isReturned && !isExpired;
            buttons.push({ action: 'open-return-item', className: 'btn btn-success btn-sm', disabled: !canReturn, label: 'Rückgabe' + suffix });
        }

        return buttons.map(button => ({ ...button, orderId: order.id, itemId: item.id, key: `${button.action}-${item.id}` }));
    });
}

export function canCancelOrder(order) {
    const status = String(order.status || '').trim().toLowerCase();
    if (['cancelled', 'returned', 'expired', 'picked_up'].includes(status)) return false;
    return !(order.items || []).some(item => {
        const itemStatus = item.itemStatus || item.item_status;
        return itemStatus === 'picked_up' || item.pickedUpAt || item.picked_up_at;
    });
}
