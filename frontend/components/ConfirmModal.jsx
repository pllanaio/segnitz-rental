import { useEffect, useRef, useState } from 'react';
import { registerConfirmHandler } from '../lib/alerts';
import { getModal, hideModal } from '../lib/bootstrap';

// Shared "Aktion bestätigen" dialog. showConfirm() resolves true only when the
// confirm button is pressed; closing the dialog any other way resolves false.
export default function ConfirmModal() {
    const modalRef = useRef(null);
    const pendingRef = useRef(null);
    const shownRef = useRef(false);
    const [content, setContent] = useState({
        title: 'Aktion bestätigen',
        message: 'Möchten Sie diese Aktion wirklich ausführen?'
    });

    useEffect(() => {
        const element = modalRef.current;
        const settle = value => {
            const pending = pendingRef.current;
            pendingRef.current = null;
            pending?.(value);
        };
        const onHidden = () => {
            shownRef.current = false;
            settle(false);
        };
        const onShow = () => { shownRef.current = false; };
        const onShown = () => { shownRef.current = true; };
        element.addEventListener('hidden.bs.modal', onHidden);
        element.addEventListener('show.bs.modal', onShow);
        element.addEventListener('shown.bs.modal', onShown);

        const unregister = registerConfirmHandler((message, title) => new Promise(resolve => {
            // A still-open question is answered with "no" before the next one is asked.
            settle(false);
            pendingRef.current = resolve;
            setContent({ title, message });
            getModal(element).show();
            window.setTimeout(() => {
                const backdrops = document.querySelectorAll('.modal-backdrop');
                const latestBackdrop = backdrops[backdrops.length - 1];
                if (latestBackdrop) latestBackdrop.style.zIndex = '3080';
                element.style.zIndex = '3090';
            }, 50);
        }));

        return () => {
            unregister();
            element.removeEventListener('hidden.bs.modal', onHidden);
            element.removeEventListener('show.bs.modal', onShow);
            element.removeEventListener('shown.bs.modal', onShown);
            settle(false);
        };
    }, []);

    const confirm = () => {
        const element = modalRef.current;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (shownRef.current) getModal(element).hide();
        else hideModal(element);
        pending?.(true);
    };

    return (
        <div className="modal fade" id="confirmModal" tabIndex={-1} aria-hidden="true" aria-labelledby="confirmModalTitle"
            aria-describedby="confirmModalBody" style={{ zIndex: 3090 }} ref={modalRef}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title" id="confirmModalTitle">{content.title}</h5>
                        <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="Schließen" />
                    </div>
                    <div className="modal-body" id="confirmModalBody">{content.message}</div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">Abbrechen</button>
                        <button type="button" className="btn btn-danger" id="confirmModalConfirmBtn" onClick={confirm}>Bestätigen</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
