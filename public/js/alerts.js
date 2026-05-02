function showAlert(message, type = 'info', timeout = 4000) {
    const container = document.getElementById('globalAlertContainer');

    if (!container) {
        console.warn('globalAlertContainer fehlt:', message);
        return;
    }

    const alertBox = document.createElement('div');

    alertBox.className = `alert alert-${type} alert-dismissible fade show shadow`;
    alertBox.role = 'alert';

    alertBox.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    container.appendChild(alertBox);

    if (timeout) {
        setTimeout(() => {
            alertBox.classList.remove('show');
            setTimeout(() => alertBox.remove(), 300);
        }, timeout);
    }
}