'use strict';

// Execute the actual small logging statements without booting DB/provider code.
// Fixtures are deliberate noncredentials; this child emits no real auth data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const observability = require('../../services/observability');
const source = fs.readFileSync(path.resolve(__dirname, '../../segnitz_rental.js'), 'utf8');
const cases = [
    ['auth.setup.completed', 'globales Adminkonto'],
    ['auth.login.succeeded', "'- Anmeldung: Benutzer'"],
    ['auth.logout.succeeded', "'- Abmeldung: Benutzer'"],
    ['auth.registration.queued', 'Registrierung: Bestätigungsmail'],
    ['rental.return-mail.failed', 'Fehler beim Versand der Rückgabe-Abschlussmail:'],
    ['payment.adjustment.deferred', 'Mietzeitraum gespeichert; Mollie-Nachzahlung wird erneut versucht:'],
    ['rental.adjustment.failed', 'Fehler beim Speichern des angepassten Mietzeitraums:'],
    ['payment.return-charge.deferred', 'Rückgabe gespeichert; Mollie-Nachzahlung wird erneut versucht:'],
    ['rental.return.failed', 'Fehler bei Positionsrückgabe:'],
    ['payment.cash-record.failed', 'Fehler beim Erfassen der Barzahlung:']
];
if (process.argv[2] === 'installed-console') observability.installConsoleRedaction();
const malicious = 'SyntheticPrivateName\r\n{"event":"forged"}\nnext\u2028line';
const error = Object.assign(new Error(`SyntheticPrivateError resetToken=synthetic-noncredential ${malicious}`), {
    code: 'FIXTURE_FAILURE', sql: 'synthetic-private-sql', payload: { body: 'synthetic-private-body' }
});
const context = { console, log: observability.log, actorReference: observability.actorReference, crypto, Date,
    admin: { email: 'private-fixture@example.invalid' }, normalizedUsername: 'private-fixture@example.invalid',
    rows: [{ role: 'global_admin' }], timestamp: new Date(), verificationResent: false,
    email: 'private-fixture@example.invalid', firstName: malicious, lastName: 'SyntheticPrivateSurname', customerNo: 'SYNTHETIC-1',
    req: { params: { itemId: '41', id: '42' }, session: { user: 'private-fixture@example.invalid' }, body: { orderId: 42 } },
    error, paymentError: error };
for (const [event, legacyMarker] of cases) {
    const isStructured = source.includes(`'${event}'`);
    const marker = isStructured ? `'${event}'` : legacyMarker;
    const at = source.indexOf(marker);
    if (at < 0) throw new Error('Expected application log callsite is missing');
    const structured = source.lastIndexOf('log(', at);
    const oldConsole = Math.max(source.lastIndexOf('console.log(', at), source.lastIndexOf('console.error(', at));
    const start = isStructured ? structured : oldConsole;
    const end = source.indexOf(');', at);
    if (start < 0 || end < at) throw new Error('Expected application log statement is incomplete');
    vm.runInNewContext(source.slice(start, end + 2), context);
}
