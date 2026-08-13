'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'segnitz_rental.js'),
    'utf8'
);
const frontendSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'frontend_config.js'),
    'utf8'
);

function routeSource(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);

    assert.notEqual(start, -1, `${startMarker} fehlt`);
    assert.notEqual(end, -1, `${endMarker} fehlt`);
    return source.slice(start, end);
}

test('hält GET payment-status strikt lesend und ownership-geschützt', () => {
    const getRoute = routeSource(
        "app.get('/orders/:id/payment-status'",
        "app.post('/orders/:id/payment-status/sync'"
    );

    assert.match(getRoute, /mayAccessOrder\(req, order\)/);
    assert.doesNotMatch(getRoute, /getMolliePayment|createMollieRefund|cancelMolliePayment/);
    assert.doesNotMatch(getRoute, /\b(?:UPDATE|INSERT|DELETE)\s+(?:rental_|mollie_)/i);
    assert.doesNotMatch(getRoute, /beginTransaction|\.commit\(|\.rollback\(/);
});

test('führt Payment-Synchronisierung nur über den schreibenden Owner-Endpunkt aus', () => {
    const syncRoute = routeSource(
        "app.post('/orders/:id/payment-status/sync'",
        "app.post('/admin/order-payments/manual'"
    );

    assert.match(syncRoute, /mayAccessOrder\(req, orders\[0\]\)/);
    assert.match(syncRoute, /getMolliePayment/);
    assert.match(syncRoute, /beginTransaction/);
    assert.match(syncRoute, /\.commit\(/);
});

test('behandelt vorgemerkte Online-Zahlungen nicht als Barzahlungs-Erfolg', () => {
    const pendingBranch = frontendSource.indexOf('if (paymentPending)');
    const cashConfirmation = frontendSource.indexOf("resultTitle.textContent = 'Barzahlungs-Miete bestätigt'");

    assert.notEqual(pendingBranch, -1, 'paymentPending-Zweig fehlt im Checkout-Frontend');
    assert.notEqual(cashConfirmation, -1, 'Barzahlungs-Bestätigung fehlt');
    assert.ok(pendingBranch < cashConfirmation, 'paymentPending muss vor der Barzahlungsansicht verzweigen');
    assert.match(frontendSource, /result\.paymentPending \|\| !result\.checkoutUrl/);
    assert.match(frontendSource, /data-frontend-action="retry-payment"/);
});

test('lädt Mollie-Status für die Rückgabe vor der Datenbanktransaktion und revalidiert unter Locks', () => {
    const returnRoute = routeSource(
        "app.put('/admin/order-items/:itemId/return'",
        "app.delete('/admin/return-images/:id'"
    );
    const providerReadPosition = returnRoute.indexOf('getMolliePayment(paymentId)');
    const transactionPosition = returnRoute.indexOf('await connection.beginTransaction();');

    assert.notEqual(providerReadPosition, -1, 'Mollie-Prefetch der offenen Nachzahlungen fehlt');
    assert.notEqual(transactionPosition, -1, 'Rückgabetransaktion fehlt');
    assert.ok(
        providerReadPosition < transactionPosition,
        'Provider-Read darf nicht innerhalb der Rückgabetransaktion erfolgen'
    );
    assert.equal(
        returnRoute.lastIndexOf('getMolliePayment('),
        providerReadPosition,
        'Rückgabe darf nach Transaktionsbeginn keinen weiteren Mollie-Read ausführen'
    );
    assert.match(returnRoute, /paymentConcurrencySnapshotListsMatch\(adjustmentSnapshotRows, openAdjustmentRows\)/);
    assert.match(returnRoute, /ORDER BY id\s+FOR UPDATE/u);
    assert.match(returnRoute, /res\.status\(409\)/);
    assert.match(returnRoute, /res\.status\(503\)/);
});

test('lädt Mollie-Status vor manueller Bar-Ersetzung und revalidiert Zahlung unter Lock', () => {
    const manualRoute = routeSource(
        "app.post('/admin/order-payments/manual'",
        "app.post('/admin/order-payments/:id/retry-refund'"
    );
    const providerReadPosition = manualRoute.indexOf('getMolliePayment(');
    const transactionPosition = manualRoute.indexOf('await connection.beginTransaction();');

    assert.notEqual(providerReadPosition, -1, 'Mollie-Prefetch der Online-Nachzahlung fehlt');
    assert.notEqual(transactionPosition, -1, 'Transaktion für manuelle Zahlung fehlt');
    assert.ok(
        providerReadPosition < transactionPosition,
        'Provider-Read darf nicht innerhalb der Barzahlungs-Transaktion erfolgen'
    );
    assert.equal(
        manualRoute.lastIndexOf('getMolliePayment('),
        providerReadPosition,
        'Manuelle Zahlung darf nach Transaktionsbeginn keinen weiteren Mollie-Read ausführen'
    );
    assert.match(
        manualRoute,
        /paymentConcurrencySnapshotsMatch\(additionalPaymentSnapshot, openPayments\[0\] \|\| null\)/
    );
    assert.match(manualRoute, /LIMIT 1\s+FOR UPDATE/u);
    assert.match(manualRoute, /enqueueMollieCancellationIntent/u);
    assert.match(manualRoute, /res\.status\(409\)/);
    assert.match(manualRoute, /res\.status\(503\)/);
});
