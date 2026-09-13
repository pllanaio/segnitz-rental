# Datenbank, Zeitvertrag und Runtime – Umsetzung/Nachweis

Stand: 13.09.2026; Basis `1382a95444be15f692f4a8800ab521b11c3d4683`, Branch `codex/rc-database-20260913`. Keine produktive Datenbank kontaktiert oder migriert. **Keine Produktionsfreigabe:** echte MySQL-/TLS-/Lastnachweise und Legacy-Interpretation fehlen.

| Befund | Umsetzung | Nachweis | Restpunkt |
|---|---|---|---|
| Fester aktueller Berlin-Offset für technische Fristen | Runtime-/Session-/Worker-/Probe-Verbindungen verwenden Client- und Session-UTC; DATE wird als ISO-String geliefert. Geschäftszone und process.env.TZ bleiben Europe/Berlin. | UTC-Verbindungstest zuerst rot, danach grün; historische Winter-/Sommerwerte, Fold/Gap und Kalenderlogik grün. | Echte MySQL-Roundtrips März/Oktober, Reconnect, Lease/Hold900 reale Sekunden. |
| Unklare Legacy-DATETIME | Neue immutable Migration, vollständige Vorprüfung vor DML, explizite Interpretation, Einzelentscheide, 200-Zeilen-Batches mit atomarem Checkpoint. TIMESTAMP/DATE unverändert. | Konvertierung, ungültiges Datum, Fold/Gap, veralteter Einzelentscheid getestet; sechs alte Migrationschecksummen unverändert. | Bestandsinventur, Backup/Restore, gestoppte alte Writer, reale Abbruch-/Retryprobe. |
| Verifier ignoriert effektive Unterschiede | AUTO_INCREMENT, ON UPDATE, Tabellen-Engine/Charset/Collation, Spalten-Charset/Collation und CHECK.ENFORCED geprüft; Drift wird nicht repariert. | AUTO_INCREMENT/ON UPDATE zuerst rot, danach grün; bisherige Verifierregressionen grün. | Sechs echte MySQL-Driftfälle und Bootstrap-/Readiness503. |
| Unbegrenzte DB-Runtime | Gemeinsames Budget, Queue-/Acquire-/Query-/Transaktionsfristen, reservierte Kontrollconnection; serverseitig max_execution_time/innodb_lock_wait_timeout. | Queue, Recovery, Shutdown, laufender Queryabbruch und idle Transaktionsdeadline getestet. | Reales Stau-/Rollback-/Lastprofil. |
| Socketende ist kein Nachweis für SQL-Ende | Eigene Thread-ID per KILL CONNECTION abbrechen und über PROCESSLIST ihr Verschwinden prüfen; Kapazität bis dahin belastet, bei fehlendem Nachweis quarantänisiert. | Kapazität erst nach Bestätigung frei; Quarantäne bei Fehler, Thread-ID-Validierung, serieller Kontrollablauf getestet. | Echte Serverthread-/Lockfreigabe; keine Behauptung sofortiger DB-Beendigung. |
| Health hinter Sessions | /live, /ready, /health vor Bodyparser/Session; Readiness1500ms einschließlich Acquire/SQL/Schema und Abbruchsignal. | Echter Express-HTTP-Test mit/ohne Cookie und defekter Sessionmiddleware: live200, ready503, Sessionzugriffe0; Fristentest grün. | Vollständige App mit gültiger persistierter Session unter echtem DB-Ausfall/Recovery. |

## Ausgeführte Befehle

- `node --test test/database-timezone.test.js test/database-bootstrap.test.js`: initial25 Tests,23 bestanden, **2 erwartete Regressionen rot** (UTC und wirksame Schemaattribute).
- `npm run check:syntax`: **93 JavaScript-Dateien bestanden**, einschließlich lokal bereitgestelltem Auth-Migrationsmodul.
- `npm test`: **163 Tests bestanden,0 fehlgeschlagen,0 übersprungen** in diesem DB-Arbeitsstand. Spätere Integration anderer Änderungen benötigt erneute Prüfung.
- Vergleich `migrationChecksum()` zwischen Baseline und Branch: **6/6 veröffentlichte Migrationschecksummen unverändert**; keine alten Migrationen/gehashten Helper geändert.
- `git diff --check`: bestanden.
- `DB_HOST=127.0.0.1 DB_PORT=33671 DB_USER=isolated_test DB_NAME=segnitz_runtime_test node --test test/integration/database-runtime.integration.test.js`: **6 Hookfehler durch ECONNREFUSED**,0 fachliche Tests ausgeführt,0 Datenbanken erstellt. Fehlende Infrastruktur, weder Testpass noch belegter Codefehler.

