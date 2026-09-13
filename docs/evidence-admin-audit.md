# Dauerhafter Adminaudit: Nachweis und Integrationsvertrag

Stand 13.09.2026. Ausgangspunkt des isolierten Nachtrags:
`6a8dbd2159b03c3a094d5677a388e7805568195c`, Branch
`codex/rc-admin-audit-20260913`. Keine Produktionsdatenbank wurde verändert.

## Behobener Codebefund

Die bisherigen Admin-Finanz-/Miettransaktionen konnten committen, ohne ein
transaktionales Auditereignis zu persistieren. Eine HTTP-Receipt im Prozesslog
konnte bei Prozess-/Logverlust fehlen und war nicht atomar an die Finanzänderung
gebunden.

`services/adminMutationAudit.js` liefert zwei eindeutig getrennte Funktionen:

```js
// Ersetzt die bisherige einzelne Zeile: await connection.commit();
await commitAdminMutation(connection, req);

// Alternative ausschließlich für einen bewusst getrennten eigenen Commitpfad:
await appendAdminMutation(connection, req);
await connection.commit();
```

Die erste Funktion nimmt den Auditdatensatz auf und committet danach **genau
selbst**. Beide Varianten niemals kombinieren. Ein Fehler bei Accountprüfung,
Snapshot, Insert oder Commit wird weitergereicht; der Commitwrapper versucht
zuvor den Rollback. Ein Netzwerkfehler nach tatsächlich bestätigtem serverseitigem
Commit bleibt eine fachlich abzugleichende unklare Antwort, keine behauptete
Exactly-once-Antwortgarantie. Datenänderung und Auditereignis sind dennoch Bestandteil
derselben MySQL-Transaktion.

Der Runtime-Wrapper aus dem getrennten DB-Commit `6ac21686` stellt einen
nicht überschreibbaren, nicht enumerierbaren
`Symbol.for('segnitz.mysql.transaction-active')`-Getter bereit. Ohne aktive
explizite Transaktion lehnt der Auditdienst ab. Es wird **kein** nicht kompatibles
`@@session.in_transaction` vorausgesetzt und keine zusätzliche PROCESS-Abfrage
verwendet.

## Exakte Routenzuordnung

`ACTIONS` ist die exportierte verbindliche Allowlist. Nur die vorhandenen
Transaktionscommits dieser Routen werden durch den Commitwrapper ersetzt:

| Methode / Route | Zielauflösung |
| --- | --- |
| PUT `/admin/order-items/:itemId/pickup` | Position → gesperrter Auftrag |
| PUT `/admin/orders/:id/pick-up` | Auftrag aus `params.id` |
| PUT `/admin/orders/:id/cancel` | Auftrag aus `params.id` |
| PUT `/admin/order-items/:itemId/cancel` | Position → gesperrter Auftrag |
| PUT `/admin/order-items/:itemId/rental-adjustment` | Position → gesperrter Auftrag |
| PUT `/admin/order-items/:itemId/return` | Position → gesperrter Auftrag |
| POST `/admin/order-items/:itemId/return-images` | Position → gesperrter Auftrag; keine Bildinhalte im Audit |
| POST `/admin/order-payments/manual` | `body.orderId`, optionale `body.orderItemId` |
| POST `/admin/order-payments/manual-refund` | `body.orderId`, optionale `body.orderItemId` |
| POST `/admin/order-payments/:id/retry-refund` | Zahlungszeile → gesperrter Auftrag/Position |

API-Routen, die keine finanzielle/mietbezogene Transaktion enthalten, werden nicht
unbemerkt umgebaut. Insbesondere Dateilöschungen, Öffnungszeiten, Authmutationen,
Mailversand und externe Providerworker sind durch diese Allowlist nicht als
Finanzaudit abgedeckt. Der finale Commit-/API-Routentest muss zeigen, dass jede
erforderliche Commitstelle angebunden ist. Die Erstellung dieses Nachtrags
verändert `segnitz_rental.js` bewusst nicht gleichzeitig mit anderen Arbeiten;
die gezielte Routeneinbindung erfolgt im Gesamtbranch.

## Persistierter Vertrag und Datengrenzen

Neue Tabelle `admin_mutation_events`, neue Migration
`20260913_03_admin_audit`. Das gesamte neue Migrationsmodul ist gehasht; keine der
acht vorherigen Migrationsprüfsummen wurde verändert. Fresh-Install führt den
neuen Triggeraufbau vor dem Markieren der Migrationen aus. Bestehende Installationen
laufen über den normalen Migrationspfad. Unterbrochene neue DDL darf fehlende
Trigger nachholen, aber keinen abweichenden vorhandenen Trigger ersetzen.

Ein Auditdatensatz speichert stabile Administrator-ID und daraus abgeleitete
Referenz, aktuell geprüfte Rolle, intern generierte Request-ID, Methode/Route,
Auftrag/Position/Zahlungsziel und einen projizierten **AFTER-Zustand**:
Auftragsstatus, Finanz-/Retourenstatus, Kalenderdaten, betroffene Bestandswerte,
Kautionsentscheidung und nach Typ/Methode/Zustand gruppierte Ledgerbeträge.
Die Authversion wird vor dem Schreiben gegen den aktuellen Account geprüft,
aber nicht als Authgeheimnis gespeichert. Centarithmetik verwendet BigInt;
JSON-Werte sind exakte ganzzahlige Strings. Nullpreis und reine Miettage bleiben
darstellbar.

