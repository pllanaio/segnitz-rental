# Betrieb und Freigabe: Segnitz Rental

Stand: 13.09.2026. Dieses Runbook beschreibt vorbereitete Betriebsaktionen. Es ist
keine Genehmigung, sie gegen Produktion auszuführen. Der verbindliche
Freigabestatus und tatsächlich ausgeführte Tests stehen in
[production-readiness.md](production-readiness.md); lokale Operationsnachweise in
[evidence-operations.md](evidence-operations.md).

## Verantwortlichkeit und noch erforderliche Betreiberwerte

| Entscheidung | Vorgabe / nachzuweisender Betreiberwert |
| --- | --- |
| Betriebsverantwortung und Vertretung | Namen und erreichbares Alarmziel noch festlegen |
| Geschäftliche Wartungssperre | Buchungen, Bildschreibzugriffe, Adminmutationen und alle Worker gemeinsam drainen; Proxy-Sperre und Umgang mit eingehenden Webhooks freigeben |
| RPO und RTO | Beide noch festlegen; keine durch das Repository nachgewiesenen Zeiten |
| Backup-Intervall, Aufbewahrung, Standorte | An RPO und Datenklassen ausrichten; bestehenden Betreiber-Speicher inventarisieren |
| Verschlüsselungsschlüssel | age-Empfänger und getrennt verwahrte Recovery-Identität, Besitzer, Stellvertretung und Wiedergewinnung nachweisen |
| Restoreprobe | Datum, Ausgangsstand, Anbieterisolation, Ergebnisse, gemessene Dauer und Freigabe dokumentieren |
| Rechnungsstellung | Bestehenden externen Prozess und Zuständigkeit bestätigen; kein neues Rechnungsmodul |
| Vertragstexte, Datenschutz und Betreiberangaben | Verbindliche veröffentlichte Dokumentversionen und Beschriftungen freigeben |
| Proxy, TLS und Datenbank | Tatsächliche Hops/CIDRs, Firewall, CA, Berechtigungen und Limits nachweisen |
| GitHub und Registry | Main-Ruleset, Reviews, Required Checks, Secret Scanning und geschützte Releaseumgebung aktivieren/verifizieren |

## Konfiguration, Start und Berechtigungen

`server.js` ist der einzige vorgesehene Produktionsstart. Die zentrale validierte
Konfiguration wird vor Migrationen und HTTP-Start ausgewertet. `.env.example`
beschreibt die verbindlichen Variablen; keine `.env`-Dateien, kompletten
`docker compose config`-Ausgaben oder Client-Credentials in Tickets/CI-Artefakte.
Nur `docker compose config --quiet` zur syntaktischen Konfigurationsprüfung nutzen.

`TRUST_PROXY` muss in Produktion ausdrücklich gesetzt werden: `0`/`false` für
bewusst direkten Betrieb, eine verifizierte Anzahl von 1–8 Hops oder vertrauenswürdige
IP-/CIDR-/Express-Netznamen. Kein pauschales `1` oder `loopback`: Bei Docker kann
selbst ein Proxy desselben Hosts über eine Bridge-Adresse erscheinen. Tatsächliche
Remoteadresse und Forwarded-Header am Origin kontrollieren, direkte Originzugriffe
per Firewall sperren und anschließend Secure-Cookies, Login, CSRF und Rate-Limits
über den echten Proxy testen. Die Variable ist keine automatische Topologieerkennung.

Produktiv erforderlich sind insbesondere `NODE_ENV=production`, eine HTTPS
`BASE_URL`, ein zufälliges Sessionsecret sowie die Werte der aktivierten echten
Mollie-/Graph-Integrationen. `MOLLIE_TEST_MODE=1` und `DISABLE_EMAILS=1` sind keine
produktiven Wartungsoptionen. Der ausdrücklich validierte E-Mail-Pausenmodus
belässt Jobs zur späteren Verarbeitung in der Outbox. Im Test dürfen isolierte
Adapter verwendet werden; das ist kein Nachweis eines echten Mollie- oder
Graph-Sandboxkontakts.

Geschäftstag und Anzeige verwenden `Europe/Berlin`; Miettage bleiben `DATE`.
Technische Instants verwenden UTC. Vor Übernahme bestehender lokaler
`DATETIME`-Werte muss der Betreiber die dokumentierte Legacyinterpretation und
ambivalente Oktoberzeiten klären. Bestehende `TIMESTAMP`-Werte dürfen nicht
pauschal verschoben werden. Details der neuen Migrationen und deren tatsächliche
Tests stehen in der Produktionsbereitschaftsdokumentation.