Der neue Integrationssatz erzeugt ausschließlich `segnitz_runtime_test_<pid>_<random>` und entfernt ausschließlich diese eigene neue DB. Er enthält DST/UTC/DATE/TIMESTAMP, sechs Driftarten, Fold-Vorprüfung, Batch-Commit-Abbruch mit zweifacher Wiederholung, echte Serverthread-Beendigung und Sessionpersistenz. Zusammen mit dem bestehenden Bootstrap-/Lifecycle-/Downgrade-Satz auf MySQL8.4 ausführen.

## UTC-Migrationsverfahren

1. Wartung und Änderung separat freigeben. DB plus Bild-/Signaturbestände konsistent sichern; Restore isoliert nachweisen. Alle alten HTTP-/Worker-/Cleanup-Writer stoppen. Alte und neue Binaries dürfen nicht gleichzeitig gegen dieselbe DB schreiben.
2. Legacy-Vertrag inventarisieren. DATETIME sind unten gelistete technische Zeitpunkte; TIMESTAMP sind bereits Instants, DATE bleiben Miettage. Abweichende frühere Konfiguration oder gemischte UTC-/Lokalwerte erfordern dokumentierte Einzelentscheide.
3. `DB_LEGACY_DATETIME_MODE=berlin` ausschließlich bei nachgewiesen Berliner Werten, sonst bei nachgewiesen UTC `utc`. `DB_LEGACY_WRITERS_STOPPED=1` bestätigt die tatsächliche Wartung. Sobald vorhandene DATETIME betroffen sind, stoppt die Migration ohne beide Werte vor DML.
4. Fold/Gap oder abweichende Zellen brauchen `DB_LEGACY_DATETIME_OVERRIDES_FILE`, eine geschützte JSON-Datei. Synthetisches Format: `{"users.123.reset_token_expires":{"stored":"2026-10-25 02:10:00","utc":"2026-10-25T01:10:00Z","reason":"Mit UTC-Ereignisprotokoll belegter zweiter Zeitpunkt"}}`. Das Beispiel entscheidet keine Produktionszeit. Keine Tokens aufnehmen. Gespeicherter Wert, gültiger UTC-Instant und Begründung müssen exakt passen. Keine automatische Wahl zwischen Oktoberinstants; keine Normalisierung nicht existierender Märzzeiten.
5. Bootstrap prüft alle noch ausstehenden Werte vor DML; Fehler nennen maximal50 konkrete Tabellen-/Zeilen-/Spaltenpositionen je Lauf. Je200 Zeilen und Checkpoint werden gemeinsam committed. Abbruch vor Commit rollt den Batch zurück; danach setzt Retry hinter dessen ID fort. Unveränderte Interpretation/Override-Datei beibehalten; abgeschlossene Tabellen werden nicht erneut verschoben. Die idempotente Fortschritts-DDL ist vom DML getrennt.
6. UTC-Normalisierung läuft vor den unveränderten alten Backfills, damit diese anschließend UTC erzeugen und keine neu erzeugten UTC-Werte verschoben werden. Erst nach Migrationen/Schemaprüfung starten HTTP/Worker. Frische Installation erzeugt finales Schema und Manifest ohne Legacy-DML.
7. Danach ursprüngliche Instants, Miettage, Ledger, Tokenexpiry, Outboxleases und Bildreferenzen prüfen. Kein altes Binary gegen migrierte DB starten. Recovery: Writer stoppen, konsistenten Vorzustand in neue DB/Volumes restaurieren und Provider/Outbox vor Wiederaufnahme abgleichen. Kein pauschales Stunden-Addieren als Rollback.

