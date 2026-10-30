// Texts and decisions for the Mollie return page (index.html?payment=...).
export const PAYMENT_CONTEXTS = ['return', 'extension', 'return_charge'];

export const UNSUCCESSFUL_PAYMENTS = {
    failed: {
        title: 'Zahlung fehlgeschlagen',
        text: 'Mollie konnte Ihre Zahlung nicht abschließen. Die Zahlung wurde nicht als bezahlt bestätigt.'
    },
    cancelled: {
        title: 'Zahlung abgebrochen',
        text: 'Der Zahlungsvorgang bei Mollie wurde abgebrochen. Die Zahlung ist weiterhin offen.'
    },
    expired: {
        title: 'Zahlung verfallen',
        text: 'Die Zahlungsfrist bei Mollie ist abgelaufen. Dieser Zahlungslink ist nicht mehr gültig.'
    }
};

const SUCCESS_MESSAGES = {
    return: {
        title: 'Mietvorgang erfolgreich bezahlt',
        text: 'Vielen Dank! Ihre Zahlung wurde erfolgreich bestätigt.',
        body: 'Ihre Reservierung wurde erfolgreich bezahlt.'
    },
    extension: {
        title: 'Mietzeitraum erfolgreich verlängert',
        text: 'Die Nachzahlung für die Verlängerung wurde erfolgreich bestätigt.',
        body: 'Ihr verlängerter Mietzeitraum ist nun bezahlt.'
    },
    return_charge: {
        title: 'Nachzahlung erfolgreich bezahlt',
        text: 'Die Nachzahlung aus der Rückgabe wurde erfolgreich bestätigt.',
        body: 'Der Rückgabefall wurde bezahlt und kann abgeschlossen werden.'
    }
};

const STATUS_MESSAGES = {
    failed: UNSUCCESSFUL_PAYMENTS.failed.text,
    expired: UNSUCCESSFUL_PAYMENTS.expired.text,
    cancelled: UNSUCCESSFUL_PAYMENTS.cancelled.text,
    canceled: UNSUCCESSFUL_PAYMENTS.cancelled.text,
    authorized: 'Die Zahlung wurde autorisiert, aber noch nicht endgültig eingezogen.',
    refund_pending: 'Die Bestellung ist geschlossen; die Rückerstattung wird noch verarbeitet.',
    refunded: 'Die Zahlung wurde zurückerstattet. Die Bestellung bleibt geschlossen.',
    refund_failed: 'Die Rückerstattung konnte nicht abgeschlossen werden. Bitte kontaktieren Sie uns.',
    charged_back: 'Die Zahlung wurde zurückbelastet. Bitte kontaktieren Sie uns.',
    pending: 'Die Zahlung wurde noch nicht bestätigt.'
};

export const DEFINITIVE_STATUSES = ['failed', 'cancelled', 'canceled', 'expired', 'refunded', 'refund_pending', 'refund_failed', 'charged_back'];
export const VERIFICATION_DELAYS_MS = [0, 1000, 2000, 3000, 5000, 8000];

export function describePaymentError(paymentContext, rawStatus, order = {}) {
    const status = rawStatus === 'canceled' ? 'cancelled' : rawStatus;
    const message = STATUS_MESSAGES[status] || STATUS_MESSAGES.pending;
    const closedOrder = paymentContext === 'return' && ['cancelled', 'returned'].includes(order.status);
    const canRetryInitialPayment =
        paymentContext === 'return' && !closedOrder &&
        ['failed', 'expired', 'cancelled', 'canceled', 'pending'].includes(status);
    const isRefundStatus = ['refund_pending', 'refunded', 'refund_failed'].includes(status);
    const followUpText = isRefundStatus || closedOrder
        ? 'Für diese Bestellung ist keine weitere Zahlung erforderlich.'
        : paymentContext === 'return'
            ? 'Sie können die Online-Zahlung erneut starten, sofern die Mietartikel noch verfügbar sind.'
            : ['extension', 'return_charge'].includes(paymentContext)
                ? 'Bitte kontaktieren Sie Segnitz Rental für einen neuen Zahlungslink oder eine Zahlung vor Ort.'
                : '';

    return {
        status,
        title: UNSUCCESSFUL_PAYMENTS[status]?.title || 'Zahlung nicht abgeschlossen',
        message,
        followUpText,
        canRetryInitialPayment,
        alertClass: status === 'failed' ? 'alert-danger' : 'alert-warning'
    };
}

export function describePaymentSuccess(paymentContext, order) {
    const message = SUCCESS_MESSAGES[paymentContext] || SUCCESS_MESSAGES.return;
    let { title, text, body } = message;

    if (order.settled_by_offset) {
        title = 'Nachzahlung bereits mit Kaution verrechnet';

        if (order.duplicate_refund_status === 'paid') {
            text = 'Die zusätzliche Onlinezahlung wurde automatisch zurückerstattet.';
            body = 'Die Nachzahlung war bereits mit der Kaution verrechnet; die doppelte Onlinezahlung wurde erstattet.';
        } else if (order.duplicate_refund_status) {
            text = 'Die zusätzliche Onlinezahlung wird automatisch zurückerstattet.';
            body = 'Die Nachzahlung war bereits mit der Kaution verrechnet; die Rückerstattung der doppelten Onlinezahlung läuft.';
        } else {
            text = 'Die Nachzahlung wurde bereits bei der Rückgabe ausgeglichen.';
            body = 'Für diese Nachzahlung ist keine weitere Zahlung erforderlich.';
        }
    } else if (order.settled_by_cash) {
        title = 'Nachzahlung bereits vor Ort beglichen';

        if (order.duplicate_refund_status === 'paid') {
            text = 'Die zusätzliche Onlinezahlung wurde automatisch zurückerstattet.';
            body = 'Die Nachzahlung war bereits vor Ort beglichen; die doppelte Onlinezahlung wurde erstattet.';
        } else if (order.duplicate_refund_status) {
            text = 'Die zusätzliche Onlinezahlung wird automatisch zurückerstattet.';
            body = 'Die Nachzahlung war bereits vor Ort beglichen; die Rückerstattung der doppelten Onlinezahlung läuft.';
        } else {
            text = 'Die Nachzahlung wurde vor Ort erfasst; der Online-Link ist geschlossen.';
            body = 'Für diese Nachzahlung ist keine weitere Zahlung erforderlich.';
        }
    }

    return { title, text, body };
}

export const VERIFYING_TEXT = 'Wir gleichen Ihre Zahlung mit Mollie ab. Bitte zahlen Sie nicht erneut.';
export const NOT_CONFIRMED_TEXT = 'Die Prüfung dauert noch an. Dies bedeutet nicht, dass Ihre Zahlung fehlgeschlagen ist. Bitte zahlen Sie nicht erneut.';
