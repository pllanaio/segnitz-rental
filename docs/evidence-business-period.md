# Monats-/Jahresfilter nach UTC-Umstellung

Der bestätigte Fehler ordnete einen Auftrag vom 01.07.2026 um 00:30 Uhr Berlin dem Juni zu, weil `created_at` jetzt UTC liefert, Filter und `YEAR`/`MONTH` aber unveränderte UTC-Grenzen nutzten.

Kunden- und Adminfilter verwenden denselben Helper `utils/businessPeriod.js`: Berliner Monats-/Jahresgrenzen werden mit IANA-Regeln in UTC-`Date`-Parameter umgerechnet. Die SQL-Abfrage bleibt ein indexierbarer Bereich auf `created_at`. Filteroptionen erhalten dieselben Berliner Jahres-/Monatswerte aus dem expliziten UTC-Zeitpunkt in JavaScript; installierte MySQL-Zeitzonentabellen sind nicht erforderlich. Datum, Status und Sortierung des Auftrags werden nicht verändert.

`node --test test/business-period.test.js` reproduzierte zuerst einen roten Verhaltenstest der tatsächlichen `addCreatedAtRangeFilter`-Funktion: `2026-07-01T00:00Z` statt `2026-06-30T22:00Z`. Nach Korrektur bestehen alle drei Tests, einschließlich März/Oktober, Dezember/Jahreswechsel, fehlender Zeitzone und ungültiger Filterwerte. Zusammen mit Geschäftstags- und Outboxregressionen: **34/34 bestanden**.

`test/integration/business-period.integration.test.js` prüft auf isoliertem MySQL die Zeitpunkte unmittelbar vor, auf und innerhalb der Grenzen für Juli, März, Oktober, Dezember und ein ganzes Jahr. Die Fixture ist ausschließlich eine temporäre Tabelle auf einer durch den vorhandenen Namensschutz ausgewiesenen Testdatenbank. **Mangels MySQL hier nicht ausgeführt**, somit kein Integrationstest-Pass behauptet. Keine Migration und keine veröffentlichten Migrationshelper geändert.

Final lokal ausgeführt: `npm run check:syntax` **135 Dateien grün**; `node --test test/*.test.js` **215 Tests, 215 bestanden, 0 übersprungen** auf dem integrierten Ausgangscommit `6a8dbd2` plus diesem Fix.
