# Automatisierte Tests

## Unit-Tests

```bash
npm run test:unit
```

Prüft isolierte Middleware-, Upload- und Security-Logik ohne externe Dienste.

## MySQL-Integrationstests

Die folgenden Umgebungsvariablen müssen auf eine leere Testdatenbank zeigen:

```bash
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PW=root
DB_NAME=segnitz_test
SESSION_SECRET=integration-test-session-secret-with-at-least-32-characters
```

Danach:

```bash
npm run test:integration
```

Die Testdatenbank wird automatisch aus dem kanonischen
[`database/schema.sql`](../database/schema.sql) neu aufgebaut und ausschließlich mit
synthetischen Kunden-, Admin-, Produkt- und Zahlungsdaten befüllt. Beide
Integrationstest-Suiten verwenden damit dieselbe Struktur wie die Anwendung.

Der produktive Dump wird nicht als Testfixture eingecheckt, weil er Personen-,
Zahlungs- und Signaturdaten enthält. Für eine bestehende Datenbank aus dem Dump vom
13.08.2026 müssen die einmaligen Migrationen
[`20260813_align_dump_with_application.sql`](../database/migrations/20260813_align_dump_with_application.sql)
und anschließend
[`20260813_harden_return_lifecycle.sql`](../database/migrations/20260813_harden_return_lifecycle.sql)
ausgeführt werden.

Die Integrationstests prüfen unter anderem:

- Produktkatalog, Login und Gast-Warenkorb
- Jahres- und Monatsfilter für Kunden- und Adminbestellungen
- serverseitige Sperre von Kundenstornos
- Bestellung mit Barzahlung
- Bestellung mit Onlinezahlung
- Mollie-Webhook und wiederholte Webhook-Zustellung
- vollständigen Storno inklusive Online-Erstattung
- Zahlung bei Abholung und Abholsperre bei offenen Beträgen
- Abholung und ordnungsgemäße Rückgabe
- Rückgaben mit Schaden, Verspätung und frei gewählter Bar- oder Online-Nachzahlung
- Teilrückgabe mit anschließender Positionsstornierung
- offene, fehlgeschlagene und abgeschlossene Kautionserstattungen
- Migration historisch inkonsistenter Rückgabezustände

Mollie und Microsoft Graph werden im Testmodus deterministisch ersetzt. Es werden weder echte Zahlungen noch echte E-Mails ausgelöst.

## Browser-Tests

```bash
npx playwright install chromium
node test/support/test-database.js
npm run test:e2e
```

Die Browser-Suite prüft den Produktkatalog, dynamische Warenkorb- und
Bestellaktionen, Fehlermeldungen beim Login, Kunden- und Adminlogin, die
Rückgabemaske einschließlich Schadensdokumentation und Zahlungsweg sowie die
ausgelieferte CSP ohne Inline-Skriptfreigabe.

Alle drei Teststufen laufen automatisch in GitHub Actions.
