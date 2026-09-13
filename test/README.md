# Automatisierte Tests

Der Einstiegspunkt der Anwendung ist `server.js`. Die Tests verwenden Node 22/24,
CommonJS und echtes MySQL 8.4 für Datenbank-/API-Verhalten. Der aktuelle
Abnahmestand steht in [production-readiness.md](../docs/production-readiness.md);
vorhandener Testcode und eine erfolgreiche Testsammlung sind kein bestandener Lauf.

## Lokal ohne Datenbank

```sh
npm ci
npm run check:syntax
npm run test:unit
node scripts/verify-browser-assets.js
npm run audit:prod
```

Der Unit-Befehl führt `test/*.test.js` aus. Neben isolierten Berechnungen enthält
der Satz echte lokale Express-HTTP-/Multipart-/Proxy-/Probe-Verhaltenstests,
CLI-Negativfälle für Release-/CodeQL-Artefakte und die Python-Tests der
Backup-/Restorehelfer. Er deckt unter anderem Belegung/Zahlungsbeobachtungen,
Finanzprojektion und reale Browserrenderer, Auth-/Passwortpolicy, Bilddecoding,
UTC/Schema/Verbindungsbudget, Fehlermeldungen und Gatebedingungen ab. Bestehende
Quelltextregressionen bleiben zusätzlich erhalten; sie ersetzen keine echte
MySQL-Konkurrenzprüfung. Der npm-Audit deckt die lokal ausgelieferten
Browserbibliotheken nicht automatisch ab.

## Isoliertes MySQL und Testidentitäten

Nur eine eigene neue lokale/CI-MySQL-Instanz und ausschließlich entbehrliche
Testdatenbanken verwenden. Die Resethelfer löschen ihr Testschema und befüllen es
mit synthetischen Fixtures. Der Namensschutz verlangt einen eigenen Bestandteil
`test` oder `ci`; er ist kein Ersatz für die Prüfung von Host, Benutzer und
Ressourcenbesitz. Niemals Produktionsdump, Kunden-/Signaturdaten oder produktive
Bildvolumes als Fixture einbinden.

Beispielwerte gelten ausschließlich für eine zuvor eingerichtete isolierte
Testinstanz; Benutzer/Passwort entsprechend deren eigener Konfiguration setzen:

```sh
export DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=segnitz_test
export DB_USER=segnitz_test DB_PW=local-test-only
export SESSION_SECRET=isolated-tests-only-session-secret-at-least-32-characters
export NODE_ENV=test MOLLIE_TEST_MODE=1 DISABLE_EMAILS=1
export MAIL_DELIVERY_PAUSED=1 DISABLE_PERIODIC_CLEANUP=1
export DISABLE_PAYMENT_RECONCILIATION=1
export DB_LEGACY_DATETIME_MODE=utc DB_LEGACY_WRITERS_STOPPED=1
```

Der Testbenutzer benötigt für Bootstrap-/Runtime-/Driftfälle außerdem Rechte für
seine ausschließlich eigenen neu erzeugten Testdatenbanken sowie DDL/Trigger;
normale App-DML-Rechte allein reichen für diese gezielten Tests nicht. Die Suite
läuft seriell (`--test-concurrency=1`), weil verschiedene Fixtures das gemeinsame
Testschema neu aufbauen. Runtime-/Bootstrapfälle erzeugen zusätzlich eindeutig
benannte eigene Testdatenbanken und räumen nur diese auf.

Die UTC-Legacyflags oben beschreiben ausschließlich synthetische Fixtures, die
bereits von der neuen UTC-Runtime in das aktuelle `database/schema.sql` geschrieben
wurden, bevor ein Migrationsmanifest vorhanden ist. Tests historischer Berliner
Daten wählen ihre eigene Interpretation ausdrücklich. Für echte Altbestände
niemals diese Beispielentscheidung übernehmen: neue immutable Migrationen werden
über den normalen Bootstrap nach [operations.md](../docs/operations.md) ausgeführt.
Die alten SQL-Dateien sind historische Quellen, keine Anleitung zum manuellen
Umgehen von Migrationsreihenfolge, Checksummen oder UTC-Vorprüfung. Eine frische
leere Installation braucht keine Legacy-Konvertierung und erzeugt keine Demoaufträge.

Mollie verwendet einen lokalen vertragsgetreuen Adapter, Microsoft Graph wird
nicht kontaktiert und Auth-Mailjobs bleiben für die Test-Mailbox in der Outbox.
Die Test-Mailbox liest benötigte Links ausschließlich aus dem eigenen ausstehenden
Outboxpayload; Token-Spalten enthalten Hashes. Keine Links, Sessioncookies, Secrets,
Signaturinhalte oder vollständigen Mailpayloads in Fehlerausgaben aufnehmen.
Das ist ausdrücklich kein realer Mollie-/Graph-Sandboxkontakt.

## MySQL- und API-Tests

```sh
npm run test:integration
```

