# Produktionsreife: überprüfbarer Release-Kandidat

Stand: 13.09.2026. **Freigabestatus: gesperrt; Umsetzung und Abnahme laufen.**

## Ausgangszustand und Grenzen

- Repository: `pllanaio/segnitz-rental`, aktiver Startpfad `server.js`.
- Remote-`main` am 13.09.2026 über GitHub und `git fetch origin main` geprüft: `1382a95444be15f692f4a8800ab521b11c3d4683`.
- Isolierter Checkout, Branch `codex/production-readiness-20260913`; Ausgangsbaum sauber. Paralleländerungen entstehen auf getrennten Worktrees und werden gezielt zusammengeführt.
- Die zusätzliche `Segnitz-Rental-Produktionsanalyse.md` vom 13.09.2026 wurde vollständig gelesen. Befunde werden erst nach ausgeführter Prüfung als behoben markiert.
- Stack bleibt Node.js/CommonJS, Express, MySQL, statisches HTML/Bootstrap/Vanilla-JavaScript. Mollie, Microsoft Graph und persistente Outbox sind die aktiven externen Adapter.
- Kanonisches Ausgangsschema: 20 Tabellen, versionierte Migrationen mit Checksummen. Keine produktive DB, Providerkonten, Secrets, Volumes oder Deploymentkonfiguration geprüft oder geändert.
- Keine produktiven Zahlungen, E-Mails, Löschungen, Migrationen, Deployments, Secret-Rotationen, Merges oder Git-History-Rewrites autorisiert oder ausgeführt.

## Baseline auf unverändertem Basiscommit

| Befehl/Prüfung | Ergebnis | Aussagegrenze |
| --- | --- | --- |
| `node --version`; `npm --version` | Node 24.19.0; npm 11.9.0 | Zusätzlich isolierter Node 22.22.2 bereitgestellt |
| `npm ci --no-fund` | Exit 0; 127 Pakete installiert | Unverändertes Lockfile |
| `npm run check:syntax` | Exit 0; 83 JavaScript-Dateien | Syntax, kein Verhalten |
| `npm run test:unit` | Exit 0; 145 bestanden, 0 Fehler/Skips/TODO | Bestehende Unit-Abdeckung |
| `../test-runtime/node22/bin/node --test test/*.test.js` | Exit 0; 145 bestanden, 0 Fehler/Skips/TODO | Dieselbe Baseline unter Node 22.22.2 |
| `npm audit --omit=dev --audit-level=high --json` | Rot; 2 High, 4 Moderate, 0 Critical | Betroffene Pakete, nicht unabhängige CVE-Anzahl |
| `npm run test:integration` mit explizitem lokalen Testziel `127.0.0.1:33671/segnitz_rc_baseline_test` und isolierten Providerflags | Exit 1; 51 Fälle scheitern an Setup/Verbindung `ECONNREFUSED`, kein fachlicher Fall ausgeführt | Fehlende Infrastruktur ist weder Pass noch Codefehler |
| Playwright-Runtime-Smoke, unabhängige `data:`-Seite | Chromium 153.0.8010.0 startet und liest erwarteten Titel | Kein App-/E2E-Nachweis; vollständiger Ablauf benötigt MySQL |
| Dockerbuild / Container-Scan | Docker/Trivy bislang nicht verfügbar | Kein aktueller Digest-/Scan-Nachweis |
| GitHub Branch `main` | `protected: false`, erforderliche Checks aus | Adminabhängigkeit; nicht durch Dokumentation aktiviert |

Lokale Infrastrukturversuche: `apt-get update` scheitert an nicht verfügbaren `setgroups`/`seteuid`-Prozessrechten. Direkte HEAD-Anfragen an offizielle MySQL-CDN-/Repo- und Ubuntu-Snapshot-Downloads scheitern mit Proxy-CONNECT-Timeout. MySQL und Docker sind nicht vorhanden. Der reguläre Playwright-Browserdownload scheitert; ein separat installierter Chromium aus `@sparticuz/chromium@153.0.0` konnte lokal ohne Abschalten der Web-/CSP-Sicherheit gestartet werden. Diese ausschließlich temporären Testwerkzeuge ändern keine Anwendungsdependencies.

## Arbeitspakete und Abnahmekriterien

Statuswerte: offen, in Umsetzung, umgesetzt / Nachweis offen, bestanden, externe Freigabe offen.

