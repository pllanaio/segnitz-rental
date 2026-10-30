// Global toast-style alerts and the shared confirmation dialog. The messages are
// written as text nodes straight into #globalAlertContainer (rendered by
// <GlobalAlerts/>), so they also behave correctly if other scripts clear the
// container. Message text is never interpreted as HTML.
const FADE_DURATION_MS = 300;

export function showAlert(message, type = 'info', timeout = 4000) {
    const container = typeof document === 'undefined' ? null : document.getElementById('globalAlertContainer');

    if (!container) {
        console.warn('globalAlertContainer fehlt:', message);
        return;
    }

    const alertBox = document.createElement('div');
    alertBox.className = `alert alert-${type} alert-dismissible fade show shadow`;
    alertBox.role = 'alert';

    const messageNode = document.createElement('span');
    messageNode.textContent = String(message ?? '');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn-close';
    closeButton.dataset.bsDismiss = 'alert';
    closeButton.setAttribute('aria-label', 'Hinweis schließen');

    alertBox.appendChild(messageNode);
    alertBox.appendChild(closeButton);
    container.appendChild(alertBox);

    if (timeout) {
        setTimeout(() => {
            alertBox.classList.remove('show');
            setTimeout(() => alertBox.remove(), FADE_DURATION_MS);
        }, timeout);
    }
}

let confirmHandler = null;

export function registerConfirmHandler(handler) {
    confirmHandler = handler;
    return () => {
        if (confirmHandler === handler) confirmHandler = null;
    };
}

export function showConfirm(message, title = 'Aktion bestätigen') {
    if (!confirmHandler) return Promise.resolve(false);
    return confirmHandler(message, title);
}
