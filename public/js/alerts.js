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

function showConfirm(message, title = 'Aktion bestätigen') {
    return new Promise(resolve => {
        const modalElement = document.getElementById('confirmModal');
        const titleElement = document.getElementById('confirmModalTitle');
        const bodyElement = document.getElementById('confirmModalBody');
        const confirmBtn = document.getElementById('confirmModalConfirmBtn');

        if (!modalElement || !titleElement || !bodyElement || !confirmBtn) {
            resolve(false);
            return;
        }

        titleElement.textContent = title;
        bodyElement.textContent = message;

        const modal = new bootstrap.Modal(modalElement);

        const cleanup = () => {
            confirmBtn.removeEventListener('click', onConfirm);
            modalElement.removeEventListener('hidden.bs.modal', onCancel);
        };

        const onConfirm = () => {
            cleanup();
            modal.hide();
            resolve(true);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        confirmBtn.addEventListener('click', onConfirm);
        modalElement.addEventListener('hidden.bs.modal', onCancel, { once: true });

        modal.show();
        setTimeout(() => {
            const backdrops = document.querySelectorAll('.modal-backdrop');
            const latestBackdrop = backdrops[backdrops.length - 1];

            if (latestBackdrop) {
                latestBackdrop.style.zIndex = '3080';
            }

            modalElement.style.zIndex = '3090';
        }, 50);

    });
}
