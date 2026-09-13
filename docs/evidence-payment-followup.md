# Zahlungs-/Belegungs-Nachprüfung des integrierten Kandidaten

Basis der isolierten Nachprüfung: `04f2cbef18c4545fefc9007528cbfc1e21366749`.

## Korrigierte zusätzliche Befunde

1. **Kalender und Buchungsprüfung verwendeten abweichende physische Zustände.** Der öffentliche Kalender ließ `payment_dispute`, `partially_returned` und `partially_cancelled` aus, die transaktionale Prüfung blockierte sie. Beide benutzen jetzt denselben zentralen Belegungsfilter einschließlich Hold-Ablauf und tatsächlicher Rückgabe. Neues MySQL-Verhaltenstest prüft alle drei Zustände über beide Pfade.
2. **Bestehende kostenfreie Online-Aufträge konnten beim Checkout-Retry eine unzulässige 0-EUR-Providerabsicht erzeugen.** Erstcheckout und Retry verwenden nun dieselbe lokale Nullbetrags-Abwicklung nach Produkt-/Auftragssperren, Datums- und Verfügbarkeitsprüfung. Sie bestätigt den Auftrag, erhält die gewählte Zahlungsart als Kontext, reaktiviert abgelaufene Positionen und verbucht einen idempotenten 0-EUR-Mietdatensatz. Positive Kautionen bleiben zahlungspflichtig; widersprüchliche positive lokale Zahlungsabsichten führen nicht zur Gratisfreigabe.
3. **Der neue kostenfreie Online-Erstcheckout speicherte und versandte eine reservierte Bestellzusammenfassung, obwohl der Auftrag bestätigt war.** Zusammenfassung und Datenbankstatus sind jetzt beide vor Versand `confirmed`; es wird keine Reservierungsfrist für kostenfreie Aufträge angelegt.

Die drei neuen MySQL/API-Abnahmetests sind vorbereitet, mangels MySQL in dieser Umgebung weiterhin **nicht ausgeführt**: Kalender-/Buchungsübereinstimmung sowie Bar-/Online-Erstcheckout für Nullbetrag einschließlich Legacy-Retry. Die vorhandenen rechtlichen Testversionen werden vom gemeinsamen `orderForm` und dem gestarteten Server geerbt. Die reinen Service-/Datenbanktests führen keinen Checkout aus und benötigen keine rechtlichen Testtexte.

## Verifikation

- `node --test test/zero-amount-booking.test.js`: 2 Verhaltenstests grün (Nullpreis mit Kaution; inkonsistente Miet-/Zahlungsabsichten werden vor Mutation abgelehnt).
- `npm run check:syntax`: 155 JavaScript-Dateien grün im überprüften Zwischenstand.
- Gesamtes Unit-Gate gegen den isolierten integrierten Basisstand mit diesem fachlichen Diff: **245/245 grün**, 0 übersprungen, Node 24.19.0.
- `git diff --check`: grün.

Zusätzlich wurden zwei Finanzsaldo-Regressionsfälle vor Fix reproduziert (35 EUR Nachforderung nach Positionsstorno; verschwundener 250-EUR-Initialzahlungseingang bei Vollstorno). Ihre Korrektur samt Tests wird in einem getrennten Finanzsaldo-Diff des anderen Reviewers geliefert, damit keine konkurrierenden Implementierungen entstehen.

Keine realen Providerkontakte, Produktionsmigrationen oder Deployments. Der echte MySQL-/API-/Browser-Nachweis bleibt Release-Gate und wird durch die grünen Unit-Tests nicht ersetzt.
