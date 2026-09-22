# Operations- und Release-Nachweise

Stand: 13.09.2026. Isolierter Arbeitsbranch
`codex/rc-operations-20260913`, Ausgangscommit
`1382a95444be15f692f4a8800ab521b11c3d4683`. Keine Produktionszahlung, E-Mail,
Löschung, Migration, Sicherung, Wiederherstellung, Einstellung, Veröffentlichung
oder Deployment wurde durchgeführt. Integrierte Nachweise stehen im
[production-readiness.md](production-readiness.md).

## Befund → Umsetzung → Verhaltenstest → Ergebnis → Restpunkt

| Befund | Umsetzung | Tatsächlicher Test / Ergebnis | Noch benötigter Nachweis |
| --- | --- | --- | --- |
| Publish baute neu und wartete nur auf CI, separates CodeQL | CodeQL im CI-DAG; finales Gate; manuelle Publikation des bestehenden OCI-Artefakts; alle Jobs auf aktuellem Main-Push-SHA geprüft | Gate-Verhalten grün für fehlende/rote/abgebrochene/übersprungene Jobs, falschen Commit/Branch/Repository/Workflow und grünes CI mit rotem CodeQL | Vollständiger GitHub-Lauf auf endgültigem Commit |
| Keine Bindung des gescannten an veröffentlichtes Image | OCI-Digest, Blob-Hashes/Größen, ImageConfig-ID, Archivhash und Actions-Artifact-Digest geprüft; `skopeo --all --preserve-digests`; Remote-Digestvergleich vor Signatur | Reale Artifact-CLI mit ausschließlich synthetischem OCI-Archiv: korrektes Archiv angenommen, manipulierte/fehlende Layer und leerer Scan abgelehnt | Echter Build/Trivy-Report, finaler Image-Digest, Registry-Kopie, Signatur/SBOM/Provenance |
| Ein Analyse-Upload allein beweist keinen grünen CodeQLbefund | SARIF-High/Error-Gate mit Struktur-/Metadatenprüfung | High-SARIF-Warnung wird rot; leere/partielle Ausgaben, unbekannte Regel und ungültige Severity werden abgelehnt | Echte CodeQL-SARIF-Ausgabe des finalen Commits und kompatible Action-Ausführung |
| Releaseverifier nahm im Review `{Results:[{}]}` an | Image-ID und Alpine/npm-Paketinventare erforderlich; direkte App-Pakete müssen vorhanden sein | Reviewer reproduzierte vor Fix ein falsch grünes echtes CLI-Ergebnis mit unvollständigem Archiv; neue CLI-Regressionsprüfung lehnt genau diese Klassen ab | Realer Trivy-JSON-Vertrag im CI muss grün verifiziert sein; kein simuliertes Scanergebnis als Securityfreigabe |
| Unstrukturierte Logs / sensible Schlüssel | Strukturierte JSON-Grenze, gemeinsame Authredaction plus Umgebungssecret-/E-Mail-/SQL-/Daten-URL-Filter, begrenzte Payloads | Echte HTTP-Verbindung prüft Request-ID und Adminreceipt ohne Cookie, Querytoken, Body oder E-Mail; verschachtelte/Error-Redaction grün | Middleware/Worker im Gesamtbranch integrieren; komplette Frontend-/Providerfehlerpfade unter echten APIs prüfen |
| Betriebszustand/Alarme nicht ausreichend sichtbar | Privater Adminmetrics-Handler mit HTTP/DB/Outbox/Finanz/Worker/Storage/Backup; konfigurierbare lokale Alarmauswertung | Berechtigungsablehnung, unbekannte Backupfrische und konkrete Alarmdeltas für HTTP/DB/Outbox/Storage/Backup grün | Tatsächliche DB-Snapshots, Poller/Alarmempfänger, Probealarm und Lastprofil |
| Auditierbare Adminänderung | Zusätzlich zu HTTP-Receipts nun transaktionale unveränderliche AFTER-Ereignisse für die Finanz-/Mietrouten; Insertfehler verhindert den Finanzcommit | 9 neue Unit-Verhaltenstests und tatsächlich fünf MySQL-Audittests in CI 34755684618 auf Snapshot b7c59008 grün; siehe [evidence-admin-audit.md](evidence-admin-audit.md) | Vollständiges Gate des endgültigen Commits und tatsächliche Auditgrants; es gibt bewusst kein erfundenes Vorher-Bild |
| Mutable `latest` als Compose-Default | Bildreferenz und Proxyentscheidung verpflichtend; Preflight fordert exakten geprüften Digest; Ressourcenlimits | Preflight lehnt Tag, anderes Repository, anderen Digest, 503 Readiness und ungeschütztes Remote-HTTP ab | Ausführung von Compose/Cosign gegen Zielkonfiguration; verifizierte Proxytopologie |
| Kein nachgewiesenes konsistentes DB+Datei-Restoreverfahren | Ausführbare Offline-Backup-/Restore-/Verifikationshelfer und Runbook; age, private Credentialdatei, gestoppte App, stabile Dateiinventare, ausschließlich neue lokale Probeziele | Fünf Python-Verhaltenstests mit temporären synthetischen Dateien: DB-Namensgrenzen, Symlinks, private Dateirechte, Archiv-Traversal/Links/Duplikate, intakter/korrupt gemachter SQL+2-Volume-Roundtrip | Echter verschlüsselter Dump + neue isolierte MySQL-/Bildressourcen + Appstart/Smoke, gemessene Wiederherstellung, Provider-Netzisolation, Betreiber-RPO/RTO/Retention/Schlüssel |
| README/SECURITY widersprachen CSP, Zeiten und Veröffentlichung | Aussagen korrigiert; Release/Backup/Recovery und externe Freigaben verlinkt | Diffprüfung und Syntax-/YAML-Parsing | Betreibertexte/Grants/Topologie tatsächlich prüfen |

