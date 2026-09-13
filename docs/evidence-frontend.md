# Anwendung / Finanzen – Umsetzungsnachweise

Arbeitsbasis: isolierter Branch `rc/frontend` auf Basis des vom Hauptagenten ermittelten Repository-HEAD. Keine Produktionsdaten, Providerkontakte oder Deployments wurden ausgeführt.

| Befund | Umsetzung | Verhaltenstest / bisheriges Ergebnis |
| --- | --- | --- |
| 100 EUR unbezahlte Miete + 150 EUR Kaution erscheinen ausgeglichen | `orderFinanceService`: sichere Ganzzahl-Cents, ein gemeinsamer serverseitiger Finanzstatus und ein gemeinsamer Kunden-/Admin-/Mailrenderer | Beide tatsächlichen alten UI-Renderer zuerst rot (fälschlich „vollständig ausgeglichen“), danach grün; vollständig/teilweise bezahlt, Kaution, Nachforderung, Storno, Refund pending/failed/settled, Chargeback/Reversal, Nullpreis abgedeckt |
| Initialzahlung und Buchungsanteile / Refund-Retries doppelt gezählt | Initialsummen und Anteile getrennt; interne Provider-IDs und `retry-refund-<ledgerId>-<attempt>`-Ursprünge; Kundenausgabe ohne interne IDs/Operationsschlüssel | Cents-/Alias-/Teilerstattungs-/Retrytests grün; echte MySQL-Roundtrips noch ausstehend |
| Vergangenheit beim Checkout-Retry; zukünftige tatsächliche Rückgabe; Nullpreis unabwickelbar | `rentalBoundary` zentraler Berliner Geschäftstag; Retry prüft vor Zahlungsintent; Rückgabe vor DB-/Providerarbeit; vereinbarter Nullpreis bleibt erhalten, tatsächlicher Nullgesamtbetrag ohne Mollie-Intent | 3 Datums-/Preisgrenztests grün; HTTP-Regressionen gegen MySQL noch ausstehend |
| Suche ohne Wirkung | Suche UND Kategorie, NFC/groß-/kleinschreibungsunabhängig; 150-ms-Debounce und begrenzter Verfügbarkeitscache mit Inflight-Deduplizierung | Alter echter Filter zuerst rot `[1,2]` statt `[1]`, dann grün; TTL-/Fehlertests grün |
| Verfügbarkeit unbekannt bedeutet frei / verspätete Cartantwort | Unbekannte Verfügbarkeit blockiert Auswahl; neueste Modalantwort gewinnt; fehlgeschlagener Cart behält Daten mit Fehlerstatus; Generation nach Cartmutation verhindert altes GET | Cache-/Cart-Fehler-/vertauschte Antworttests grün |
| Unicode-/internationale Kontaktdaten werden verändert/abgelehnt | Browser und Server nutzen denselben nicht verändernden `contact-contract`; Adresszeichen, internationale Telefonnummern und Postcodes | Jean-Paul-Str. 12/3 zuerst rot, danach grün; Unicode/Steuerzeichen/Telefonfälle grün |
| Doppelter Checkout-/Submitpfad, Fehlermeldung 409 immer Login | Ein semantischer Formsubmit, Pending für Schritte/Checkout/Login/Reset/Profil und zentrale Adminaktionen, fachliche 409-Meldung | Pending-Doppelklick-/Fehlerfreigabetest grün; durchgehender Browser-API-Ablauf noch ausstehend |
| Rückgabe ist schon gespeichert, Foto schlägt fehl | Modal und Dateiauswahl bleiben erhalten, erneuter Abschluss wiederholt nur Foto-/Mailfolgeaktionen; Mail heißt „vorgemerkt“ | Test PUT genau einmal, Fotoupload zweimal, Mail erst nach erfolgreichem Foto grün |
| Ungepinntes Flatpickr / unterschiedliche Bootstrapversionen | Flatpickr 4.6.13, deutsche Locale, Bootstrap 5.3.8 CSS/Bundle lokal inkl. Lizenzen, Quellen/Hashes im Manifest; alter Submitpfad und alte Bootstrapdateien entfernt | 7 Asset-Dateien SHA-256 geprüft; echter Flatpickr-Stub aus E2E entfernt |
| Bedienung / Kalender / Signatur / Dokumente | `lang=de`, Labels, sichtbarer Fokus, Schrittfokus, Statusansagen, echte lokale Kalender; Draw-Canvas unter 1,8 Mio Pixel; optionaler Upload eines vorhandenen Unterschriftsbilds | Bildalternative nur mit `SIGNATURE_IMAGE_UPLOAD_ENABLED=1`; Backenddecoding bleibt maßgeblich; Betreiberfreigabe erforderlich |
| Unklare Vertragsversion | Betreiber liefert URLs und Versionen; fehlende Dokumente 503, veraltete Akzeptanz 409; Snapshot in bestehendem `confirmation_json.acceptedDocuments` | 3 Tests grün; keine Rechtstexte erfunden; Betreiber muss Dokumente freigeben |

