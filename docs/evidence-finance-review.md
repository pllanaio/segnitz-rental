# Finanzsaldo: unabhängige Integrationsprüfung

13.09.2026, separater Review-Checkout auf integriertem Commit `69f2ba2b929184061da46ec50645b74ad8375f45`. Änderungen betreffen ausschließlich die zentrale Finanzprojektion und ihre Verhaltenstests; keine Daten-/Schema-/Provideränderung.

| Reproduzierter Befund | Korrektur | Testnachweis |
| --- | --- | --- |
| Initialzahlung 250 EUR bezahlt, Mietanteil 100 EUR bezahlt, Kautionsanteil 150 EUR noch pending: Projektion meldete nur 100 EUR erhalten und 150 EUR offen. | Tatsächliche Einnahme je Provider-ID einmal bestimmen; Aggregate und zugehörige Miet-/Kautionsanteile gemeinsam auswerten. Eine bezahlte Gesamtzahlung deckt noch nicht aktualisierte Teilprojektionen. | Zuerst rot; anschließend 250 EUR erhalten, 0 offen, 150 EUR gehaltene Kaution. |
| Vollstorno mit ausschließlich historischer Initialbuchung 250 EUR: aktive Vertragsgrenze 0 kappte die Einnahme auf 0. | Historische Einnahmen bleiben erhalten. Für ihre Zuordnung gilt der ursprüngliche vollständige Vertrag; aktive Positionen bestimmen weiter den offenen Betrag. | Zuerst rot; anschließend 250 EUR erhalten, 250 EUR Erstattung offen, 0 Kundenschuld. |
| Stornierte/abgelaufene Position mit stornierter, unbezahlter Verlängerung: 20 EUR blieben als Kundenschuld sichtbar. | Offene Zusatzforderungen entfallener Positionen werden aus dem fälligen Betrag ausgeschlossen. Fehlgeschlagene Zahlungen aktiver Positionen bleiben fällig. | Zuerst rot; beide Positionszustände danach ohne Phantomschuld, tatsächlicher Renderer zeigt keinen offenen Zahlungsstatus. |
| Zwei echte Initialzahlungen über jeweils 250 EUR ohne Teilbuchungen: die zweite Einnahme wurde durch Vertragsgrenzen verworfen. | Providerzahlungen getrennt zählen; zugehörige Erstattung separat ausweisen. | Zuerst rot; anschließend 500 EUR erhalten, 250 EUR Erstattung offen und weiterhin nur 150 EUR Kaution gehalten. |
| Zwei historische Buchungen derselben Provider-Erstattung mit unterschiedlichen Operationsschlüsseln: dieselbe Auszahlung konnte zugleich bezahlt und offen erscheinen. | Nach Auflösung der fachlichen Retry-Kette nach Provider-Refund-ID deduplizieren; bestätigte Auszahlung bleibt vorrangig. Widersprüchliche Beträge oder Providerzuordnungen derselben Ressource werden abgelehnt. | Zuerst rot; anschließend dieselben 150 EUR genau einmal erstattet und 0 EUR offen. |

Ausgeführt:

- `node --test test/finance-ledger-regression.test.js`: vor der ersten Korrektur **5 Tests, 4 erwartete Fehler**; die spätere Refund-Alias-Regression separat **6 Tests, 1 erwarteter Fehler**.
- `node --test test/finance-ledger-regression.test.js test/order-finance.test.js test/finance-render.test.js`: **22/22 bestanden**, Node 24.19.0.
- Derselbe fokussierte Lauf mit Node 22.22.2: **22/22 bestanden**.
- `node --check services/orderFinanceService.js`, `node --check test/finance-ledger-regression.test.js`, `git diff --check`: bestanden.

Die bestehenden Fälle für Teilzahlung, Nullpreis/Nullzahlung, gehaltene Kaution, Zusatzforderungen, Refund pending/failed/settled, Chargebacks/Reversals, echte Teilerstattungen und Retry-Ketten bleiben grün. Kundenansicht, Admin und Mail nutzen weiterhin dieselbe Serverprojektion. `unallocatedReceivedCents` erhält gegebenenfalls nicht auf Miete/Kaution zuordenbare Einnahmen sichtbar im API-Vertrag, statt sie rechnerisch zu verwerfen.

Nicht ausgeführt: echte MySQL-API-/Browserprüfung, da keine isolierte MySQL-Instanz verfügbar ist. Die Projektionsberechnungen selbst sind durch die genannten ausgeführten Verhaltenstests geprüft. Gesamte Release-Gates müssen auf dem endgültigen integrierten Commit laufen.