`DB_TLS=1` mit `DB_TLS_CA_FILE` ermöglicht verifizierte CA- und Hostnamenprüfung
für entfernte MySQL-Verbindungen. Die CA-Datei nur lesbar in den Container mounten;
kein `rejectUnauthorized=false`. TLS-Handshake, Hostnamenfehler und Zertifikatswechsel
in der Zieltopologie prüfen. Keine TLS-Ausnahme aus einer lokalen Testkonfiguration
übernehmen.

Die optionale Vorlage `compose.db-tls.yml` mountet ausschließlich das öffentliche
CA-Zertifikat schreibgeschützt und aktiviert die Identitätsprüfung. Für `DB_HOST`
den DNS-Namen aus dem Serverzertifikat verwenden. `DB_TLS_CA_HOST_FILE` bezeichnet
eine vorhandene absolute Hostdatei, die UID 1000 lesen kann; niemals den privaten
CA-Schlüssel mounten. Vor jedem freigegebenen Update mit diesem Overlay zusätzlich
`docker compose -f compose.yml -f compose.db-tls.yml config --quiet` ausführen;
für das spätere freigegebene Update dieselbe Dateikombination verwenden. Die
isolierte CI-Probe prüft gültige CA, falsche CA und falschen Hostnamen; die echte
Betreiber-CA und Zieltopologie bleiben gesondert nachzuweisen.

Der derzeitige automatische Bootstrap braucht auf dem Anwendungsschema
`SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES` sowie
`TRIGGER` für den neuen Auditvertrag; für
Metadaten-/Verifikationsabfragen entsprechende Leserechte. Schemaweite
`CREATE`-Rechte sind für eine bereits bereitgestellte Datenbank ausreichend;
serverweite Datenbankanlage ist optional und sollte der Betreiber separat erledigen.
`DB_MIGRATION_USER` und `DB_MIGRATION_PW` können als gemeinsam gesetztes Paar einen
eigenen Bootstrapaccount auswählen, einschließlich einer gegebenenfalls erforderlichen
Datenbankanlage. HTTP, Sessionstore, Worker und Probes verwenden weiterhin `DB_USER`
und `DB_PW`; Host, verifiziertes TLS und Verbindungsbudget bleiben gemeinsam. Ohne
das Paar wird der bisherige gemeinsame Account verwendet. Der Runtimeaccount
braucht DML-/Metadatenrechte; die Triggerprüfung benötigt unter MySQL zusätzlich
`TRIGGER` auf der Audittabelle. Dieses Recht erlaubt auch Trigger-DDL und ist ein
ausdrücklicher Privilegienkompromiss. Tatsächliche eingeschränkte Grants, Bootstrap,
Neustart und Readiness müssen mit den Zielaccounts geprüft werden; die implementierte
Accountauswahl allein belegt diesen Betriebsnachweis noch nicht.
Backups brauchen `SELECT`, `SHOW VIEW`, `TRIGGER`; mit
`--single-transaction --no-tablespaces --set-gtid-purged=OFF` werden zusätzliche
LOCK-/PROCESS-/GTID-Anforderungen vermieden. Nicht genutzte Events und Routinen
werden bewusst nicht mitgesichert; falls sie außerhalb des Repositories existieren,
müssen sie zunächst inventarisiert und ins Verfahren aufgenommen werden.

Der globale Verbindungsrahmen umfasst HTTP, Sessions, Worker, Bootstrap und Probes.
Die Budget-Snapshotwerte `active`, `queued`, `limit`, `queueLimit`, `acquired`,
`rejected`, `acquireTimeouts`, `queryTimeouts`, `transactionTimeouts`,
`cancellationFailures` und `quarantined` müssen gegen
`max_connections`, Replikazahl und Betreiberreserve dimensioniert werden. Das Standardbudget von 12 umfasst 11 Arbeitsverbindungen
und eine serielle Kontrollverbindung. Ein SQL-Timeout gibt den Arbeitsslot erst
nach bestätigtem Ende des DB-Threads frei; fehlgeschlagener Abbruch hält ihn
in Quarantäne. Eine
Warteschlange ist kein Ersatz für ausreichende Kapazität. Compose begrenzt
standardmäßig 768 MiB, 1 CPU, 256 Prozesse und 64 MiB temporären Speicher;
`APP_MEMORY_LIMIT` und `APP_CPU_LIMIT` nach dem Lasttest einstellen.

## Releaseidentität und verbindliche Gates

Der CI-Lauf auf dem endgültigen Commit enthält diese erforderlichen Jobnamen:

- `Unit tests (Node 22)` und `Unit tests (Node 24)` einschließlich Syntaxprüfung
- `MySQL integration tests`
- `Playwright end-to-end tests`
- `Production dependency audit`
- `Build and scan release image`
- `CodeQL security gate`
- `Release gate`

