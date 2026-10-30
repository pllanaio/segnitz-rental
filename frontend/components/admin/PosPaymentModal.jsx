import { useEffect, useRef, useState } from 'react';
import { getModal } from '../../lib/bootstrap';
import { posRequest } from './PosView';

const STATUS_LABELS = {
    paid: 'Zahlung von Mollie bestätigt.',
    failed: 'Zahlung fehlgeschlagen.',
    cancelled: 'Zahlung abgebrochen.',
    expired: 'Zahlung verfallen.',
    pending: 'Zahlung wird vorbereitet oder geprüft …',
    open: 'Zahlung wartet auf die Karte am Gerät …',
    authorized: 'Zahlung autorisiert; Abschluss wird geprüft …'
};

// Card payment on a Mollie Tap device. Opens from any [data-pos-order] button.
export default function PosPaymentModal({ onOrderSettled }) {
    const modalRef = useRef(null);
    const contextRef = useRef(null);
    const busyRef = useRef(false);
    const pollRef = useRef(null);
    const settledRef = useRef(onOrderSettled);
    settledRef.current = onOrderSettled;

    const [terminals, setTerminals] = useState([]);
    const [terminalId, setTerminalId] = useState('');
    const [terminalLocked, setTerminalLocked] = useState(false);
    const [status, setStatus] = useState('');
    const [simulationUrl, setSimulationUrl] = useState(null);
    const [startVisible, setStartVisible] = useState(true);
    const [startEnabled, setStartEnabled] = useState(false);
    const [checkVisible, setCheckVisible] = useState(false);

    const checkPosPayment = async () => {
        const context = contextRef.current;
        if (!context?.recordId || busyRef.current) return;
        window.clearTimeout(pollRef.current);
        busyRef.current = true;
        try {
            const result = await posRequest(`/admin/pos/payments/${context.recordId}/sync`, 'POST');
            if (contextRef.current !== context) return;
            if (result.terminalId) setTerminalId(result.terminalId);
            setStatus(result.message || STATUS_LABELS[result.status] || 'Zahlungsstatus wird geprüft …');
            if (result.simulationUrl) setSimulationUrl(result.simulationUrl);
            if (['paid', 'failed', 'cancelled', 'expired', 'refunded', 'charged_back'].includes(result.status)) {
                setSimulationUrl(null);
                const details = await posRequest(`/admin/orders/${context.orderId}`);
                await settledRef.current?.(details);
            } else {
                pollRef.current = window.setTimeout(checkPosPayment, 5000);
            }
        } catch (error) {
            if (contextRef.current === context) {
                setStatus('Status momentan nicht abrufbar. Bitte erneut prüfen; keine weitere Zahlung starten.');
            }
        } finally {
            busyRef.current = false;
        }
    };
    const checkRef = useRef(checkPosPayment);
    checkRef.current = checkPosPayment;

    useEffect(() => {
        const element = modalRef.current;
        const onClick = async event => {
            const button = event.target.closest('[data-pos-order]');
            if (!button || button.disabled || busyRef.current) return;
            window.clearTimeout(pollRef.current);
            const context = {
                orderId: Number(button.dataset.posOrder),
                orderItemId: button.dataset.posItem ? Number(button.dataset.posItem) : null,
                paymentType: button.dataset.posType,
                recordId: button.dataset.posRecord || null
            };
            contextRef.current = context;
            setTerminals([]);
            setTerminalId('');
            setTerminalLocked(false);
            setSimulationUrl(null);
            setStartVisible(!context.recordId);
            setStartEnabled(false);
            setCheckVisible(Boolean(context.recordId));
            setStatus('Zahlungsgeräte werden geladen …');
            getModal(element).show();
            try {
                const result = await posRequest('/admin/pos/terminals');
                if (contextRef.current !== context) return;
                const available = result.items.filter(item => item.enabled && item.status === 'active' && item.currency === 'EUR');
                setTerminals(available);
                setTerminalId(available[0]?.id || '');
                setStatus(available.length ? 'Gerät auswählen und Zahlung starten.' : 'Kein freigegebenes Gerät verfügbar.');
                setStartEnabled(available.length > 0);
                if (context.recordId) await checkRef.current();
            } catch (error) {
                setStatus(error.message);
            }
        };
        const onHidden = () => {
            window.clearTimeout(pollRef.current);
            contextRef.current = null;
        };
        document.addEventListener('click', onClick);
        element.addEventListener('hidden.bs.modal', onHidden);
        return () => {
            document.removeEventListener('click', onClick);
            element.removeEventListener('hidden.bs.modal', onHidden);
            window.clearTimeout(pollRef.current);
        };
    }, []);

    const start = async () => {
        const context = contextRef.current;
        if (busyRef.current || !context) return;
        busyRef.current = true;
        setStartEnabled(false);
        try {
            const result = await posRequest('/admin/pos/payments', 'POST', { ...context, terminalId });
            if (contextRef.current !== context) return;
            context.recordId = result.recordId;
            setTerminalId(result.terminalId);
            setStartVisible(false);
            setCheckVisible(true);
            setTerminalLocked(true);
            setStatus('Zahlung wurde angefordert. Bitte Mollie Tap auf dem gewählten Gerät öffnen.');
        } catch (error) {
            setStatus(error.message);
        } finally {
            busyRef.current = false;
            setStartEnabled(true);
        }
        if (contextRef.current === context && context.recordId) await checkRef.current();
    };

    return (
        <div className="modal fade" id="posPaymentModal" tabIndex={-1} aria-labelledby="posPaymentTitle" aria-hidden="true"
            style={{ zIndex: 3070 }} ref={modalRef}>
            <div className="modal-dialog">
                <div className="modal-content">
                    <div className="modal-header">
                        <h2 className="modal-title h5" id="posPaymentTitle">Kartenzahlung vor Ort</h2>
                        <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="Schließen" />
                    </div>
                    <div className="modal-body">
                        <label htmlFor="posPaymentTerminal" className="form-label">Tap-Gerät / Terminal</label>
                        <select id="posPaymentTerminal" className="form-select mb-3" value={terminalId} disabled={terminalLocked}
                            onChange={event => setTerminalId(event.target.value)}>
                            {terminals.map(terminal => (
                                <option key={terminal.id} value={terminal.id}>
                                    {`${terminal.label || terminal.description}${terminal.location ? ` · ${terminal.location}` : ''} (${terminal.id})`}
                                </option>
                            ))}
                        </select>
                        <p id="posPaymentStatus" role="status" aria-live="polite">{status}</p>
                        <a id="posSimulation" className={simulationUrl ? 'btn btn-outline-primary' : 'btn btn-outline-primary d-none'}
                            href={simulationUrl || undefined} target="_blank" rel="noopener noreferrer">Testzahlung bei Mollie simulieren</a>
                        <p className="small text-muted mt-3">Der Betrag wird aus der Bestellung übernommen. Schließen beendet nur dieses Fenster, nicht die Zahlung auf dem Gerät.</p>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">Schließen</button>
                        <button type="button" className={startVisible ? 'btn btn-primary' : 'btn btn-primary d-none'} id="posPaymentStart"
                            disabled={!startEnabled} onClick={start}>Zahlung starten</button>
                        <button type="button" className={checkVisible ? 'btn btn-outline-primary' : 'btn btn-outline-primary d-none'}
                            id="posPaymentCheck" onClick={() => checkRef.current()}>Status prüfen</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
