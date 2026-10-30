import { forwardRef, useImperativeHandle, useRef } from 'react';
import { getModal, hideModal } from '../../lib/bootstrap';

const ConfirmClearCartModal = forwardRef(function ConfirmClearCartModal({ onConfirm }, ref) {
    const modalRef = useRef(null);

    useImperativeHandle(ref, () => ({
        show: () => getModal(modalRef.current, { backdrop: false }).show(),
        hide: () => hideModal(modalRef.current)
    }));

    return (
        <div className="modal fade" id="confirmClearCartModal" tabIndex={-1} style={{ zIndex: 1065 }} ref={modalRef}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title">Warenkorb leeren</h5>
                        <button type="button" className="btn-close" data-bs-dismiss="modal" />
                    </div>

                    <div className="modal-body">Möchten Sie den Warenkorb wirklich leeren?</div>

                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">Abbrechen</button>
                        <button type="button" className="btn btn-danger" id="confirmClearCartBtn" onClick={onConfirm}>Ja, leeren</button>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default ConfirmClearCartModal;