| Suite | Wesentlicher Vertrag |
| --- | --- |
| `app.integration.test.js` | Katalog/Cart, CSRF/Ownership/private Bilder, Registrierung/Verifikation, Login/Logout/auth_version, Passwortwechsel und paralleler Reset |
| `order-lifecycle.integration.test.js` | Cash/Online, Abholung, Verlängerung/Teil- und Vollstorno, tatsächliche Rückgabe/Schaden/Kaution/Refund, Datums- und Nullpreisgrenzen |
| `payment-observation.integration.test.js` | Zwei echte Verbindungen, kontrollierte Uhr, Holdverlust ohne Cleanup, Payment-/Refund-Deduplizierung und physische Belegung |
| `dependencies.integration.test.js` | Persistierte Session mit dem deduplizierten MySQL-Treiber, Requestparser und Multipart |
| `auth-secrets-migration.integration.test.js` | Legacy-Hashing/Redaction, unveränderte Finanzidentitäten, wiederholter Lease-Reaper nach Workerabbruch |
| `business-period.integration.test.js` | Berliner Monats-/Jahresgrenzen auf UTC-Werten ohne MySQL-Zeitzonentabellen |
| `database-bootstrap.integration.test.js`, `database-runtime.integration.test.js`, `return-migration.integration.test.js` | Fresh/Legacy/Checksummen/Drift/Abbruch/Retry/Downgrade, UTC/DST/DATE/TIMESTAMP, Sessionpersistenz, Deadline/KILL und Rückgabebackfill |
| `admin-mutation-audit.integration.test.js` | Finanzänderung und AFTER-Ereignis atomar, Insertfehler/Abbruch, Append-only-Trigger und serialisierte Schreiber |

Die App-Fixture verwendet einen ausschließlich für ihren Kindprozess ausdrücklich
konfigurierten Loopback-Testproxy und je logischem Client eine stabile
TEST-NET-Adresse. Dadurch teilen unabhängige Testidentitäten kein kumulativ
verbrauchtes IP-Budget. Produktionslimits bleiben unverändert; ein eigener
Verhaltenstest verlangt fünf zulässige Kontoanfragen und 429 beim sechsten Versuch.
Von nicht vertrauenswürdigen Peers werden behauptete Forwarded-Adressen weiterhin
nicht zur Umgehung des Limits akzeptiert.

## Playwright mit eigenen APIs

Nach derselben geprüften MySQL-/Testumgebung:

```sh
npx playwright install chromium
node test/support/test-database.js
npm run test:e2e
```

`test/support/test-database.js` bereitet ausdrücklich verifizierte synthetische
Kunden-, Admin- und Fremdnutzeridentitäten vor. `playwright.config.js` startet
`npm start`, setzt die isolierten Provider-/Mailflags und Test-Dokumentversionen
und teilt ein temporäres Providerfixture-Verzeichnis mit Server und Tests. Kein
produktiver Server darf unter der Test-URL laufen; für reproduzierbare CI-Läufe
ist eine Wiederverwendung bestehender Server abgeschaltet.

- `production-primary.spec.js`: durchgehender Ablauf auf Desktop und schmaler
  mobiler Ansicht mit echten eigenen APIs und tatsächlichem lokalem Flatpickr.
  Suche/Kategorie, Cartänderung, Unicode-Kontakte, Unterschrift/Akzeptanz,
  Cash/Admin/Abholung/Verlängerung/Schadensfoto/Kautionsverrechnung/Refund sowie
  Onlinepending/Retry/Webhook und Fremdnutzerzugriff. Eigene Endpunkte und Kalender
  werden hier nicht gemockt; ausschließlich die externe Provideroberfläche ist isoliert.
- `network-failures.spec.js`: bewusst begrenzte sekundäre 429-/503-Fehlereinspeisung
  mit Pending/Wiederholbarkeit/gesperrter unbekannter Verfügbarkeit; echte
  Sessioninvalidierung per Logout bei geöffnetem Profil. Letzteres ist kein
  separater zeitgesteuerter Cookie-TTL-Test.
- `rental-flow.spec.js`: bestehende ergänzende UI-/Fehler-/XSS-/CSP-/Loginfälle,
  teilweise mit eigenen API-Fixtures. Sie ersetzen den Hauptablauf nicht.

`npx playwright test --list` sammelt lediglich Tests. Traces, automatische
Screenshots und Videos sind ausgeschaltet, damit Session-/Auth-/Signaturmaterial
nicht als Browserartefakt gespeichert wird. Fehlermeldungen und manuell erzeugte
Diagnostik ebenso auf Geheimnisse prüfen.

## CI und Release-Abnahme

Die Workflows führen Syntax/Unit auf Node 22/24, echte MySQL-Integration,
Playwright, Production-Audit, Containerbuild/-scan und CodeQL aus. Der Releasegate
verlangt dieselbe Commitidentität und den konkreten geprüften OCI-Digest; ein roter
oder fehlender Check sperrt die Veröffentlichung. Negative Gate-/Artefakttests
sind Bestandteil des Unitsatzes. Aktivierter Branchschutz und echte
Security-/Image-/Restore-/Lastnachweise sind separat zu verifizieren; eine
Workflowdatei allein ist kein bestandener Lauf und kein eingerichteter Branchschutz.
