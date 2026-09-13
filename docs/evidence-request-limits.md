# HTTP-Zulassungsbegrenzung vor Session und Fachlogik

13.09.2026, isolierter Branch `rc/request-limits`, Basis `fe80daca67cfd21c7a121b147f287d29ea55bbf0`.

## Bestätigter Befund

Der reale CI-124-CodeQL-Lauf meldete 40 `js/missing-rate-limiting`-Befunde an Produkt-/Warenkorb- und Hauptanwendungsrouten. Bestehende Login-, Setup-, Gastbestellungs-, Kontomutations- und Rückgabelimiter schützen einzelne Fachaktionen. Sie liefen jedoch erst nach Sessionstore-Zugriff und teils nach der `auth_version`-Abfrage. Produkt-/Warenkorbzugriffe und mehrere private Datei-/Adminrouten hatten keine gemeinsame Schranke.

Die [CodeQL-Regel](https://codeql.github.com/codeql-query-help/javascript/js-missing-rate-limiting/) bewertet unbeschränkte Datenbank-/Dateizugriffe als Ressourcenerschöpfungsrisiko. Hier wurden echte Schranken eingeführt; weder Query noch Befunde oder Gates werden unterdrückt.

## Verhalten und Konfiguration

`segnitz_rental.js` registriert explizit zwei `express-rate-limit`-Instanzen vor JSON-/Formparsern, Sessionmiddleware und sämtlichen Fachroutern. Zuerst begrenzt ein konstanter Prozessschlüssel die gesamte zugelassene Arbeit; erst danach wird die Client-IP gezählt. Damit können abgewiesene wechselnde Client-Adressen keine weiteren Einträge im zweiten Store erzeugen. Das [MemoryStore-Verhalten und die IP-/IPv6-Gruppierung](https://express-rate-limit.mintlify.app/reference/configuration) bleiben die des vorhandenen Pakets; IPv6-Adressen werden auf /56 zusammengefasst.

Die bereits vorhandene geprüfte `TRUST_PROXY`-Auswertung wird vor die Limiter verschoben. Es werden keine direkten Forwarded-Header als eigener Client-Schlüssel verwendet. Alle bisherigen strengeren Auth- und Fachlimiter bleiben unverändert aktiv. Überlastantworten enthalten deutsche JSON-Fehler, Code `REQUEST_RATE_LIMITED`, HTTP 429, `Retry-After` und `Cache-Control: no-store`.

| Variable | Standard | Erlaubter Bereich |
| --- | --- | --- |
| `HTTP_RATE_LIMIT_WINDOW_MS` | 60000 ms | 1000–3600000 ms |
| `HTTP_RATE_LIMIT_GLOBAL_MAX` | 6000 | 1–1000000 pro Fenster und Prozess |
| `HTTP_RATE_LIMIT_MAX` | 600 | 1–100000 pro Fenster und Client-IP/-Subnetz |
| `READINESS_RATE_LIMIT_MAX` | 120 | 1–10000 pro Minute und Prozess |

Die zentrale Laufzeitvalidierung prüft alle Werte vor Bootstrap/HTTP-Start. Die Optionsfactory verwendet denselben validierenden Zahlenparser; ungültige Werte werden weder geklemmt noch durch Defaults ersetzt. Es gibt keinen produktiven Abschaltschalter.

GET/HEAD `/live` bleibt vor diesen Limitern und benötigt weder Session noch Datenbank. `/ready` und `/health` teilen ein eigenes Minutenbudget. Bei dessen Erschöpfung antworten sie mit HTTP 503, `Retry-After`, Code `READINESS_RATE_LIMITED`, ohne die DB-Readiness aufzurufen. Die vorhandene DB-Readiness-Frist gilt weiterhin für zugelassene Probes. Die drei neu verwalteten MemoryStores werden nach dem HTTP-Drain explizit geschlossen.

## Ausgeführte Nachweise

Vor dem Fix liefen fünf gezielte HTTP-Verhaltenstests rot: unbeschränkte Facharbeit, unbeschränkt wechselnde Client-Adressen, umgehbare/fehlende Clientbegrenzung, unbegrenzte Readiness und fehlende Fenstersperre. Danach:

| Befehl | Ergebnis |
| --- | --- |
| `node --test test/request-limits.test.js test/health-routes.test.js test/production-config.test.js test/proxy-policy.test.js` | 20/20 grün unter Node 24.19.0. |
| `/workspace/scratch/3d9a8f0d5ab7/test-runtime/node22/bin/node --test test/request-limits.test.js test/health-routes.test.js test/production-config.test.js test/proxy-policy.test.js` | 20/20 grün unter Node 22.22.2. |
| `node --check segnitz_rental.js`, `node --check middleware/requestLimits.js`, `node --check config/runtimeConfig.js`, `node --check services/healthRoutes.js`, `git diff --check` | Grün. |

Die Tests senden echte HTTP-Anfragen an Express mit den produktiv verwendeten Limiteroptionen und einer echten, instrumentierten `express-session`-MemoryStore-Session: genau zwei zugelassene Session-Lesevorgänge, danach keine weiteren Reads/Handleraufrufe trotz gültigem Cookie und ungültigem JSON. Bei 20 parallelen verschiedenen Client-Adressen und globalem Limit 4 gelangen exakt vier Anfragen weiter und erzeugen genau vier Client-Zähler. Weitere Tests belegen unbekannte Proxy-Peers, IPv6-Rotation, unabhängige Liveness, gemeinsame `/ready`-/`/health`-Grenze, automatische Wiederzulassung nach Fensterablauf, erhaltene strengere Loginbegrenzung und Ablehnung ungültiger Konfiguration.

Diese Tests benutzen keine produktive DB, Auth-Identität oder Provider. Die Platzierung im wirklichen Einstiegspunkt wurde implementiert und geprüft; der endgültige CodeQL-Lauf und der bestehende echte MySQL-/Playwright-Gate müssen die integrierte Änderung zusätzlich bestätigen. Lokale Limiter-Verhaltenstests werden nicht als bereits ausgeführte neue MySQL-Lastprobe bezeichnet.

## Betrieb

Die Schranken gelten pro Node-Prozess und werden bei dessen Neustart zurückgesetzt. Das passt zur vorhandenen einzelnen Anwendungsinstanz; mehrere Instanzen multiplizieren die Gesamtgrenze. Eine spätere Replikation benötigt einen bewusst abgestimmten Ingress-/gemeinsamen Quotenvertrag. Diese Änderung führt keinen neuen Dienst und keine vorgeschalteten DB-Schreibzugriffe ein.

Normale Seitenassets, Adminaktionen und Webhooks zählen mit, weil auch ihre Verarbeitung Ressourcen benötigt. Abgewiesene Zahlungswebhooks werden nicht als verarbeitet quittiert; die vorhandene Reconciliation bleibt als Reparaturpfad nötig. Das Standardprofil erlaubt 600 Anfragen pro Minute je Client und 6000 je Instanz. Vor Produktionsfreigabe sind erwartete Nutzer hinter gemeinsamen NAT-Adressen, Monitoringfrequenz und die tatsächliche Proxy-Topologie mit diesem Profil abzugleichen. Vorhandene HTTP-Status-/Latenzmetriken erfassen auch die neuen 429-/503-Antworten.