Der letzte Gate-Job läuft auch bei Fehlern und lehnt fehlende, abgebrochene und
übersprungene Abhängigkeiten ab. CodeQL ist Bestandteil desselben CI-Laufs und
prüft zusätzlich die SARIF-Ergebnisse auf hohe Sicherheitsbefunde. Ein erfolgreich
hochgeladener Analysebericht ist allein kein grünes Security-Gate. Der separate
geplante CodeQL-Lauf ersetzt kein Release-Gate.

CI baut genau ein `linux/amd64`-OCI-Archiv mit SBOM und BuildKit-Provenance.
Trivy scannt dieses Archiv einschließlich nicht behobener HIGH/CRITICAL-Befunde.
Der Archivverifier prüft sämtliche referenzierten Blob-Digests und Größen,
Image-Config-ID, Betriebssystem- und npm-Paketabdeckung sowie den Scanbefund.
`release.json` bindet Commit, OCI-Digest, Archiv-SHA256 und CI-Lauf. Source-SHA,
Archiv-Prüfsumme und Image-Digest sind drei verschiedene Identitäten.

Der manuell aufzurufende Workflow `Publish verified release image` benötigt
CI-Run-ID, den vollständigen Commit und den überprüften Image-Digest. Er setzt
`production-release` als GitHub-Environment voraus. Dessen erforderliche Reviewer
und Beschränkung auf `main` müssen tatsächlich eingerichtet sein; ein
Environmentname im YAML aktiviert keinen Reviewschutz. Der Workflow verifiziert
alle Jobs des aktuellen CI-Versuchs, Main-Zugehörigkeit, Artifact-ID und GitHub-
Archivdigest und lädt das bestehende Archiv. Er baut kein Image.

`skopeo copy --all --preserve-digests` überträgt das Archiv einschließlich
Attestierungsmanifeste unter dem SHA-Tag. Der Workflow vergleicht den Rohmanifest-
Digest aus der Registry anschließend mit dem geprüften Digest. Erst danach wird
dieser Digest mit Cosign signiert und mit den Gate-Nachweisen attestiert.
Kein beweglicher `latest`-Tag wird erzeugt. Bei abgelaufenem CI-Artefakt muss CI
vollständig erneut laufen und der neue Build-Digest überprüft werden.

Die erwartete Schlüssel-los-Signaturidentität lautet:

```text
https://github.com/pllanaio/segnitz-rental/.github/workflows/docker-publish.yml@refs/heads/main
```

OIDC-Issuer: `https://token.actions.githubusercontent.com`. Signaturprüfung:

```sh
cosign verify --certificate-identity \
  https://github.com/pllanaio/segnitz-rental/.github/workflows/docker-publish.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  "$SEGNITZ_IMAGE"
```