Die synthetischen OCI-/Tar-Tests sind Verhaltenstests der Verifier. Sie sind
weder ein echter Containerbuild noch ein Mollie-/Graph-/MySQL- oder
Backupverschlüsselungsnachweis.

## Ausgeführte Befehle

Im isolierten Checkout ausgeführt:

```sh
git status --short
git branch --show-current
git rev-parse HEAD
node --test test/release-gate.test.js test/release-artifact.test.js test/operations.test.js test/backup-restore.test.js
python3 test/backup-restore.test.py
node scripts/check-syntax.js
git diff --check
```

Focused Node-Nachweis am Ende des Operationspakets: **14 Tests, 14 bestanden,
0 fehlgeschlagen, 0 übersprungen**. Einer dieser Node-Tests startet die Python-
Hilfertests; die fünf Pythonfälle werden nicht als zusätzliche Node-Tests gezählt.
Python direkt: **5 Tests bestanden**. Syntaxzählung wird nach finaler
Integrationszusammenführung im Gesamtbranch angegeben; der abschließende Operationsdurchlauf
prüfte 97 JS-Dateien einschließlich der lokal für Zusammenarbeit übernommenen
Authredaction. YAML-Dateien wurden zusätzlich mit `python3` und
`yaml.safe_load` geparst: CI 7 Jobs, geplantes CodeQL 1, Publish 1. Dies ersetzt
keine Actions-Ausführung oder Actionlint-Prüfung.

`command -v docker` fand in dieser Umgebung keine Docker-CLI. Deshalb hier nicht
ausgeführt: Docker/BuildKit, Trivy, Skopeo/Registry-Kopie, Cosign/OIDC,
Live-Publish-Negativversuche, echte Dump-/age-/Restore-/MySQL-/Lastprobe und
Produktions-Preflight. Es gibt **keinen erzeugten oder geprüften Release-Image-
Digest**, keine Signatur und keine Restore-Zeit aus diesem Arbeitsbereich.

## Read-only GitHub-Prüfung am 13.09.2026