| Priorität / Befund | Umsetzung / Akzeptanzkriterium | Test / Ergebnis | Restpunkt / Status |
| --- | --- | --- | --- |
| P1 F01 Dependencies | Offizielle Advisories geprüft, kompatible Versionen, verwundbare Zweitinstallation entfernt; Browserassets exakt versioniert/lokal | Audit + reale Session-, Parser- und Uploadregression | In Umsetzung |
| P1 F05 Produktionskonfiguration | Zentrale Validierung vor Bootstrap, Simulatoren in Produktion verboten; Wartungsmails bleiben ausstehend | Fehlkonfiguration startet nicht; pausierte Jobs werden nicht abgeschlossen | In Umsetzung |
| P1 F02 Belegung | Gemeinsame atomare Belegung/Zahlungsannahme mit konsistenter Produktsperre; verlorener Hold wird neu geprüft oder erstattet | Kontrollierte Uhr, zwei MySQL-Verbindungen, Paid per Webhook und Sync nach neuer Buchung, ohne Cleanup | In Umsetzung |
| P1 F03/F04 Zahlung/Refund/Chargeback | Monotone Zustandsmaschine, finanzielle Vorgänge dedupliziert und betragsgeprüft, physische Belegung erhalten, begrenzte Reconciliation | Vertauschte Antworten, Doppelwebhook/Sync, partielle/volle Chargebacks/Reversals, Timeout/Restart | In Umsetzung |
| P1 F09 Finanzsaldo | Ein serverseitiger Centvertrag für offene Miete/Kaution, gehaltene Kaution, Forderung, Refund, Dispute; beide UIs/Mails konsistent | Unbezahlt 100+150 EUR darf nie ausgeglichen heißen; Fallmatrix | In Umsetzung |
| P2 F10 Fachgrenzen | Vergangenen Retry und zukünftige tatsächliche Rückgabe vor Mutation ablehnen; Nullpreisaufträge abwickelbar | API-Verhalten mit unverändertem Ledger/Bestand bei Ablehnung | In Umsetzung |
| P1 F08 UTC | Technische Instants UTC, Miettage DATE, Geschäftstag Berlin; neue sichere Migration, Legacy-Ambiguitäten explizit | MySQL März/Oktober, neue Verbindungen, Hold/Lease, Wiederholung | In Umsetzung |
| P1 F06 Auth | Tokenhash, atomarer Verbrauch/Widerruf bei Passwortwechsel; keine nutzbaren Tokens in Operationsmetadaten; Rollenpolicy | Reset→Change→alter Link scheitert, Parallelfälle und Logs | In Umsetzung |
| P2 F07 Upload | Sichere ID vor Multer, Zufallsnamen, Decode/Normalisierung/Pixellimits, sichere Signaturen und Fehler | Echte Multipart-Negativtests, kein Dateischreiben bei ungültiger ID, Quoten/Cleanup | In Umsetzung |
| P2 F12 Schema | AUTO_INCREMENT, ON UPDATE, Engine/Collation/CHECK-Enforcement gehören zum Vertrag | MySQL-Drift stoppt Bootstrap/Readiness; historische Checksummen unverändert | In Umsetzung |
| P2 F13 Runtime | Verbindungsbudget, begrenzte Queue/Fristen, TLS/CA, unabhängige Probes, Shutdown | Stau/Timeout/Recovery, Cookies mit Sessionausfall, Ressourcenfreigabe | In Umsetzung |
| P2 F14 Oberfläche | Suche+Kategorie, echter Kalender, Unicode, semantischer Submit/Pending, Fehler/Unknown/409, zugängliche Bedienung | Verhalten und eigener API-Hauptablauf Desktop/Mobil, keine Kalenderstubs | In Umsetzung |
| Betrieb | Redigierte Korrelation/Metriken, sicherer Replay/Backup/Restore/Preflight mit DB+beiden Volumes | Isolierte Restoreprobe inkl. Referenzen/Smoke; keine echten Provider | In Umsetzung; Betreiberwerte offen |
| P1 F11 Releasekette | Alle Gates inkl. CodeQL für selben Commit, einmal bauen/prüfen/scannen und denselben Digest weiterreichen | Negative Gatefälle, CI/Scan/SBOM/Provenance/Signaturidentität | In Umsetzung; finaler CI-/Image-Nachweis offen |
| Abnahme | Durchgehendes Playwright gegen eigene APIs/MySQL mit echten Assets und isolierten Providern | Einrichtung/Checkout/Online+Cash/Admin/Retouren/Privatzugriff | Offen |

## Externe Nachweise und Betreiberentscheidungen

- Tatsächliche Proxykette, TLS, produktive Secrets/Providerrechte und DB-TLS/CA.
- Aktivierter GitHub Branchschutz/Required Checks/Reviews/Force-Push- und Löschschutz, Secret-/Security-Scanning.
- Freigegebene Betreiber-, Datenschutz- und Miettexte einschließlich Dokumentversion; Signaturalternative fachlich abnehmen.
- Rechnungserstellung (ggf. extern), Wartungs-/Schadenssperren und überfällige physische Geräte.
- Backupverantwortlicher, Verschlüsselung/Schlüsselverwaltung, Retention nach Datenklasse, RPO/RTO und gemessene Wiederherstellungsdauer.
- Vollständiges Security-/CI-Gate auf endgültigem Releasecommit und verifizierter Image-Digest. Historische grüne CI ersetzt diese Nachweise nicht.

Die endgültige Freigabe bleibt gesperrt, bis P1-Codefehler geschlossen, vollständige Tests/Security-Gates bestanden und Betriebsbedingungen nachgewiesen sind. Ausgeführte Codeprüfungen bleiben auch bei offenen externen Nachweisen gültig.