Die OCI-Export- und Digest-Erhaltungsmechanik folgt der
[Docker-Dokumentation](https://docs.docker.com/build/exporters/oci-docker/) und dem
[Skopeo-Vertrag](https://github.com/podman-container-tools/skopeo/blob/main/docs/skopeo-copy.1.md).
Die tatsächliche Registry-Kompatibilität, SBOM-/Provenance-Präsenz und Signatur
sind erst durch einen ausgeführten Releaseworkflow belegt.

## Kontrolliertes Update und Recovery

1. Alle Gates des endgültigen Commits, Artefakt/Scan, Signatur, Backup- und
   Restoreprobe sowie Betreiberfreigaben prüfen. Änderungen an Migrationen und
   Schema auf Rückwärtskompatibilität zum vorherigen Image prüfen.
2. Den aus `release.json` geprüften Wert
   `SEGNITZ_IMAGE=pllanaio/segnitz-rental@sha256:<64 Hexzeichen>` setzen.
   Compose hat keinen `latest`-Default. Vorherigen Digest und aktuellen
   Migrationsstand im privaten Änderungsprotokoll sichern.
3. Lesenden Preflight ausführen: `node scripts/ops/preflight.js /sicher/release.json`.
   Dies prüft die Digestbindung, Compose und Cosign; es startet oder aktualisiert
   nichts. Proxy-/DNS-/Secrets-/CA-Prüfung und Wartungsfreigabe ergänzen.
4. Nach gesonderter Betriebsfreigabe: Schreibzugriffe am Proxy sperren, aktive
   Requests und Outbox drainen, App/alle Replikas stoppen, konsistentes Backup
   erstellen. Keine Volumes löschen. Eingehende Webhooks müssen wiederholbar
   zurückgewiesen/zwischengespeichert werden; vor Öffnung Reconciliation durchführen.
5. Erst autorisiert `docker compose pull app` und
   `docker compose up -d --no-deps app` ausführen. Schema-/Migrationsfehler stoppen
   den Start; niemals Tabellen resetten, um den Start zu erzwingen.
6. `node scripts/ops/preflight.js /sicher/release.json https://<freigegebener-host>`
   prüft `/live` und `/ready` mit je 3 Sekunden Deadline. Zusätzlich den
   freigegebenen fachlichen Smoke-Ablauf ausführen: Lesen, Anmeldung,
   Verfügbarkeit, bestehender Auftrag, private Rückgabebilder und Finanzsaldo.
   Keine echte Testzahlung/-erstattung/-mail ohne gesonderte Freigabe.
7. Bei Fehlern Wartungssperre erhalten. Vorherigen Digest nur starten, wenn dessen
   Schema-/Migrationsvertrag den neuen DB-Stand unterstützt. Andernfalls vorwärts
   korrigieren oder nach expliziter Wiederherstellungsfreigabe vollständigen
   konsistenten Stand in neue Ressourcen restoren und umschalten. Keine
   automatischen Downgrades, kein `down -v`, kein Zurücksetzen einzelner Tabellen.

`/live` ist eine schnelle Prozessprobe vor Sessions/Geschäftsmiddleware; `/ready`
liefert bei DB-/Schemastörungen zeitlich begrenzt 503. Readinessfehler allein dürfen
keine Wiederholung destruktiver Initialisierung auslösen. Shutdown drainiert HTTP,
Worker, Timer und Verbindungen innerhalb der harten Deadline.

## Logging, Metriken und Alarmierung

`services/observability.js` liefert JSON-Zeilen mit UTC-Zeit, Level, Ereignis und
servergenerierter Request-ID. Die ID steht auch in `X-Request-ID`. Die Loggergrenze
verwendet die gemeinsame Secret-Redaction plus Umgebungssecret-, E-Mail-,
SQL-/Error-, Daten-URL- und Größenbegrenzung. URLs mit Querystrings, Cookies,
Requestbodies, Signaturen und Mailpayloads gehören nicht in Zugriffslogs.
Operatorlogs ebenfalls zugriffsbeschränken und nach bestätigter Policy aufbewahren.

Erfolgreiche authentifizierte Adminmutationen erzeugen weiterhin eine nicht
sensible HTTP-`admin.mutation.receipt`. Für die ausdrücklich angebundenen Finanz-
und Mietmutationen schreibt `commitAdminMutation(connection, req)` zusätzlich
**innerhalb derselben bestehenden Transaktion vor COMMIT** einen dauerhaften
`admin_mutation_events`-Datensatz. Schlägt die Auditaufnahme fehl, wird die gesamte
Änderung zurückgerollt. Der schreibgeschützte Transaktionsmarker verhindert einen
versehentlichen Aufruf im Autocommitmodus.

Das Ereignis enthält die stabile Administrator-ID/Referenz, die aktuell nochmals
geprüfte Rolle/Authversion, serverseitige Request-ID, Aktion, Auftrag/Position und
den gesperrt gelesenen **resultierenden** Finanz-/Mietzustand. Geldwerte und
Ledgergruppen werden als exakte Cent-Strings protokolliert. Namen, Adressen,
E-Mailadressen, Signaturen, Foto-/Mailinhalte, Bemerkungen, Provider-/Auth-Tokens und
freie Requestdaten sind ausgeschlossen. Es wird kein unbelegtes Vorher-Bild
erfunden. Die HTTP-Receipt allein ersetzt den dauerhaften Ereignisdatensatz nicht.

Die neue unveränderliche Migration `20260913_03_admin_audit` ergänzt die Tabelle
und zwei MySQL-Trigger, die UPDATE und DELETE ablehnen. Es gibt keine kaskadierenden
Fremdschlüssel; das Ereignis überlebt eine spätere fachlich genehmigte Löschung des
Benutzers oder Auftrags. Readiness kontrolliert Namen, Anzahl, Ereignis, Zeitpunkt
und Body der Trigger. Migration und Leseverifikation benötigen die in der tatsächlichen
MySQL-Topologie erforderlichen `TRIGGER`-/Metadatenrechte. Bei aktiviertem Binarylog
können zusätzliche DDL-Definerrechte erforderlich sein; mit dem DBA vorab prüfen,
keine globale Serveroption automatisch lockern. Der Runtime-Account soll keine
DROP-/TRUNCATE-Rechte erhalten. Ein privilegierter DBA kann Schema/Trigger verändern;
diese Betriebsrechte bleiben geschützt und auditpflichtig. Eine spätere Löschung
von Auditereignissen benötigt eine eigens genehmigte Aufbewahrungsregel.

Die genaue Routenzuordnung und lokale Rot-/Grünnachweise stehen in
[evidence-admin-audit.md](evidence-admin-audit.md).
Alle fünf Audit-Transaktionstests bestanden tatsächlich auf MySQL in
[CI 34755684618](https://github.com/pllanaio/segnitz-rental/actions/runs/34755684618)
für Snapshot `b7c59008e231f666fac137c47bb195447afc4b2e`. Die vollständige
Freigabe bleibt an sämtliche Gates desselben endgültigen Commits gebunden.

`GET /admin/operations-metrics` ist nur für `global_admin`, mit `no-store`, gedacht:
HTTP-Anzahl/Fehler/Abbrüche/Latenzbuckets/In-flight, DB-Budget/Timeouts, Worker-
Fortschritt, Outboxzustände/Alter, offene Zahlungen, freier Platz beider Bildvolumes
und Backupfrische. Es gibt kein unauthentifiziertes öffentliches Metrikendpoint.
`BACKUP_EVIDENCE_PATH` kann auf eine schreibgeschützt gemountete, unsensible
Backupstatusdatei zeigen. Fehlende Evidenz wird als unbekannt ausgegeben.

`docs/monitoring.example.json` ist eine konfigurierbare Vorlage für den vorhandenen
Betreiber-Monitor. `targetRef` und `backupMaxAgeSeconds` sind absichtlich nicht
vorausgefüllt. Andere Schwellen sind technische Startwerte, keine zugesicherten
SLOs. Evaluieren zweier privater Snapshots:

```sh
node scripts/ops/check-alarms.js /sicher/monitoring.json /sicher/current.json /sicher/previous.json
```

Exit 0: kein Alarm; 2: Alarm; 1: Auswertung fehlgeschlagen. Die Auswertung sendet
keine Nachricht. Alarme für HTTP-Fehler/Latenz, DB-Timeouts/Queueabweisung,
Outboxalter/-backlog/dead, fehlenden Workerfortschritt, Storage, fehlendes RPO,
Backupfrische und nicht belegte Restoreprobe sind vorbereitet. Der Betreiber muss
Poller, sicheren Authzugang, Zeitreihenspeicherung, Empfänger und Probealarm
anschließen und bestätigen. Aggregierte Zähler sind pro Prozess; mehrere Replikas
getrennt sammeln und für denselben Zeitraum aggregieren.

Vorgeschlagenes isoliertes Lastprofil: 10 Minuten Aufwärmung, 30 Minuten mit
20 gleichzeitigen Clients (70 % Produkt-/Verfügbarkeitslesen, 20 % eigene Aufträge,
10 % isolierte Warenkorb-/Adminmutationen), anschließend 5 Minuten mit 80 Clients.
Zusätzlich DB-Locks/Verbindungsausfall und langsame isolierte Provider simulieren.
Messen: p50/p95/p99, Fehlerquoten, Heap/RSS, Pool/Queue/Timeouts, Outboxalter,
verwaiste Uploads und Wiederherstellung nach Entlastung. Erwartung: gesetzte
Limits werden eingehalten, Überlast wird kontrolliert 429/503, `/live` bleibt
ansprechbar, keine Doppelbelegung/-zahlung und kein Leak nach Recovery.
Das Profil ist hier dokumentiert; eine bestandene Ausführung ist nicht behauptet.

## Outbox-Triage, Reconciliation und Replay

Die Bestellbestätigung bewahrt den Finanzstand ihrer ersten Vormerkung als
unveränderlichen Beleg. Solange Mailversand pausiert, dürfen nachfolgende
Zahlungs-/Refundabgleiche ihren Payload und Hash nicht neu erzeugen. Der Versandstatus
bleibt dabei unverändert: ein vorhandener `pending`- oder `dead`-Job wird nicht
als versandt erklärt oder durch einen neuen Job ersetzt. Aktuelle Forderungen
stehen in den aktuellen Auftragsansichten; ein fehlgeschlagener ursprünglicher
Bestätigungsjob benötigt den unten beschriebenen autorisierten Triageweg.

`node scripts/ops/triage.js [afterId]` liest höchstens 50 offene Jobs pro Seite und
Statusaggregate. Es gibt ausschließlich numerische Job-IDs, Typ, Zustand,
Versuchsanzahl und Zeitpunkte aus, keine Operationsschlüssel, Fehlertexte,
Mailpayloads oder Tokens. `nextAfterId` dient der Pagination. Die CLI mutiert nichts.

Für jede hängende Operation:

1. Wartungszustand und Lease-/Workerfortschritt prüfen. Pausierte E-Mail ist
   vorgemerkt; `succeeded` bedeutet vom Adapter als versandt verarbeitet, nicht
   nachgewiesene Postfachzustellung. `dead` ist fehlgeschlagen/klärungsbedürftig.
2. Auftrag, lokale Zahlungsabsicht, Providerressourcen-ID, Betrag/Währung und
   vorhandenen unveränderlichen Idempotenzschlüssel im berechtigten Adminzugriff
   abgleichen. Keine sensiblen Metadaten in Supporttickets kopieren.
3. Bei Mollie zuerst Zahlung, Refunds und Chargebacks samt Folgeseiten lesen.
   Erfolg beim Provider vor verlorener DB-Commit ist lokal zu reconciliieren;
   keinen neuen Zahlungsvorgang mit neuem Schlüssel erzeugen. Die gemeinsamen
   Zustandsmaschinen verhindern Regressionen settled Zustände.
4. Erst nach dokumentierter Einzelprüfung und Autorisierung den vorgesehenen
   fachlichen Retry auslösen. Job-ID und finanzielle Operationsschlüssel erhalten;
   weder Outboxzeilen löschen noch pauschal `dead`/`succeeded` auf `pending` setzen.
5. Microsoft Graph garantiert für diesen Ablauf kein unbelegtes exactly-once.
   Bei unklarem Sendestatus Draft-/Message-ID und Mailboxverlauf abgleichen. Nach
   Providererfolg verlorene lokale Bestätigung kann sonst doppelte Mail erzeugen.
   Für unauflösbare Zustände bewusste Betreiberentscheidung statt blindem Replay.

## Konsistentes verschlüsseltes Backup

Die bestehenden Daten werden nicht bereinigt oder geseedet. Eine Datei allein
belegt kein wiederherstellbares Backup. Der folgende Helfer setzt MySQL-8-Clients,
Docker CLI, Python 3.12+ und `age` auf einem vom Betreiber kontrollierten Host
voraus. Die Betreiberablage kann erhalten bleiben; es wird kein Anbieter eingerichtet.

1. Wartung genehmigen. Den Reverse Proxy für Mutationen sperren, alle App-Replikas,
   Worker und sonstigen DB-/Uploadschreiber drainen und stoppen. Nur ein
   Betreiber kann zusätzliche externe Schreiber ausschließen. Der Helfer prüft,
   dass die gefundenen Compose-App-Container gestoppt bleiben; er stoppt nichts.
2. Beide vorhandenen Volumes an lesenden Pfaden verfügbar machen. Die DB per
   privater MySQL-Client-Optiondatei adressieren (0600), nicht per Passwortargument.
   Verschlüsseltes Scratch-Dateisystem für temporären Klartext bereitstellen.
3. Den Helfer erst mit den realen freigegebenen Pfaden ausführen:

```sh
python3 scripts/ops/backup_restore.py backup \
  --client-config /sicher/mysql-backup.cnf --database segnitz_rental \
  --compose-project segnitz-rental \
  --products /sicher/volumes/product-images --returns /sicher/volumes/return-images \
  --temp-directory /verschluesselt/tmp --recipients /sicher/backup-recipients.txt \
  --output /sicher/backups/segnitz-20260913.age
```

Der Helfer erzeugt einen konsistenten transaktionalen SQL-Dump, kopiert beide
Bildbäume, vergleicht alle Datei-Hashes vor/nach Kopie, prüft die gestoppten Apps
erneut und verschlüsselt das gemeinsame Archiv mit `age`. Symlinks/Spezialdateien,
veränderte Bilder und bestehende Ausgabedateien werden abgelehnt. Das Manifest
enthält SQL-/Bild-Hashes. Die kleine Statusdatei markiert `restoreVerified:false`.
Backupverschlüsselung schützt die Dateiablage; Klartext im temporären Speicher
braucht trotzdem ein verschlüsseltes Dateisystem und private Rechte.

Erfolgreiche Backup-Erstellung im Betreiberprotokoll mit Zeitpunkt, verschlüsseltem
Hash und Quellstand notieren. Erst nach abgeschlossenem Restore-/Anwendungstest
darf der separat geführte Backupstatus eine belegte Restoreverifikation erhalten.
Retention nicht automatisch implementieren, bevor Datenklassen und Fristen
verbindlich freigegeben sind.

## Isolierte Wiederherstellungsprobe

Eine **neue**, nur lokal gebundene MySQL-Testinstanz und neue Bildverzeichnisse
bereitstellen. Sie darf keine Produktionsdatenbankverbindung, Secrets oder
Netzwerkroute zu Mollie/Graph besitzen. Die spätere App muss zusätzlich im
expliziten Testmodus mit isolierten Adaptern und ohne echten Workerdispatch laufen.
Ein Docker-Netz `internal: true` ohne zusätzliche Egress-Verbindung ist ein
mögliches Betreiberverfahren; Adapterflags allein sind keine Netzisolation.

```sh
python3 scripts/ops/backup_restore.py restore-probe \
  --client-config /sicher/mysql-restore-test.cnf \
  --database segnitz_restore_probe_20260913 --port 3307 \
  --backup /sicher/backups/segnitz-20260913.age --expected-sha256 <hash-aus-vertrauenswuerdigem-katalog> \
  --identity /sicher/backup-identity.txt \
  --temp-directory /verschluesselt/tmp --destination /sicher/probes/20260913
```

Vor Entschlüsselung muss der Archivhash mit einem unabhängig vertrauenswürdigen
Backupkatalog übereinstimmen. age-Verschlüsselung allein authentifiziert nicht den
Absender; den erwarteten Hash nicht ungeprüft aus einem neben dem Archiv
angelieferten fremden Manifest übernehmen. Die lokale MySQL-Instanz muss
ausschließlich für die Probe verwendet werden.

Der Restore überschreibt den DB-Host zwingend mit `127.0.0.1`. Nur Namen
`segnitz_restore_test_*`/`segnitz_restore_probe_*` sind zulässig; `CREATE DATABASE`
ohne `IF NOT EXISTS` lehnt jeden bestehenden DB-Namen ab. Zielverzeichnisse müssen
neu sein. Archivpfade/Typen und alle Hashes werden vor dem Import geprüft.
Unvollständige Probeziele bleiben zur Diagnose bestehen; kein automatisches DROP.
Der Helfer startet weder App noch Worker und kontaktiert keine Provider.

Mit den isolierten DB-Umgebungswerten danach:

```sh
node scripts/ops/verify-restore.js /sicher/probes/20260913/products /sicher/probes/20260913/returns
```

Der lesende Prüfer kontrolliert den kanonischen Schema-/Migrationsvertrag,
Bildreferenzen und vorhandene Dateien, decodierte Bild-/Signaturinhalte, Ledgeraggregate und
Outboxzustände. Er nimmt keine Migration vor. Ein älterer Snapshot muss zunächst
im isolierten Probeablauf mit dem dazu passenden geprüften Image geöffnet bzw.
nach freigegebenem Migrationsplan aktualisiert werden; Drift wird nicht repariert.
Sharp decodiert alle Pixel und prüft Format, Einbildigkeit, Byte-/Pixelgrenzen
und eine Frist von fünf Sekunden je Bild. Bilder sind auf 5 MiB/16 Millionen
Pixel begrenzt, Signaturen auf 750.000 Byte/2 Millionen Pixel. Keyset-Batches
von 25 Datensätzen und höchstens zwei parallele Decoder begrenzen den Speicher;
mehr als 100.000 Referenzen je Tabelle oder 15 Minuten je Tabellendurchlauf
brechen ausdrücklich ab. Größere historische Bestände brauchen einen separat
reviewten Prüfplan; eine abgebrochene Teilprüfung gilt nicht als erfolgreich.
Eine visuelle Prüfung der fachlichen Beweiskraft ersetzt der Decoder nicht.

Anschließend App unter nachgewiesener Anbieter-Netzisolation starten und den
fachlichen Smoke-/Playwright-Ablauf mit ausschließlich synthetischen Mutationen
auf der Probe ausführen: Anmeldung, eigene/fremde Aufträge, übereinstimmende
Finanzbeträge, private Bilder, Signaturdarstellung, Belegung, Retouren. Bei echten
Kopien keine Kundenbilder/Signaturen in Browserberichte oder Screenshots exportieren.
Restore-, Prüf- und Startdauer sowie Ergebnisse messen und gegen RPO/RTO bewerten.
Der Helfer setzt `applicationSmokeVerified:false`, bis dieser Nachweis vorliegt.

Die ausführbare synthetische CI-Probe bindet den Nachweis an das bereits gebaute
Release-Image. Voraussetzungen: Docker, Python 3.12+, MySQL-8-Clients, `age` und
`age-keygen`; der Checkout und das OCI-Label `org.opencontainers.image.revision`
müssen exakt denselben vollständigen Commit bezeichnen:

```sh
python3 scripts/ops/rehearse_restore.py \
  --image "$CANDIDATE_IMAGE" --expected-revision "$GITHUB_SHA" \
  --evidence restore-rehearsal.json
```

Der Aufruf akzeptiert keine bestehende Datenbank oder Volumes. Er erstellt einen
MySQL-Container mit gepinntem Digest, zwei neue Quellbildverzeichnisse, neue
`segnitz_restore_test_*`-Datenbanken und ein internes Docker-Netz ohne Providerzugang.
Nur synthetische Nutzer, ein abgewickelter Auftrag, drei Ledgerbuchungen, zwei
Bilder, eine Signatur und eine pausierte Mail werden angelegt. Das gewöhnliche
`server.js` startet das Quellsystem und wird vor dem Backup regulär beendet;
der bestehende Backuphelfer prüft seine tatsächlichen gestoppten Writercontainer
vor und nach dem Dump. Die Probe umgeht diese Wartungsprüfung nicht.

Das mit einer temporären age-Identität verschlüsselte Archiv wird anhand seines
frisch ermittelten vertrauenswürdigen Hashes in neue Zielressourcen eingespielt.
Der identische Kandidat prüft Schema, Migrationen und decodierte Bilddaten,
startet die restaurierte App und verifiziert `/ready` mit/ohne Session, Login,
Eigentumsgrenzen, privates Rückgabebild sowie identische Kunden-/Adminfinanzsalden.
Die pausierte Mail muss unversandt und ohne verbrauchten Versuch erhalten bleiben.
Erst dann setzt der JSON-Nachweis `restoreVerified` und `applicationSmokeVerified`
auf `true`, mit Image-ID, Repo-Digests, Commit, Archivhash und gemessener Laufzeit.
Ops-Helfer bleiben aus dem Produktionsimage ausgeschlossen und werden für die
Probe ausschließlich lesend aus demselben Checkout eingebunden. Die Aufräumphase
entfernt nur Container-IDs und Verzeichnisse, die dieser Lauf selbst angelegt hat.
Standard ist `/dev/shm`; diese flüchtigen Daten sind ausschließlich synthetisch.
Kein Nachweis für die Größe, Entschlüsselbarkeit oder RTO eines Betreiberbackups
wird aus dieser kleinen Probe abgeleitet. Produktive Trigger-DEFINER und deren
Rechte sind beim echten Restore gesondert zu prüfen; der Dump wird nicht umgeschrieben.

Eine echte Wiederherstellung braucht zusätzlich den Abgleich seit dem
Snapshot beim Provider ausgeführter Zahlungen, Refunds, Chargebacks und Mails.
Restored-Outbox zunächst angehalten lassen. Vor Öffnung Reconciliation pro
stabiler Provider-ID/Idempotenzschlüssel und zeitlichem Abgleich durchführen.
Ein älterer DB-Stand darf keine bereits ausgeführten externen Effekte erneut
produzieren. Danach erst kontrolliert Worker und Buchungen wieder freigeben.

## Datenklassen und Aufbewahrung

| Datenklasse | Schutz / vorläufiges Verhalten | Fehlende Freigabe |
| --- | --- | --- |
| Sessions, Authversionen, Reset-/Verifikationstokens | Ablauf, Hash/Einmalverbrauch, gezielter Widerruf; keine Klartexttokens in Logs | Operative Log-/Session-Retention bestätigen |
| Ausstehende Auth-Mailpayloads | Klartextlinks sind für Versand nötig; restriktiver DB-/Backupzugriff, bei Abschluss redigieren | Maximale Pending-/Dead-Aufbewahrung und Eskalation bestätigen |
| Kunden-/Adressdaten | Eigentums-/Rollenprüfung; keine Demo-Ersetzung | Zweckbezogene Lösch-/Anonymisierungsregeln freigeben |
| Auftrag, Ledger, Rechnung, Providerbelege | Finanzielle Integrität und Idempotenz erhalten | Verbindliche Aufbewahrung und externer Rechnungsprozess |
| Signaturen, Rückgabe-/Schadenfotos | Privat, zugriffsbeschränkt, nicht in Logs/Testberichten | Beweisfristen, Zugriff, rechtliche Sperren |
| Produktbilder | Bestand inventarisieren, referenzierte Dateien bewahren | Verwaiste Dateien erst nach geprüfter Referenz-/Retentionregel löschen |
| Audit-/Operationslogs | Redaction, Zugriffsschutz, begrenzte Rotation | Aufbewahrung, Archivierung, Empfänger |
| Backups | Verschlüsselt, Schlüssel getrennt, überprüfte Wiederherstellung | Retention, Standorte, RPO/RTO und Löschung abgeleiteter Kopien |

Es wird keine automatische Löschung oder Anonymisierung von Geschäfts-/Beweisdaten
aktiviert, bevor die verbindliche Regel feststeht. Technische Outbox-Retention darf
finanzielle Deduplizierungs-/Providerbelege nicht vernichten. Neue Installationen
enthalten keine Demo-Kunden, -Aufträge oder -Zahlungen; vorhandene Daten werden
nur inventarisiert.
