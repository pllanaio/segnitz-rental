# Begrenzter öffentlicher Katalog

Die Startseite verwendet jetzt `GET /catalog` mit `q`, `category`, `page` und
`pageSize`. Der bisherige Arrayvertrag von `/products` bleibt für vorhandene
Verwaltungsaufrufe erhalten. Im öffentlichen Katalog erscheinen ausschließlich
aktive Produkte, auch bei angemeldetem Administrator.

* Standard: zwölf Produkte; maximal 100 pro Anfrage, Seiten 1 bis 10.000.
  Sortierung nach Titel und ID verhindert zufällige Reihenfolgen bei gleichen Titeln.
  Anzahl und Seite werden in einer begrenzten Read-only-Transaktion gelesen.
* Suche und Kategorie werden gemeinsam serverseitig angewandt. Browser und Server
  verwenden dieselbe NFC-/Deutsch-Kleinschreibung; Zeichen wie Apostroph, Slash,
  Umlaute, Prozent und Unterstrich bleiben erhalten. SQL-Suche berücksichtigt die
  bestehende Unicode-Kollation. Prozent/Unterstrich sind wörtliche Suchzeichen.
  Suchtexte und Kategorien bleiben Prepared-Statement-Parameter. Ausschließlich
  erneut auf Ganzzahl und Bereich geprüfte Zahlen stehen als LIMIT/OFFSET-Literale
  im SQL; damit entfällt die im echten CI festgestellte mysql2-DOUBLE-Bindung für LIMIT.
* Bilder und Zuordnungen werden nur für die aktuelle Produktseite gelesen; maximal
  zehn Vorschaubilder und 100 Kategorien je Karte. Die Kategorieauswahl enthält
  maximal 100 zur Suche passende Facetten, mit sichtbarem Eingrenzungshinweis bei
  weiteren Treffern. Bestehende Daten werden weder verändert noch entfernt.
* Seitenwechsel lädt nur die neue Seite. Eingaben werden 150 ms entprellt; eine
  neue Eingabe bricht vorherige Requests sofort ab. Selbst bei ignoriertem Abort
  darf eine ältere Antwort oder ein älterer Fehler keinen neueren Stand ersetzen.
  Verfügbarkeitsanfragen werden weiterhin pro Produkt gecacht/dedupliziert und
  entstehen erst für tatsächlich gerenderte Karten. Lade-, Leer- und Fehlerzustand
  bleiben getrennt. HTTP 503 bietet eine Wiederholung. Seitenwechsel setzt den
  Tastaturfokus auf die Ergebnisse; Seitennavigation ist benannt und begrenzt.

Ausgeführt im isolierten Branch `codex/rc-catalog-pagination-20260913`, Basis
`b42e7023`: `npm run test:unit` **304/304** vor den zusätzlich ergänzten zwei
HTTP-Verhaltenstests. Danach
`node --test test/catalog-http.test.js test/catalog-pagination.test.js test/catalog-state.test.js test/catalog-filter.test.js`
**9/9**, einschließlich echter HTTP-400 vor jedem DB-Acquire und generischer HTTP-503
bei DB-Erschöpfung, Queryparameter-/Seitenprüfung, gezielter Hydration und vertauschter
Antworten. Syntax der geänderten Runtime-/Integration-/E2E-Dateien und
`git diff --check` sind grün.

Beide neuen sekundären Playwright-Tests wurden lokal jeweils erfolgreich ausgeführt:
Seitenwechsel/Seitenumfang/Suche+Kategorie/Entprellung/Fokus ohne unerwartete
JavaScript-/CSP-Fehler, sowie HTTP-503/Wiederholung. Dazu liefen die tatsächlichen
HTML-/JS-Dateien auf einem ausschließlich lokalen statischen Fixture-Server mit
self-only-Script-/Font-CSP; Katalog und Verfügbarkeit waren gezielte Testantworten.
Der gemeinsame erste lokale Versuch bestand den ersten Test, der zweite scheiterte
am geschlossenen Chromium-Kontext im notwendigen `--single-process`-Modus. Beide
Tests bestanden anschließend jeweils in einem frischen Browser. Das ist ein
UI-Nachweis, kein lokaler MySQL- oder ungemockter Hauptablaufnachweis.

CI-Reproduktion: `npx playwright test test/e2e/catalog-pagination.spec.js` gegen
den regulären isolierten Testserver. Neu ergänzt ist außerdem ein tatsächlicher
API-/MySQL-Test am Ende von `app.integration.test.js`: zwei stabile Seiten mit
gleichen Titeln, Unicode-Roundtrip, Suche UND Kategorie, wörtliche SQL-Metazeichen,
nur zugehörige Bilder/Kategorien, unsichtbare inaktive Produkte und JSON-400 für
ungültige Parameter. Dieser Test besteht jetzt tatsächlich auf MySQL 8.4.11 im
[CI-Lauf 34757220852](https://github.com/pllanaio/segnitz-rental/actions/runs/34757220852),
Job `103723568754`, Checkout `618bacbd0c09d0c50b23f33b0cc4ed829a326d84`
(PR-Kopf `24a2580df41c0227d46804af5d6107ecc40018dc`). Der Gesamtjob steht bei
**85/87 bestanden, 0 übersprungen**; ausschließlich zwei Gastidentitäts-Tests
scheiterten am fehlenden Testhelfer `readAuthMailToken`.
**Der erneute ungemockte Playwright-Hauptablauf und das vollständige Gate auf dem
endgültigen Commit bleiben gesonderte Nachweise.** Das bestehende DB-Query-/
Transaktionsbudget begrenzt auch diese Abfragen; ein Lastnachweis für sehr große
Kataloge wird nicht aus den Fixturetests abgeleitet.