| Abfrage | Beobachtet | Bedeutung |
| --- | --- | --- |
| [Main-Branch](https://api.github.com/repos/pllanaio/segnitz-rental/branches/main) | Commit `1382a95444be15f692f4a8800ab521b11c3d4683`; `protected:false`; Schutz deaktiviert; Required Checks leer | Aktiver Branchschutz fehlt (Branchabfrage plus übereinstimmender Git-Fetch) |
| [Rulesets](https://api.github.com/repos/pllanaio/segnitz-rental/rulesets) | `[]` | Kein Repository-Ruleset nachgewiesen |
| [Repositorymetadaten](https://api.github.com/repos/pllanaio/segnitz-rental) | öffentlich; Default `main`; `security_and_analysis` nicht enthalten | Secret-/Security-Scanningstatus unbekannt, keine Ableitung „aus“ |
| Environment-/Vulnerability-Alerts-Endpoint | Connector lehnt Read-only-URL als nicht erlaubten Endpoint mit HTTP 400 ab | Einstellungen nicht verifiziert; kein Auto-Approval- oder Betreiberrechtefehler behauptet |
| [Offene PRs](https://github.com/pllanaio/segnitz-rental/pulls) | Elf offene Dependabot-PRs, unten einzeln eingeordnet | Kein PR wurde gemerged |

Konkrete Adminvorbereitung: [github-main-ruleset.proposed.json](github-main-ruleset.proposed.json)
enthält die vorgesehenen Checknamen, PR-/Reviewpflicht und Force-Push-/Löschschutz.
Vor Anwendung die Checkquelle jeweils ausdrücklich an die tatsächlich verwendete
GitHub-Actions-App binden (`integration_id` anhand der echten Checks ermitteln);
der Vorschlag behauptet keine schon gesetzte Quellbindung. Bypass bleibt leer.
Reviewer/CODEOWNERS müssen mit dem Betreiber vereinbart werden, deshalb wurde
kein Team erfunden. Produktionsenvironment `production-release`: Main-only,
independent required reviewer, Selbstreview aus, Registrysecret scoped. Danach
Branch-/Ruleset-/Environment-/Securityeinstellungen erneut lesend prüfen und
Negativfall (fehlendes Gate, frischer Push nach Approval, Force-Push/Löschung)
im dafür freigegebenen GitHub-Testverfahren nachweisen.

## Offene Dependency-PRs: einzelne Einordnung, kein Sammelmerge

| PR | Änderung | Umgang |
| --- | --- | --- |
| [#32](https://github.com/pllanaio/segnitz-rental/pull/32) | Multer 2.2.0 → 2.3.0 | Dieselbe gepatchte Version vom Dependencyarbeitspaket übernommen; Multipart-/Unitnachweise dort; PR selbst unverändert |
| [#33](https://github.com/pllanaio/segnitz-rental/pull/33) | mysql2 3.23.3 → 3.24.3 | Direktes 3.23.3 ist bereits gepatcht; verwundbares verschachteltes 3.10.2 per geprüftem scoped Override beseitigt; 3.24.3 nicht blind übernommen und Kompatibilität nicht behauptet |
| [#31](https://github.com/pllanaio/segnitz-rental/pull/31) | Node 24 → 26 | Passt nicht zum erklärten Node-22/24-Support; Majorwechsel separat entscheiden/testen |
| [#22](https://github.com/pllanaio/segnitz-rental/pull/22) | dotenv 16 → 17 | Majorupgrade separat prüfen; kein erforderlicher Fix dieser Findings |
| [#9](https://github.com/pllanaio/segnitz-rental/pull/9) | node-fetch 2 → 3 | CommonJS-/ESM-Vertrag muss vorher angepasst/geprüft werden; nicht gemerged |
| [#6](https://github.com/pllanaio/segnitz-rental/pull/6) | Express 4 → 5 | Routing-/Error-/Parservertrag separat regressionsprüfen; Stack bleibt bestehen |
| [#29](https://github.com/pllanaio/segnitz-rental/pull/29) | Buildx-Action 4.2 → 4.3 | Eigener Workflow-Kompatibilitätslauf fehlt; vorhandener SHA-Pin erhalten |
| [#26](https://github.com/pllanaio/segnitz-rental/pull/26), [#27](https://github.com/pllanaio/segnitz-rental/pull/27), [#28](https://github.com/pllanaio/segnitz-rental/pull/28) | CodeQL-Action 4.37.7 → 4.37.8 | Gemeinsam konsistente Init/Build/Analyze-Version erforderlich; vorhandener Pin erhalten, kein Kompatibilitätsnachweis erfunden |
| [#23](https://github.com/pllanaio/segnitz-rental/pull/23) | Trivy-Action 0.35 → 0.36 | JSON-/OCI-Scanvertrag separat mit echtem Archiv testen; vorhandener Pin erhalten |

## Freigabestatus dieses Arbeitspakets

Reviewbarer Code und lokal bestandene Verhaltensprüfungen sind vorhanden.
**Keine Produktionsfreigabe.** Es fehlen die tatsächlichen finalen CI-/Security-
/Container-/Digest-/Signaturnachweise, aktivierte GitHubschutzregeln, konkrete
Betreiberbedingungen und ein echter vollständiger Restore-/Last-/Alarmnachweis.
Diese externen Lücken entwerten die oben explizit ausgeführten lokalen Tests nicht.

## Tatsächliche Restore-Abnahme am 22.09.2026

[CI128 Build-/Restorejob](https://github.com/pllanaio/segnitz-rental/actions/runs/35765448580/job/106873703967) bestand einschließlich Trivy, SPDX-SBOM und SLSAv1-Provenance. Merge-Checkout `536a8cc383f565ad5e538954005b67fb34f0635a`, PR-Head `dc83e154cc054dbf5d77ea1f9be1350e8375da16`; Image-Index `sha256:26c5df7a981c92e4ff7cc59a582fcc365c5c6787f8a99e231b62143361cb0f7d`, OCI-Archiv SHA256 `76699a19d6612e9dba071efc54d885ca54489360c8ec07edc09eca211ff9ba09`.

[Unverändertes Restore-Ergebnis](evidence/restore-ci128.json), GitHub-Artefakt10712380398, heruntergeladenes ZIP gegen SHA256 `fd1a8d1b1d6454141cb012ede0a0c5e4b43f3a27e5f7e7ca01988b71a3562633` geprüft. Die synthetische Probe benötigte16,61 Sekunden; dies ist keine produktive RTO-Zusage. Tatsächlich geprüft:22 Tabellen/9 Migrationen,2 Bildreferenzen mit vollständigem Decode,1 Signatur, Ledger100 EUR Miete/150 EUR Kaution/150 EUR Refund, Quellwriter-Drain, verschlüsseltes Backup, neue Zieldatenbank/-bildverzeichnisse, Appstart, identischer Kunden-/Adminsaldo, privates Bild und fremder/anonymer Zugriffsschutz, Readiness mit/ohne Session. Die ausstehende Outbox blieb pausiert. Providerkontakt:false; alle eigenen Writer/Dateien bereinigt.

Echter DB-TLS-Nachweis: TLS1.3, SQL und UTC-Sitzung mit vertrauenswürdiger CA; Handshakeablehnung bei falscher CA und falschem Hostnamen, danach erneut erfolgreicher vertrauenswürdiger Verbindungsaufbau. Alle drei eigenen Container blieben ausschließlich im internen Docker-Netz; begrenzte hostseitige Loopback-Relays kompensieren dessen fehlende Port-Publikation. Keine Netzfreigabe zu externen Providern.

Offen bleiben produktive Volumengröße, Schlüsselverwahrung, Retention, RPO/RTO, tatsächliche Produktionsrechte/-topologie und die autorisierte Betreiberprobe. Keine produktive Wiederherstellung oder Imageveröffentlichung ausgeführt.
