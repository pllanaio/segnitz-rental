import { useEffect, useRef, useState } from 'react';
import PageHead from '../components/PageHead';

const SUCCESS_TEXT = 'Ihr Widerruf ist eingegangen. Eine Eingangsbestätigung wird an die angegebene E-Mail-Adresse gesendet. Eine weitere Bestätigung Ihrerseits ist nicht erforderlich.';

function createSubmissionId() {
    return window.crypto.randomUUID();
}

export default function WithdrawalPage() {
    const confirmRef = useRef(null);
    const [view, setView] = useState('form');
    const [values, setValues] = useState({ name: '', email: '', reference: '', scope: '' });
    const [submission, setSubmission] = useState(null);
    const [receiptText, setReceiptText] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        // Strip any query or fragment so personal data never stays in the URL.
        window.history.replaceState(null, '', window.location.pathname);
    }, []);

    useEffect(() => {
        if (view === 'review') confirmRef.current?.focus();
    }, [view]);

    const update = field => event => setValues(current => ({ ...current, [field]: event.target.value }));

    const review = event => {
        event.preventDefault();
        setSubmission({
            id: createSubmissionId(),
            kind: 'withdrawal',
            name: values.name.trim(),
            email: values.email.trim(),
            contractReference: values.reference.trim(),
            scope: values.scope.trim()
        });
        setView('review');
    };

    const confirm = async () => {
        setBusy(true);
        setError('');
        try {
            const response = await fetch('/contract-declarations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(submission)
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Die Erklärung konnte nicht gespeichert werden. Bitte erneut versuchen.');
            }
            const receipt = result.receipt;
            setReceiptText(
                `Eingangsbestätigung des Widerrufs\n\n${receipt.declaration}\nName: ${receipt.name}\n` +
                `E-Mail: ${receipt.email}\nEingang (UTC): ${receipt.receivedAt}\nVorgang: ${receipt.id}`
            );
            setView('success');
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusy(false);
        }
    };

    const download = () => {
        const url = URL.createObjectURL(new Blob([receiptText], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `Segnitz-Rental-Eingangsbestätigung-${submission.id}.txt`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const declaration = submission
        ? `Hiermit widerrufe ich den Vertrag ${submission.contractReference}${submission.scope ? ` hinsichtlich: ${submission.scope}` : ' vollständig'}.`
        : '';

    return (
        <>
            <PageHead title="Widerruf – Segnitz Rental" referrer="no-referrer" />
            <header className="bg-primary text-white p-3">
                <a className="text-white" href="/index.html">Segnitz Rental · Zur Startseite</a>
            </header>
            <main className="container py-5">
                <div className="row justify-content-center">
                    <div className="col-lg-8">
                        <h1 id="declarationTitle">Vertrag widerrufen</h1>
                        <p id="declarationIntro">
                            Hier können Sie Ihre Widerrufserklärung ohne Anmeldung übermitteln. Eine Begründung ist nicht
                            erforderlich. Andere Möglichkeiten des Widerrufs, etwa per E-Mail, bleiben bestehen.
                        </p>
                        <div id="declarationError" className={error ? 'alert alert-danger' : 'alert alert-danger d-none'} role="alert">{error}</div>
                        <form id="declarationForm" className={view === 'form' ? undefined : 'd-none'} onSubmit={review}>
                            <div className="mb-3">
                                <label className="form-label" htmlFor="declarationName">Ihr Name</label>
                                <input id="declarationName" className="form-control" autoComplete="name" maxLength={200} required
                                    value={values.name} onChange={update('name')} />
                            </div>
                            <div className="mb-3">
                                <label className="form-label" htmlFor="declarationEmail">E-Mail für die Eingangsbestätigung</label>
                                <input id="declarationEmail" className="form-control" type="email" autoComplete="email" maxLength={255} required
                                    value={values.email} onChange={update('email')} />
                            </div>
                            <div className="mb-3">
                                <label className="form-label" htmlFor="declarationReference">Bestellnummer oder eindeutige Vertragsbeschreibung</label>
                                <input id="declarationReference" className="form-control" maxLength={200} required
                                    value={values.reference} onChange={update('reference')} />
                                <div className="form-text">Die Bestellnummer finden Sie in Ihrer Bestätigung.</div>
                            </div>
                            <div id="declarationScopeGroup" className="mb-3">
                                <label className="form-label" htmlFor="declarationScope">Nur einen Teil widerrufen? (optional)</label>
                                <textarea id="declarationScope" className="form-control" maxLength={2000} rows={3}
                                    placeholder="Betroffene Artikel oder Vertragsbestandteile"
                                    value={values.scope} onChange={update('scope')} />
                                <div className="form-text">Leer lassen, wenn Sie den gesamten Vertrag widerrufen.</div>
                            </div>
                            <button className="btn btn-primary" type="submit">Angaben prüfen</button>
                        </form>
                        <section id="declarationReview" className={view === 'review' ? undefined : 'd-none'} aria-labelledby="reviewTitle">
                            <h2 id="reviewTitle">Ihre Erklärung prüfen</h2>
                            <p id="reviewDeclaration" className="fw-bold">{declaration}</p>
                            <dl id="reviewDetails">
                                {submission ? [['Name', submission.name], ['E-Mail', submission.email], ['Vertrag', submission.contractReference]]
                                    .map(([label, value]) => (
                                        <ReviewDetail key={label} label={label} value={value} />
                                    )) : null}
                            </dl>
                            <button type="button" id="declarationEdit" className="btn btn-outline-primary" disabled={busy}
                                onClick={() => setView('form')}>Angaben ändern</button>{' '}
                            <button type="button" id="declarationConfirm" className="btn btn-primary" ref={confirmRef} disabled={busy}
                                onClick={confirm}>Widerruf bestätigen</button>
                        </section>
                        <section id="declarationSuccess" className={view === 'success' ? undefined : 'd-none'} aria-live="polite">
                            <h2 id="declarationSuccessTitle">Ihre Erklärung ist eingegangen</h2>
                            <p id="declarationSuccessText">{view === 'success' ? SUCCESS_TEXT : ''}</p>
                            <pre id="declarationReceipt" className="text-wrap border rounded p-3">{receiptText}</pre>
                            <button type="button" id="declarationDownload" className="btn btn-outline-primary" onClick={download}>
                                Eingangsbestätigung speichern
                            </button>
                        </section>
                    </div>
                </div>
            </main>
        </>
    );
}

function ReviewDetail({ label, value }) {
    return (
        <>
            <dt>{label}</dt>
            <dd>{value}</dd>
        </>
    );
}