| Tabelle | DATETIME-Instants |
|---|---|
| app_installation | setup_token_created_at, initialized_at |
| users | verification_expires, reset_token_expires |
| guest_verifications | expires_at |
| rental_orders | reserved_until, paid_at, order_confirmation_sent_at, picked_up_at, returned_at, cancelled_at, guest_access_token_expires_at |
| rental_order_items | picked_up_at, returned_at, return_case_processed_at, cancelled_at |
| rental_order_payments | paid_at, created_at |
| mollie_webhook_events | processed_at |
| external_effects_outbox | available_at, locked_at, completed_at, created_at, updated_at |

DATE: rental_start, rental_end, adjusted_rental_start, adjusted_rental_end, actual_return_date bleiben unverändert. TIME-Öffnungszeiten werden weiter nach Europe/Berlin interpretiert. TIMESTAMP-Audit-/Migrationswerte werden nicht umgerechnet; bestehende ON-UPDATE-Auditwerte werden bei Legacy-DML explizit bewahrt.

## Konfiguration, Rechte, Ressourcen

| Einstellung | Standard/Bedeutung |
|---|---|
| DB_CONNECTION_LIMIT | 12 gesamt je Prozess:11 normale Connections plus höchstens1 serielle Kontrollconnection |
| DB_QUEUE_LIMIT | 50 Wartende |
| DB_ACQUIRE_TIMEOUT_MS | 2000; abgebrochene Proben entfernen ihren Queueeintrag |
| DB_CONNECT_TIMEOUT_MS | 3000 für Handshake; Readiness kann früher abbrechen |
| DB_QUERY_TIMEOUT_MS | 5000; zusätzlich serverseitiger SELECT-Limit und aufgerundeter InnoDB-Lockwait |
| DB_TRANSACTION_TIMEOUT_MS | 15000 ab BEGIN, auch bei externem Warten; später COMMIT ausgeschlossen |
| DB_MIGRATION_TIMEOUT_MS | 120000 für Migrations-SQL/Batch |
| DB_READINESS_TIMEOUT_MS | 1500 für vollständige Probe |
| DB_TLS / DB_TLS_CA_FILE | 1 aktiviert CA-/Hostnamenprüfung, mindestensTLS1.2. CA-Datei erforderlich. DB_HOST muss wegen mysql2-Identitätsverhalten dann DNS-Hostname sein. |

Bestehende kurzlebige Connections werden beibehalten, ohne unsichere Wiederverwendung offener Transaktionen/Locks/Uservariablen. HTTP, Sessionstore, Worker, Cleanup, Probes teilen ein Budget; Sessionstore erzeugt keinen eigenen Pool und keine Tabelle. Proben schließen ihre Pingconnection vor dem gemeinsamen Schemascan. `Replikate × DB_CONNECTION_LIMIT` plus Backup-/Migrations-/Administrationsbedarf muss unter MySQL-/Benutzergrenzen liegen.

