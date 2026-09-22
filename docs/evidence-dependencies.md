# Abhängigkeiten, Startkonfiguration und E-Mail-Wartung

Stand: 13.09.2026. Ausgangspunkt `1382a95444be15f692f4a8800ab521b11c3d4683`, isolierter Branch `codex/rc-dependencies-20260913`. Keine produktiven Dienste kontaktiert, keine Migration oder Betriebsaktion ausgeführt.

## Befund → Änderung → Nachweis

| Befund | Umsetzung | Verhaltenstest / Ergebnis | Restnachweis |
| --- | --- | --- | --- |
| Multer 2.2.0 kann bei speziellen Multipart-Feldnamen hängen/abstürzen und bei Abbruch Dateideskriptoren verlieren | Exakt 2.3.0; Uploadimplementierung muss zusätzlich `fieldArrayIndexLimit` und `fieldNestingDepth` konfigurieren | Getrennter HTTP-Prozess: alter Parser nach 3 Sekunden beendet (rot); gepatchter Parser antwortet in ca. 93 ms mit 400 `LIMIT_FIELD_ARRAY_INDEX` (grün). Test schreibt keine Dateien. | Abbruch-/Dateibereinigung und echte API-Uploads sind Teil der Auth-/Uploadtests, finaler Container-Scan offen. |
| `qs` 6.15.3 verletzt Arraylimit und wirft beim Parse/Stringify fremder Konstruktorfelder | Override exakt 6.16.0 für Express und body-parser | Zwei echte Parse/Stringify-Verhaltenstests zuerst rot, danach grün | Integration mit finaler API auszuführen. |
| express-mysql-session pinnt separat mysql2 3.10.2 | Scope-Override `express-mysql-session.mysql2: "$mysql2"`; direkte Version exakt 3.23.3 | Modulauflösungstest zuerst rot, danach grün; `npm ls` zeigt exakt eine mysql2-Installation | Drei echte MySQL-Tests hinzugefügt, mangels MySQL nicht ausgeführt. |
| Produktionsstart lässt Simulatoren zu | `validateRuntimeConfig()` vor Bootstrap; Production falls NODE_ENV **oder** DEPLOYMENT_ENV production | Vier ursprüngliche Fehlkonfigurationstests rot → grün; HTTPS, aktive Integrationen, Secretlängen, Ports, Fristen und Dokumentkonfiguration geprüft | Betreiberwerte und reale Providerkonfiguration verifizieren. |
| Deaktivierte Mail kann als versandt abgeschlossen werden | `MAIL_DELIVERY_PAUSED=1` hält Jobs im vorhandenen Zustand; Claims und Lease-Reaper überspringen Mail, Zahlungsjobs bleiben verarbeitbar. Pause nach Claim gibt dessen Versuch zurück und behält Payload. `DISABLE_EMAILS=1` pausiert ebenfalls, bleibt in Produktion verboten. | Zwei Verhaltenstests rot → grün; keine Completion-/Failure-Aufrufe bei Pause. MySQL-Tests prüfen Payload, attempt_count, completed_at und Zahlungsfortschritt. | MySQL-Tests und kontrolliertes Ende eines Wartungsfensters verifizieren. |
| Unvalidierte Bildinhalte brauchen begrenztes Decoding | Sharp exakt 0.35.4 für die separate Uploadumsetzung hinzugefügt | Lokales Sharp-Rendering eines synthetischen 1×1-PNG: 90 Bytes | Native Bibliotheken zusätzlich im endgültigen Image scannen. |

## Offizielle Quellen und Versionswahl

Abruf am 13.09.2026:

- Multer: [GHSA-wc9g-mqfw-jrwm](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm), [GHSA-qfvm-cv95-jqjf](https://github.com/expressjs/multer/security/advisories/GHSA-qfvm-cv95-jqjf), [GHSA-535w-7cp7-47q4](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4): korrigiert in 2.3.0. Das installierte Modul prüft Arrayindex/Nesting nur mit expliziten Limits; der Verhaltenstest deckt diese notwendige Konfiguration ab.
- MySQL2: [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) korrigiert ab 3.22.0; [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3) ab 3.23.1. Die bereits direkt verwendete 3.23.3 bleibt erhalten. Der Override ersetzt ausschließlich den veralteten fest gepinnten Sessiontreiber innerhalb derselben Hauptversion. Latest 3.24.4 wurde abgefragt, aber ohne Bedarf kein weiteres Upgrade durchgeführt.
- qs: [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g): korrigiert in 6.16.0. Der Override verhindert eine erneute anfällige Zweitinstallation.
- Sharp: [0.35.4](https://sharp.pixelplumbing.com/changelog/v0.35.4/) und [0.35.0-Kompatibilität](https://sharp.pixelplumbing.com/changelog/v0.35.0/): Node >=20.9.0; kompatibel mit unterstütztem Node 22/24. Transitive plattformspezifische Bibliotheken stehen mit Integrität im Lockfile.

Browserbibliotheken werden separat lokal versioniert; ein Node-Audit ist dafür kein Nachweis. Overrides bei künftigen Updates einzeln durch Modulauflösung, Parser-, Upload- und MySQL-Sessiontests prüfen und erst entfernen, wenn der Upstream dieselbe sichere Auflösung ermöglicht.

## Tatsächlich ausgeführte Befehle

Arbeitsverzeichnis war der isolierte Checkout; temporäre Protokolle enthielten ausschließlich synthetische Testdaten.

1. `npm view multer version`, `npm view qs version`, `npm view mysql2 version`, `npm view sharp version`, `npm view express-mysql-session@3.0.3 dependencies --json`: 2.3.0, 6.16.0, 3.24.4, 0.35.4; Sessiontreiber pinnt mysql2 3.10.2.
2. `NODE_PATH=<Baseline>/node_modules node --test test/production-config.test.js test/dependency-security.test.js test/mail-pause.test.js`: **9 Tests, 0 bestanden, 9 erwartete Fehler** vor Änderungen.
3. `npm install --ignore-scripts --no-fund` sowie `npm dedupe --ignore-scripts --no-fund`: initial blieb der alte Lockeintrag des Sessiontreibers erhalten. Anschließend ausschließlich dessen veralteten generierten Lock-/node_modules-Eintrag entfernt und `npm install --ignore-scripts --no-fund` erneut ausgeführt. Keine Quelldateien oder Geschäftsdaten zurückgesetzt.
4. `MULTIPART_PROBE_MULTER=<Baseline>/node_modules/multer node --test test/dependency-security.test.js`: **3 bestanden, 1 erwarteter Timeout** des begrenzten Kindprozesses mit Multer 2.2.0. Ohne Override **4/4 bestanden**.
5. `npm ci --no-fund`: **132 Pakete installiert**, Exit 0. Damit ist der geänderte Lockfile aus einer Neuinstallation reproduziert; keine Lifecycle-Gates deaktiviert.
6. `npm ls mysql2 multer qs sharp`: Exit 0; mysql2 **3.23.3 deduped**, multer **2.3.0**, qs **6.16.0 overridden/deduped**, sharp **0.35.4**.
7. `npm audit --omit=dev --json`: Exit 0, **0 info / 0 low / 0 moderate / 0 high / 0 critical**, gesamt 0.
8. `node --test test/*.test.js` unter **Node 24.19.0**: **161/161 bestanden**, 0 übersprungen.
9. `<Node22>/bin/node --test test/*.test.js` unter **Node 22.22.2**: **161/161 bestanden**, 0 übersprungen.
10. `npm run check:syntax`: **90 JavaScript-Dateien**, bestanden. `git diff --check`: bestanden.

Diese Counts betreffen diesen Teilbranch vor Integration der anderen Arbeitspakete; sie sind kein Nachweis für den späteren finalen Release-Commit.

## Konfigurationsvertrag

`config/runtimeConfig.js` validiert vor Migration/HTTP: absolute BASE_URL ohne Credentials/Pfad/Query/Fragment, produktiv HTTPS; DB-Pflichtwerte; SESSION_SECRET; ADMIN_SETUP_TOKEN (produktiver Start verlangt explizite mindestens 32 Zeichen statt protokollierter Setupcodes); IANA-Geschäftszeitzone; numerische Bereiche für Ports, DB-/Provider-/Worker-/Shutdownfristen; unterstützte boolesche Schalter; Produktionsadapter; aktivierten Graph-Versand; Dokumentversionen und -verweise; DB-TLS-CA-Konfiguration. Fehlermeldungen nennen nur Variablennamen und Regeln, keine Werte.

`DEPLOYMENT_ENV=test` schwächt `NODE_ENV=production` nicht ab. Der lokale Mollie-Simulator benötigt zusätzlich eine Datenbank mit eigenständigem `test`- oder `ci`-Namenssegment. Provider-Sandboxkontakt und lokaler Simulator bleiben unterschiedliche Vorgänge. Kein externer Sandboxkontakt fand statt.

`MAIL_DELIVERY_PAUSED=1` ist der erlaubte produktive Wartungsschalter. Nach Rückkehr zu 0 und Neustart werden Graph-Pflichtwerte erneut geprüft. Ausstehende Jobs bleiben vorgemerkt; keine unbelegte Zustellung. Ein schon laufender Provideraufruf wird durch einen nachträglichen Konfigurationswechsel nicht zurückgenommen. Nach Providerannahme und verlorenem lokalem Commit kann Graph weiterhin eine Nachricht erneut versenden: keine exactly-once-Zusage.

Graph-Fehler enthalten nur HTTP-Status, keine Providerantworten; Setupcodes werden nicht mehr ausgegeben. Pending-Mailpayloads mit Authlinks bleiben schützenswerte Klartextdaten und benötigen die separate Retention-/Tokenumsetzung. Finanzielle Operationsschlüssel werden durch die Mailpause nicht verändert.

## Nicht ausgeführt / Freigabegrenzen

- `node --test test/integration/dependencies.integration.test.js`: bereitgestellt, **nicht ausgeführt**, weil keine erreichbare isolierte echte MySQL-Instanz verfügbar war. Die Suite prüft Sessionstore-Neuerstellung/Logout und zwei persistente Pausen-/Race-Szenarien. Keine MariaDB als MySQL-Nachweis eingesetzt.
- Kompletter API-/Playwright-Lauf, endgültiger Container-Scan, signierter Image-Digest und CI-Checks des zusammengeführten Release-Commits: durch den Releaseprozess nachzuweisen.
- Produktive DB-/Proxy-/TLS-Konfiguration, aktive Graph-/Mollie-Zugänge und gültige freigegebene Vertrags-/Datenschutz-/Betreibertexte: Betreiberfreigabe erforderlich. Die `.env.example` enthält bewusst keine erfundenen Texte oder Zugangsdaten.

Status dieses Pakets: lokal implementiert und durch die oben ausgeführten Syntax-/Unit-/Auditprüfungen abgesichert; **keine Produktionsfreigabe** ohne genannte Integrations- und Betriebsnachweise.
