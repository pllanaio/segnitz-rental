function showAlert(message, type = 'info', timeout = 4000) {
    const container = document.getElementById('globalAlertContainer');

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
            setTimeout(() => alertBox.remove(), 300);
        }, timeout);
    }
}