Kontrollconnection verwendet denselben Benutzer und ausschließlich die selbst erhaltene Thread-ID. Für eigene Threads braucht MySQL weder PROCESS noch CONNECTION_ADMIN/SUPER. KILL setzt ein Flag und bestätigt noch kein Ende; erst PROCESSLIST-Abwesenheit gibt die Kapazität frei. Bleibt der Nachweis aus, alarmieren `connectionBudget.snapshot().quarantined`/`cancellationFailures`; Kapazität bleibt belastet, Readiness kann503 liefern. Keine Behauptung sofortiger serverseitiger Beendigung ([offizieller MySQL8.4-Vertrag](https://dev.mysql.com/doc/refman/8.4/en/kill.html)).

Runtime benötigt SELECT/INSERT/UPDATE/DELETE auf Anwendungstabellen, eigene SESSION-Einstellungen und eigene Threadsicht/-abbruch. Der bestehende Startpfad migriert noch mit denselben Credentials: zusätzlich CREATE/ALTER/INDEX/REFERENCES und ggf.CREATE DATABASE. **Getrennte Migrationsidentität bleibt offen**, nicht als umgesetzt deklarieren. TLS-Code ist vorhanden, echte CA-/falscher-Hostname-/Zertifikatsablaufproben mangels TLS-MySQL offen. Keine destruktive automatische Driftreparatur.

Noch auszuführendes Lastprofil: MySQL8.4; mindestens2vCPU/2GiB isoliert;1 App-Replik, Gesamtlimit12/Queue50;100 gleichzeitige Requests60s (60% Cart/Availability,20% Login/Session,10% Admin-Lesen,10% Ready), dann10s blockierte Transaktion mit Outbox-Arbeit und Recovery. Ziele:≤12 eigene Serverthreads, Queue≤50, live auch mit gültigem Cookie<250ms, ready≤1500ms plus Scheduler-Toleranz; kein unbegrenztes SQL/Lock nach Deadline, keine Connections/Timer nach Shutdown, funktionierende Session nach Recovery. CPU/RAM/Latenz/503/Quarantäne dokumentieren und echte Replikzahl nachmessen. **Diese Lastwerte wurden hier nicht gemessen.**

Nachkontrolle: Ein weiterer roter Verhaltenstest wies vorzeitige Budgetfreigabe bei einem Timeout schon während SET SESSION nach. Die Runtime übergibt die Freigabe jetzt einmalig an den Connection-Lebenszyklus; auch Initialisierungsfehler bleiben bis zur bestätigten Serverbeendigung belastet. Dieser Test und der vollständige Satz sind anschließend grün (160 Tests).


Nachkontrolle API/Anzeige: 33 technische Zeitprojektionen in Auftrags-/Zahlungs-/Bild-/Review-APIs liefern jetzt ISO8601 mit Z statt einer nach UTC-Umstellung mehrdeutigen SQL-Lokalzeichenfolge. Reine DATE-Projektionen bleiben gleich. Die früheste tatsächliche Rückgabe wird gegen den mit Europe/Berlin aus dem gespeicherten Abhol-Instant abgeleiteten Geschäftstag geprüft; DATE_FORMAT über UTC würde kurz nach Berliner Mitternacht den Vortag liefern. Der neue MySQL-Integrationstest prüft zusätzlich den ISO-Z-Roundtrip; seine echte Ausführung bleibt mangels MySQL offen.

Isolierte bestehende CI-Fixtures werden bereits von dieser UTC-Runtime geschrieben. Wenn Tests das finale schema.sql erzeugen und befüllen, aber bewusst kein Migrationsmanifest erfassen, benötigen ausschließlich deren isolierte Serverprozesse `DB_LEGACY_DATETIME_MODE=utc DB_LEGACY_WRITERS_STOPPED=1`. Das ist eine Aussage über die synthetischen Fixtures, keine Vorgabe für Produktionsaltbestände. Frische leere Installation braucht keine Legacy-Interpretation. Der neue Runtime-Integrationssatz entscheidet seine eigenen Legacy-Fixtures ausdrücklich mit `{mode: berlin}` und setzt keine Produktionsumgebungswerte.

Checksummen-Vorprüfung nach Review: Eine injizierte historische Checksum-Drift löste im roten Test zunächst neue UTC-Up-Logik aus, bevor der spätere Check stoppte. Alle angewendeten bekannten Checksummen werden nun vor jeder neuen Up-Logik und beim vorhandenen Schema vor kanonischer Tabellen-DDL validiert; zulässige alte Legacy-Checksummen bleiben unterstützt. Der Verhaltenstest ist grün.

Connection-Lifecycle-Nachkontrolle: mysql2 quittiert end() bereits vor COM_QUIT/Socketclose. Der zusätzliche rote Test zeigte vorzeitige Freigabe; jetzt folgt bei offener Transaktion zuerst bestätigtes ROLLBACK und bei normalem end() Warten auf Transportclose innerhalb der Queryfrist. Ein weiterer roter Shutdowntest zeigte, dass der Controller zuvor vor KILL-Dispatch geschlossen wurde. Shutdown wartet jetzt auf die begrenzte Cancellation-Queue, bevor er den Controller beendet. Beide Verhaltenstests sowie der gesamte Satz sind grün (163 Tests).