## Ausgeführt bis zum ersten Integrationscheckpoint

- `npm run check:syntax`: **104 JavaScript-Dateien** erfolgreich geprüft.
- `npm run test:unit`: **176 Tests bestanden**, 0 Fehler, 0 übersprungen (Node 24.19.0, vor Zusammenführung anderer Teilbranches).
- `node scripts/verify-browser-assets.js`: **7 Dateien** mit festen Versionen und SHA-256 geprüft.
- Echte rote Reproduktionen: Finanzrenderer 2/2 rot; Suchfilter 1/1 rot; Adressvertrag 2/2 rot. Jeweils nach Umsetzung grün.
- Die Tests für den Rückgabeablauf verwenden jetzt eine tatsächliche Rückgabe heute statt einer fiktiven zukünftigen Rückgabe; Mietvertragsdaten bleiben gleich.

## Offene Nachweise / Betreiberabhängigkeiten

- Isoliertes echtes MySQL war in dieser Umgebung beim Checkpoint nicht verfügbar. Keine Integration/E2E als bestanden markiert; detaillierte Browsernachweise folgen separat.
- Die endgültigen gemeinsamen Gates sind am integrierten Commit erneut auszuführen. Die genannten Unitcounts sind kein Ersatz für den MySQL-/Playwright-Releasegate.
- Freigegebene Mietbedingungen/Datenschutz/Betreiberangaben: `LEGAL_TERMS_VERSION`, `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_VERSION`, `LEGAL_PRIVACY_URL`, `LEGAL_OPERATOR_URL`. Dokumente müssen erreichbar und inhaltlich freigegeben sein; die Anwendung erzeugt keine Rechtsinhalte.
- Akzeptanz der zugänglichen Alternative eines vorhandenen eigenen Unterschriftsbilds: Betreiberentscheidung `SIGNATURE_IMAGE_UPLOAD_ENABLED=1`; ohne diese Freigabe bleibt eine zugängliche Alternative Freigabeabhängigkeit.
- Der derzeitige Katalog lädt weiterhin die vorhandene Produktliste, zeigt 12 Produkte je Seite und begrenzt Verfügbarkeitsrequests per Cache (200 Einträge / 10 Sekunden). Serverseitige Katalogpagination samt Lastnachweis für große reale Kataloge bleibt offen; Produktionskataloggröße ist nicht bekannt.
- Signature Pad bleibt die vorhandene lokale MIT-Version **2.3.2**, Bootstrap Icons die vorhandene lokale **1.11.3**. Beide sind inventarisiert; gezielter Browser-Supply-Chain-Abgleich bleibt Teil des finalen Securitynachweises. Externe Google-Font-Stylesheets wurden entfernt; System-Sans-Fallback bleibt verwendbar.
- Mail ist eine Outbox-Vormerkung. Erfolgreiches Enqueue beweist keine Zustellung und keine exactly-once-Eigenschaft von Graph.

## Browserasset-Updates

`public/vendor/manifest.json` enthält offizielle npm-Archiv-URLs, SHA-512 der Archive und SHA-256 jeder ausgelieferten Datei. Updates müssen bewusst eine feste Version wählen, nur die aufgeführten Distributionsdateien und die Lizenz extrahieren, Manifest/HTMLpfade anpassen und `node scripts/verify-browser-assets.js` sowie den echten Kalenderablauf ausführen. Kein automatisches Überschreiben aus einer unversionierten CDN-URL.