Für konsistente Resultate erfolgen aktuelle Sperrlesezugriffe auf Auftrag,
Positionen in ID-Reihenfolge und Zahlungszeilen in ID-Reihenfolge. Die vorher
aufgelöste Elternzugehörigkeit wird unter diesen Sperren nachgeprüft. Ein alter
Repeatable-Read-Snapshot kann dadurch nicht als neuer Finanzzustand protokolliert
werden. Externe Aufrufe finden nicht statt. Die bestehenden SQL-/Transaktions-
Deadlines gelten auch für den Auditpfad. Schutzgrenzen: höchstens 500 Positionen,
10.000 Zahlungszeilen und 512 KiB Audit-JSON je Ereignis; Überschreitung blockiert
den Commit und benötigt eine kontrollierte fachliche Aufteilung statt stiller
unvollständiger Protokollierung.

Der Dienst projiziert ausschließlich explizit ausgewählte Felder. Keine
Kundennamen, Adressen, E-Mailadressen, Signaturen, Bild-/Mailpayloads, Texte,
Notizen, Providerzugriffsdaten oder Requestbodies werden gespeichert. Keine
Fremdschlüssel mit Delete-/Update-Kaskaden verändern die historischen Ereignisse.
Zwei BEFORE-Trigger verweigern UPDATE und DELETE. Der Schemaverifier prüft ihre
exakte Anzahl, Namen, DML-Ereignisse, Timing und SIGNAL-Bodies. Zusätzliche oder
fehlende Trigger sind Drift. DDL-/DROP-/TRUNCATE-Berechtigungen bleiben ein
Betreiberkontrollthema; ein DBA wird durch einen Anwendungstrigger nicht zum
unprivilegierten Nutzer.

Ein Vorher-Bild wird nicht behauptet. Für historische Änderungen vor dieser
Migration werden keine Ereignisse nachträglich erfunden. Zustände externer
Providerabwicklung nach einem Admincommit werden weiterhin im Zahlungsledger
und der Outbox geführt; sie sind keine nachträgliche Umschreibung dieses
Adminereignisses.

## Tatsächliche lokale Tests

1. Die vorhandene direkte `connection.commit()`-Semantik wurde zunächst als
   Baseline im transaktionalen Test-Doppel ausgeführt: **4 Tests rot**. Konkret
   fehlte der persistierte Datensatz, und ein simulierter Auditfehler verhinderte
   den bisherigen Commit nicht. Dies war ein Verhaltenstest des Commitvertrags,
   kein Quelltextregex und kein echter MySQL-Test.
2. Nach Implementierung und Entfernen des Baseline-Fallbacks:
   **9 neue Audit-/Migration-Unit-Tests grün**. Darunter Atomarität im
   Transaktionsdoppel, Insertfehler/Rollback, positive sichere IDs, Zielauflösung,
   Autocommit-/Rollen-/Authversionsablehnung, vertrauliche Daten, Centgenauigkeit,
   Triggerdrift, unterbrochene DDL/Retry und unveränderte frühere Checksummen.
3. Zusammen mit vorhandenen DB-Budget-, Bootstrap-, Schema- und
   Operationsregressionen: **53 Tests bestanden**, 0 fehlgeschlagen,
   0 übersprungen. Syntaxprüfung im isolierten Nachtrag: **137 JS-Dateien** grün.

Ausgeführt:

```sh
node --test test/admin-mutation-audit.test.js
node --test test/admin-mutation-audit.test.js test/admin-audit-migration.test.js test/database-budget.test.js test/database-bootstrap.test.js test/database-schema.test.js test/operations.test.js
node --check test/integration/admin-mutation-audit.integration.test.js
node scripts/check-syntax.js
git diff --check
```

## Vorbereitete echte MySQL-Nachweise: noch nicht ausgeführt

`test/integration/admin-mutation-audit.integration.test.js` enthält fünf Tests
mit dem bestehenden Test-/CI-Namensschutz und echten getrennten Verbindungen:

1. Ein Leser sieht weder Audit noch Finanzänderung vor COMMIT; danach beide mit
   passenden Beträgen, Rollenreferenzen und unverändertem Oktober-Miettag.
2. Ein nur im isolierten Test erstellter INSERT-SIGNAL-Trigger lässt den Auditinsert
   fehlschlagen; die Finanzänderung wird vollständig zurückgerollt.
3. UPDATE/DELETE sind verboten; ein absichtlich fehlender Trigger lässt
   Schema-Readiness scheitern; Migration-Retry erhält das existierende Ereignis.
4. Zwei Schreiber mit absichtlich alter konsistenter Lesesicht protokollieren ihre
   serialisierten eigenen Resultate (`12525`, danach `13030` Cent).
5. Verbindungsabbruch zwischen Auditinsert und COMMIT macht weder das Ereignis
   noch die Finanzänderung sichtbar.

Diese fünf Tests wurden mangels isoliertem MySQL **nicht ausgeführt**. Es wurde
keine Produktionsmigration als Ersatz ausgeführt. Zusätzlich offen: finale
API-Routeneinbindung samt bestehenden realen MySQL-/Playwright-Abläufen sowie
TRIGGER-/Definerrechte und Backup-/Restoreverhalten unter der tatsächlichen
MySQL-Konfiguration. Der Nachtrag behebt die Code-/Logverlustlücke; er erteilt
keine Produktionsfreigabe und ersetzt keine fehlenden Betriebsnachweise.
