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

Die Testdatenbank wird automatisch neu aufgebaut und mit definierten Kunden-, Admin-, Produkt- und Zahlungsdaten befüllt.

Die Integrationstests prüfen unter anderem:

- Produktkatalog, Login und Gast-Warenkorb
- Bestellung mit Barzahlung
- Bestellung mit Onlinezahlung
- Mollie-Webhook und wiederholte Webhook-Zustellung
- vollständigen Storno inklusive Online-Erstattung
- Zahlung bei Abholung und Abholsperre bei offenen Beträgen
- Abholung und ordnungsgemäße Rückgabe
- vollständige Kautionsauszahlung

Mollie und Microsoft Graph werden im Testmodus deterministisch ersetzt. Es werden weder echte Zahlungen noch echte E-Mails ausgelöst.

## Browser-Tests

```bash
npx playwright install chromium
node test/support/test-database.js
npm run test:e2e
```

Die Browser-Suite prüft den Produktkatalog, das Hinzufügen zum Warenkorb, Fehlermeldungen beim Login und einen erfolgreichen Kundenlogin.

Alle drei Teststufen laufen automatisch in GitHub Actions.
