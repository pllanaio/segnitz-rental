## Segnitz Rental Manager
Modular rental tool for several types of products including tools, cars and construction machinery with database integration, pdf signing option and payment gateway integration

## Datenbank

Beim Programmstart wird die Datenbank vor dem Öffnen des HTTP-Ports automatisch
initialisiert:

- Existiert die in `DB_NAME` konfigurierte Datenbank nicht, versucht der
  Datenbankbenutzer sie anzulegen.
- Fehlende Tabellen werden aus `database/schema.sql` erstellt.
- Nach Migrationen vergleicht der Start Tabellen, Spalten, Defaults, Indizes sowie
  CHECK- und Foreign-Key-Definitionen mit dem kanonischen Schema und bricht bei
  Drift ab.
- Ausstehende versionierte Migrationen werden einmalig ausgeführt und in
  `app_schema_migrations` protokolliert. Eine nachträglich veränderte bereits
  ausgeführte Migration verhindert den Start.
- Bei Fehlern bricht der Prozess ab, anstatt mit einem unvollständigen Schema zu
  starten. Für Deployments mit mehreren Replikas wird ein MySQL-Advisory-Lock
  verwendet.

Die Anwendung verwendet für Geschäftszeiten standardmäßig `Europe/Berlin` und
setzt jede neue MySQL-Session auf den jeweils gültigen UTC-Offset (inklusive
Sommer-/Winterzeit). `BUSINESS_TIME_ZONE` kann nur auf eine von Node/Intl
unterstützte IANA-Zeitzone gesetzt werden. `/live` prüft nur den Prozess;
`/ready` und der kompatible Pfad `/health` prüfen Datenbank und Schema und liefern
bei Nichtverfügbarkeit HTTP 503.

Der konfigurierte Datenbankbenutzer benötigt damit `CREATE`, `ALTER`, `INDEX`,
`REFERENCES`, `SELECT`, `INSERT`, `UPDATE` und `DELETE`. Soll das Programm auch
die Datenbank selbst anlegen, wird zusätzlich `CREATE` auf Serverebene benötigt. Kann der
Benutzer das nicht, muss nur eine leere Datenbank mit dem Namen aus `DB_NAME`
bereitgestellt werden; Tabellen und Migrationen übernimmt die Anwendung.

### Ersteinrichtung

Existiert nach dem Datenbankaufbau noch kein Benutzer mit der Rolle
`global_admin`, sperrt die Anwendung alle regulären Seiten und APIs und leitet
auf `/setup.html` um. Dort wird das erste globale Adminkonto erstellt.

In Produktion sollte vor dem ersten Start ein zufälliger Wert mit mindestens 32
Zeichen als `ADMIN_SETUP_TOKEN` gesetzt werden. Ohne diese Variable erzeugt die
Anwendung einen einmaligen Setup-Code und schreibt ihn ausschließlich ins
Deployment-Log. Nach erfolgreicher Einrichtung wird nur der Hash verworfen; der
Code kann nicht erneut benutzt werden.

Automatisierte Tests dürfen das Schema destruktiv zurücksetzen. Dafür muss der
Datenbankname `test` oder `ci` als eigenes Namenssegment enthalten (zum Beispiel
`segnitz_test`). Reale Kunden-, Zahlungs- und Signaturdaten werden nicht als
Testdaten verwendet.

Bei künftigen Schemaänderungen wird `database/schema.sql` für Neuinstallationen
aktualisiert und eine neue unveränderliche Migration in
`database/migrations/automatic.js` ergänzt. Das Deployment führt sie selbst aus;
ein manueller SQL-Schritt gehört nicht mehr zum Releaseprozess.

## Lokaler Betrieb mit Docker Compose

Mit `compose.local.yml` baut Docker den aktuellen lokalen Quellcode und startet
eine eigene MySQL-Datenbank. Voraussetzung sind Docker Desktop und eine lokale
`.env` mit `DB_NAME`, einem nicht leeren `DB_PW`, `DB_USER=root`,
`SESSION_SECRET` und `ADMIN_SETUP_TOKEN`. Für eine neue lokale Installation
`.env.example` als Vorlage verwenden und die Secrets zufällig erzeugen.

```powershell
docker compose -f compose.yml -f compose.local.yml up -d --build --wait
```

Die Anwendung ist unter http://localhost:3000 erreichbar. Bei einer leeren
Datenbank führt sie zur Einrichtung des ersten Admins; als Setup-Code dient
`ADMIN_SETUP_TOKEN` aus `.env`. Ein bereits vorhandener Datenbestand bleibt
erhalten. Die lokale Variante nutzt HTTP mit `NODE_ENV=development`, simuliert
Zahlungen. Der Mailversand folgt DISABLE_EMAILS aus der .env (0 = aktiviert, 1 = deaktiviert). Die Datenbank ist nur im Docker-Netzwerk
erreichbar. Diese Variante ist ausschließlich für lokale Tests vorgesehen.

Nach Codeänderungen denselben Startbefehl erneut ausführen, damit das Image neu
gebaut wird. Es gibt kein automatisches Neuladen des Quellcodes.

```powershell
# Status und Logs
docker compose -f compose.yml -f compose.local.yml ps
docker compose -f compose.yml -f compose.local.yml logs -f app

# Stoppen; Datenbank und Bilder bleiben in Docker-Volumes erhalten
docker compose -f compose.yml -f compose.local.yml down
```

`down -v` löscht dagegen auch die lokalen Datenbank- und Bild-Volumes.
Bei lokalen Befehlen immer beide Compose-Dateien angeben; `compose.yml` allein
verwendet die nachfolgend beschriebene Produktionskonfiguration.

## Produktionsdeployment mit Docker Compose

Die mitgelieferte `compose.yml` bindet den HTTP-Port standardmäßig nur an
`127.0.0.1`, begrenzt Linux-Capabilities auf den initialen Eigentümer- und
Benutzerwechsel und persistiert Produkt- und Rückgabebilder in benannten
Volumes. Rückgabebilder
liegen außerhalb des öffentlichen Web-Verzeichnisses und werden ausschließlich
über eine eigentümer- beziehungsweise admin-geprüfte Route ohne Browser-Cache
ausgeliefert. Das bestehende Volume `return-images` bleibt auch nach dieser
Pfadänderung erhalten; nur sein Einhängepunkt im Container ist privat.

1. `.env.example` nach `.env` kopieren und alle leeren Secrets setzen.
2. `SESSION_SECRET` und `ADMIN_SETUP_TOKEN` mit mindestens 32 zufälligen Zeichen
   erzeugen. `.env` niemals committen.
3. Mit `docker compose pull` und
   `docker compose up -d --force-recreate` deployen.
4. Für reproduzierbare Rollouts bevorzugt
   `SEGNITZ_IMAGE=pllanaio/segnitz-rental:sha-<vollstaendiger-commit-sha>` setzen.

`docker compose down` behält die benannten Volumes. `docker compose down -v`
löscht sie dagegen zusammen mit allen hochgeladenen Bildern und darf nur nach
einem geprüften Backup verwendet werden. Datenbank und beide Upload-Volumes
müssen regelmäßig gesichert und eine Wiederherstellung muss getestet werden.

Beim Upgrade werden auch ältere, eventuell noch `root:root` gehörende
Upload-Volumes automatisch nutzbar gemacht: Der Container-Entrypoint legt nur
die beiden festen Einhängepunkte `/app/public/img/products` und
`/app/uploads/returns` an und überträgt deren Eigentümerschaft auf den
`node`-Benutzer. Dafür startet er kurz mit den Linux-Capabilities `CHOWN`,
`SETGID` und `SETUID`, gibt sie beim Wechsel zu `node` ab und startet
anschließend die Anwendung per `exec`. Ein manueller `chown`-Hotfix auf dem
Server ist nicht erforderlich; bestehende Bilddateien werden dabei weder
verändert noch gelöscht.

Falls der Reverse Proxy nicht auf demselben Host läuft, muss
`APP_BIND_ADDRESS` bewusst auf eine geeignete interne Adresse geändert und der
Origin per Firewall vor direktem Internetzugriff geschützt werden.

## Authors and acknowledgment
Leon Pllana @ Segnitz Rental

## Abhängigkeiten

Die verbindlichen und aktuell aufgelösten Versionen stehen in `package.json`
und `package-lock.json`. Production-Abhängigkeiten werden in CI mit
`npm audit --omit=dev --audit-level=high` geprüft.


### Systemmails und PDF-Belege

Die vier Ereignisse Bestellung, Mietverlängerung, Rückgabe und abgeschlossener
Auftrag erhalten einen PDF-Beleg. Onlinebestellungen bekommen zunächst einen
Eingangsbeleg mit offenem Zahlungsstatus; die Bestätigung folgt nach Zahlung.
Der Abschlussbeleg entsteht nach vollständiger Rückgabe und Ausgleich der offenen
Zahlungen und Erstattungen. Rückgabemails werden serverseitig beim Speichern
vorgemerkt. Jeder Beleg enthält den damaligen Datenstand und die bei der Bestellung
geleistete Unterschrift; sie wird nicht als neue Unterschrift für Folgeereignisse
bezeichnet. Die PDF-Belege sind keine Umsatzsteuerrechnungen.

Für echten Versand in `.env` setzen:

- `DISABLE_EMAILS=0`
- `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` für die vorhandene Graph-Anbindung
- `GRAPH_MAIL_USER` auf das sendende Microsoft-365-Postfach
- optional `ORDER_BCC` für interne Bestellkopien (kein voreingestellter Empfänger)
- `RECEIPT_COMPANY_NAME` und `RECEIPT_COMPANY_ADDRESS` für die Firmendaten

Die Microsoft-Anwendung benötigt die bereits für die Graph-Anbindung vorgesehene
Berechtigung zum Mailversand aus diesem Postfach. Geheimnisse bleiben in `.env`.
Nach Änderungen Container neu erstellen:

```powershell
docker compose -f compose.yml -f compose.local.yml up -d --build --wait
```

Fehlen Graph-Einstellungen, bleiben Mails in der Outbox vorgemerkt, ohne
Versandversuche zu verbrauchen; Zahlungsoperationen laufen weiter. Mit
`DISABLE_EMAILS=1` wird Versand für Tests bewusst übersprungen. So abgeschlossene
Testmails werden später nicht nachgesendet. Vorhandene offene Mails werden nach
Einrichtung automatisch verarbeitet. Die Outbox ist keine dauerhafte Belegablage:
nach erfolgreichem Versand werden die Mailinhalte daraus entfernt. Belege werden
als Mailanhänge zugestellt. Tests verwenden keine echten Empfänger.


Rückgabenachweise enthalten die beim Festschreiben vorhandenen Rückgabefotos
als zusätzliche PDF-Seiten. Die Mailkopien werden automatisch ausgerichtet und
für den Versand verkleinert; Originaldateien bleiben unverändert. Die Bilddaten
werden zusammen mit dem Belegstand vorgemerkt, sodass Versandwiederholungen
nicht von späteren Dateiänderungen abhängen. Vor dem Festschreiben können Admins
neu ausgewählte Fotos entfernen und bereits hochgeladene Fotos einzeln löschen,
auch nach einem abgelehnten Speicherversuch. Danach bleibt das Löschen gesperrt.
# Mollie lokal und im Produktivbetrieb

`MOLLIE_TEST_MODE=0` nutzt die echte Mollie-API. Ein `test_`-Schlüssel erzeugt
echte Sandbox-Checkout-Links ohne Echtgeld; `live_` verarbeitet echte Zahlungen.
`MOLLIE_TEST_MODE=1` ist ausschließlich die interne Offline-Simulation der Tests
und erzeugt keine erreichbaren Zahlungslinks. Compose übernimmt jetzt den Wert
aus `.env`. Nach Änderungen den App-Container neu erstellen.

`BASE_URL` ist die Browser-Rücksprungadresse. `MOLLIE_WEBHOOK_URL` kann unabhängig
davon auf eine öffentlich erreichbare HTTPS-Adresse mit Pfad `/webhooks/mollie`
zeigen. Mollie kann `localhost` nicht erreichen. Lokal ohne öffentliche Adresse
wird kein ungültiger Webhook an Mollie gesendet; die laufende Anwendung gleicht
stattdessen alle bekannten echten Zahlungen in Batches von 20 pro Minute ab.
Der Abgleich läuft auch mit Webhooks als Wiederherstellung bei verpassten
Ereignissen. Mit `MOLLIE_RECONCILIATION_ENABLED=0` lässt er sich abschalten.
Ein ausgeschalteter Rechner empfängt keine Updates; Produktion benötigt einen
dauerhaft erreichbaren Server und Webhooks.

Zahlungsanfragen enthalten Betrag/Währung, Beschreibung, Bestell-/Positionsbezug,
deutsche Sprache, Kundenname, E-Mail, Rechnungsanschrift und Positionen einschließlich
Kaution. Da die Anwendung bisher kein Kundenland erfasst, gilt das konfigurierte
`MOLLIE_BILLING_COUNTRY` (Standard `DE`). Bei internationalen Kunden muss das Land
vorher pro Kunde erfasst werden. Die verfügbaren Zahlungsarten werden im Mollie-
Dashboard freigeschaltet; ihre Verfügbarkeit hängt auch vom Zahlungsbetrag und
der Freischaltung des Händlerprofils ab.

Storno-, Kautions- und Doppelzahlungs-Erstattungen verwenden die Refund-API mit
stabiler Idempotenzreferenz. Statusänderungen und im Dashboard ausgelöste Refunds
werden abgeglichen. Chargebacks werden anhand der separaten Mollie-Ressourcen
mit tatsächlichem Betrag und Rücknahmen (`reversedAt`) verbucht. Sie werden von
Kunden/Banken ausgelöst, nicht vom Händler als Erstattung angelegt. Aktive
Chargebacks kennzeichnen die Bestellung als Zahlungsstreit, ohne ihren Mietstatus
zu verändern. Alte `tr_test_...`-Datensätze der internen Simulation sind keine
Mollie-Zahlungen; für vollständige Sandbox-Tests eine neue Bestellung anlegen.


### Kundenstornierung und Widerruf

- Im Kundenkonto können eigene Bestellungen vor der ersten Abholung vollständig und kostenfrei storniert werden. Online-Erstattungen verwenden die bestehende Mollie-Abwicklung; Barzahlungen werden zur Auszahlung vorgemerkt. Wiederholte Klicks erzeugen keine weiteren Erstattungen.
- `/widerruf.html` ist ohne Anmeldung erreichbar und von den Seiten über **Vertrag widerrufen** verlinkt. Kunden prüfen ihre Erklärung und senden sie mit **Widerruf bestätigen** ab. Ein Grund ist nicht erforderlich; Vertragsbeschreibungen und Teilwiderrufe sind möglich. Es gibt keine pauschale Fristsperre.
- Der Eingang wird mit unverändertem Inhalt, UTC-Zeit und Vorgangsnummer gespeichert, per E-Mail bestätigt und zusätzlich als Textdatei angeboten. Der Mailversand erfolgt über die dauerhafte Outbox mit Wiederholungsversuchen. Versandfehler müssen im Betrieb überwacht werden.
- Die öffentliche Widerrufsseite und ihr Eingangs-Endpunkt behandeln ausschließlich Widerrufe. Freiwillige Stornierungen erfolgen separat im angemeldeten Kundenkonto.
- Das Admin Dashboard enthält **Widerrufe & Stornierungen**. Widerrufe müssen zugeordnet und ihre Rückabwicklung bearbeitet werden. **Als bearbeitet dokumentieren** protokolliert erledigte Schritte und führt selbst keine Erstattung aus. Eine Admin-Genehmigung ist keine Voraussetzung für den Eingang des Widerrufs.
- `CONTRACT_REQUEST_EMAIL` kann das interne Benachrichtigungspostfach festlegen; andernfalls werden `ORDER_BCC` bzw. `GRAPH_MAIL_USER` verwendet.
- Vor dem Produktivbetrieb müssen die für die konkreten Mietverträge geltende Widerrufsbelehrung, das Musterformular, AGB und gegebenenfalls der vorzeitige Leistungsbeginn rechtlich geprüft und in Checkout/Vertragsunterlagen eingebunden werden. Die technische Funktion ersetzt diese Prüfung nicht. Grundlage der elektronischen Funktion: https://www.gesetze-im-internet.de/bgb/__356a.html


### Produktmerkmale und Produkt-Key

Neue Produkte erhalten serverseitig einen eindeutigen `SR-…`-Key. Manuell übergebene Keys werden ignoriert; vorhandene Keys bleiben beim Bearbeiten unverändert. Die Migration `20260927_08_product_attributes` ergänzt Hersteller, Modell, Art, Farbe, Leistung mit Einheit (kW/PS/W), Betriebsstunden und Kilometerstand ohne bestehende Produktdaten umzuschreiben.

Hersteller und Modell unterstützen freie Eingaben und `n.V.`. Die lokale Marken-Startliste liegt in `config/productCatalog.json`; die Auswahl wird um gespeicherte Hersteller und Modelle des Bestands ergänzt und nach Art bzw. Marke gefiltert. Es handelt sich nicht um einen vollständigen Hersteller-/Modellkatalog. Es erfolgen keine externen API-Aufrufe. Optionale Zahlen werden bei leeren Feldern als NULL gespeichert; Nullwerte bleiben echte Messwerte. Einheiten werden nicht automatisch umgerechnet. Zusätzliche vorgeschlagene Merkmale wie Seriennummer, Baujahr oder Gewicht sind noch nicht Bestandteil des Schemas.

### Übergabeprotokoll vor Abholung

Im Admin Dashboard unter **Bestellungen → Details → Übergabeprotokoll öffnen / erstellen**
wird ein Protokoll je Auftrag vor der ersten Abholung angelegt. Einträge sind einem
Artikel zugeordnet und unterscheiden Beschädigung, Kratzer und sonstige Bemerkung.
Bis zu 20 Einträge und insgesamt 20 Fotos sind möglich, höchstens sechs Fotos je
Eintrag. Fotos werden in JPEG umgewandelt, verkleinert und ohne Original-Metadaten
in der Datenbank gespeichert. Alternativ lässt sich ausdrücklich „Keine Auffälligkeiten“ bestätigen.

Entwürfe lassen sich speichern und erneut öffnen. Die Unterschrift wird erst beim
Festschreiben gespeichert; jede inhaltliche Änderung im Formular erfordert eine neue
Unterschrift. Der Kunde bestätigt das vollständige Protokoll mit Namen und einer
neu geleisteten Unterschrift auf dem Gerät. Die Bestellunterschrift wird nicht übernommen.

**Unterschrieben festschreiben & versenden** speichert das unveränderliche PDF mit
allen Einträgen, Fotos und der Unterschrift direkt am Auftrag und stellt dieselbe PDF-Datei
in die vorhandene Mail-Outbox (Systemabsender und `ORDER_BCC` wie bei Bestellungen).
„Zum Versand vorgemerkt“ bedeutet noch keine bestätigte Zustellung. Der Beleg bleibt
unabhängig von der Outbox-Aufbewahrungsfrist über den PDF-Download verfügbar.
Datenbank-Backups enthalten auch die Protokolle und ihre Fotos.

Angemeldete Kunden finden das festgeschriebene Protokoll unter **Meine Bestellungen →
Details → Übergabeprotokoll**. Ansicht und Download liefern dasselbe gespeicherte PDF
wie im Admin Dashboard. Der Zugriff prüft die E-Mail-Zuordnung der Bestellung;
Entwürfe und fremde Protokolle werden nicht ausgeliefert. Ohne festgeschriebenes
Protokoll wird ein Verfügbarkeitshinweis angezeigt.

Jede neue Abholung setzt ein unterschriebenes und festgeschriebenes Übergabeprotokoll
voraus. Ohne Protokoll oder mit einem Entwurf bleibt die Abholung gesperrt. Bereits
abgeholte Aufträge erhalten kein nachträglich als Übergabe ausgegebenes Protokoll.
Neue Datenbanktabelle: `handover_reports`, automatische Migration `20260927_09_handover_reports`.

### Gutscheincodes und Rabatte

Unter **Admin Dashboard → Gutscheine & Rabatte** lassen sich Codes mit prozentualem
Rabatt, optionalem Gültigkeitsbeginn und -ende sowie Aktivierungsstatus verwalten.
Ohne Enddatum gilt ein aktivierter Code unbegrenzt; ein Enddatum gilt einschließlich
dieses Tages in der konfigurierten Geschäftszeitzone. Codes sind mehrfach verwendbar,
pro Bestellung ist ein Code möglich. Groß-/Kleinschreibung spielt keine Rolle.

Der Kunde wendet den Code im letzten Checkout-Schritt vor der Unterschrift an.
Rabattiert wird ausschließlich die ursprüngliche Mietsumme, centgenau über die
Positionen verteilt. **Die Kaution bleibt unverändert.** Spätere Verlängerungen,
Schäden und Zusatzforderungen werden nicht rabattiert. Die neue Gesamtsumme wird
vor dem Abschluss angezeigt; eine Änderung am Gutschein löscht eine bereits
geleistete Checkout-Unterschrift. Der Server prüft Gültigkeit und Vorschau erneut.

Code, Prozentsatz und Rabattbeträge werden an der Bestellung gespeichert. Änderungen
oder Deaktivierungen des Codes verändern bestehende Bestellungen nicht. Zahlungen,
Belege und Stornoerstattungen berücksichtigen die gespeicherten Rabatte. Eine
Bestellung ohne verbleibenden Zahlbetrag wird ohne Zahlungsanbieter bestätigt.
Die automatische Migration `20260927_10_discount_codes` legt die Verwaltungstabelle
und zusätzliche Bestellfelder an; vorhandene Bestellungen erhalten keinen Rabatt.

## Mollie Tap / POS

Unter **POS & Terminals** zeigt das Admin-Dashboard alle Geräte des mit
`MOLLIE_API_KEY` verbundenen Mollie-Profils an (inklusive weiterer API-Seiten).
Lokale Namen, Standortangaben und Freigaben werden je Terminal und Test-/Live-Modus
gespeichert. Eine lokale Sperre deaktiviert das Gerät nicht bei Mollie. Kopplung,
Entkopplung und Kontozuordnung erfolgen weiterhin im Mollie-Dashboard.

Bei offenen Vor-Ort-Zahlungen erscheint **Mit Karte / Tap bezahlen**. Das Gerät
wird ausdrücklich ausgewählt, der Betrag serverseitig aus den Zahlungsbelegen
ermittelt. Initialzahlung, Verlängerungen und Rückgabe-Nachzahlungen werden
unterstützt; ein bestehender Online-Checkout muss zunächst abgeschlossen werden.
Pro Gerät ist ein offener Vorgang möglich; andere Geräte können parallel kassieren.
Der Auftrag wird erst nach bestätigtem Mollie-Status bezahlt. Die Zahlungs-ID bleibt
für Rückerstattungen erhalten; Kartenzahlungen werden nicht als Bargeld verbucht.
Die manuelle Zahlungsbuchung dient ausschließlich Bargeldzahlungen.

Für echte Mollie-Sandbox-Tests einen `test_`-API-Schlüssel verwenden und
`MOLLIE_TEST_MODE=0` setzen. `MOLLIE_TEST_MODE=1` ist nur das lokale Offline-Testdouble.
Bei virtuellen Terminals erscheint ein Link zur Mollie-Statussimulation. Ein aktives
Testterminal sowie die POS-Freischaltung des Profils sind Voraussetzung. Für Live
wird der entsprechende `live_`-Profil-Schlüssel und ein gekoppeltes Tap-Gerät benötigt.
`BASE_URL` und gegebenenfalls `MOLLIE_WEBHOOK_URL` müssen öffentlich korrekt gesetzt
sein. Zusätzlich zu Webhooks kann der Admin den Status prüfen. Das Schließen des
Dialogs storniert keine Zahlung; Abbruch erfolgt am Gerät bzw. im Testsimulator.

Die Migration `20260928_11_pos_terminals` ergänzt die Geräteverwaltung und die
Terminalreferenz an Zahlungsbelegen. Bestehende Zahlungen werden nicht umgebucht.

### Lokales Rechnungswesen

Segnitz Rental erstellt Rechnungen und Rechnungskorrekturen selbst. Die frühere externe Rechnungserstellung und die Testempfänger-Konfiguration sind entfernt. Mollie verarbeitet nur noch Zahlungen und Erstattungen.

Unter **Admin → Rechnungen** müssen vor der ersten Ausstellung die vollständigen Rechnungssteller-Daten hinterlegt werden. Leere Pflichtdaten blockieren die Ausstellung; es werden keine Unternehmensdaten erfunden. Die derzeitige Besteuerung verwendet 19 % Umsatzsteuer. Der Checkout bietet ausschließlich Onlinezahlung und Zahlung bei Abholung. Nur der Admin kann in der jeweiligen offenen Bestellung Überweisung vereinbaren; dafür muss Banküberweisung im Mollie-Profil aktiviert sein. Laufende oder ungeklärte Onlinezahlungen blockieren die Umstellung. Überweisung hat 14 Tage Zahlungsziel ab Rechnungsdatum; Miete und Kaution werden gemeinsam bezahlt. Bei Kauf auf Rechnung ist die Abholung vor Zahlung beider Beträge erlaubt. Die rückzahlbare Sicherheitsleistung wird ohne Umsatzsteuer getrennt vom steuerpflichtigen Mietbetrag ausgewiesen. Zusätzlich ist das unterschriebene, festgeschriebene Übergabeprotokoll erforderlich.

Rechnungsnummern (RE-JJJJ-NNNNNN) und Korrekturbelege (RK-JJJJ-NNNNNN) werden transaktional fortlaufend vergeben. Ausgestellte PDFs und ihre Datenschnappschüsse bleiben unverändert, einschließlich ursprünglicher Rechnungssteller-Daten und Bestellunterschrift. Korrekturen referenzieren die ursprüngliche Rechnung. PDF- und XML-Prüfsummen werden gespeichert. Ein vollständiges Datenbankbackup ist deshalb auch für das Rechnungsarchiv erforderlich.

Teilstornierungen und vollständige Stornierungen erzeugen Rechnungskorrekturen. Rabattierte Mietkosten und Kaution bleiben getrennt. Erstattungen gehen ausschließlich an das ursprüngliche Zahlungsmittel; bei einer Teilstornierung wird der bisherige Überweisungsauftrag beendet und erst nach bestätigtem Endstatus bei Mollie mit dem reduzierten Betrag neu erstellt. Eine noch nicht vereinnahmte Kaution wird nicht ausgezahlt; nach späterem Zahlungseingang wird eine berechtigte Rückerstattung vorgemerkt. Überweisungen werden ausschließlich über Mollie erstellt und per Webhook bzw. Statusabgleich bestätigt. Mollie versendet die Überweisungsdaten an die Account-E-Mail; PDF und XML enthalten Mollies unveränderten Verwendungszweck. Manuelle Bankbuchungen sind gesperrt. Rückzahlungen erfolgen über die ursprüngliche Mollie-Transaktion. Barzahlung bleibt als ausdrücklich erlaubte Ausnahme bestehen. Historische Bankbuchungen ohne Mollie-Transaktion können nicht nachträglich über Mollie erstattet werden.

**Meine Rechnungen** und das Adminarchiv bieten eine paginierte Volltextsuche nach Nummer, Datum, Betrag, Kunde, E-Mail, Status und Artikeln. Kunden können ausschließlich eigene Belege herunterladen. Die Bestellübersicht verlinkt verfügbare Rechnungen links neben Details. Das System versendet Dokumente über den eingerichteten Systemabsender an den Kunden. Es gibt keinen separaten Testempfänger für Rechnungen mehr. Der Hintergrundworker wiederholt vorübergehend fehlgeschlagene Ausstellungen. Änderungen an Stammdaten verändern keine alten PDFs.

Die automatische ursprüngliche Mietrechnung wird bei Überweisung nach Freigabe durch den Admin und bei anderen Zahlungsarten nach Zahlungseingang ausgestellt. Bestehende Aufträge ohne Rechnungsvormerkung werden nicht rückwirkend fakturiert. Historische externe Rechnungs-PDFs bleiben zur Vermeidung von Doppelrechnungen archiviert und werden nicht mehr extern synchronisiert. Erweiterungen und Rückgabeforderungen behalten ihre bisherigen Belege. Neue Rechnungen und Rechnungskorrekturen werden als strukturierte UBL-2.1-XML nach EN 16931 sowie als PDF-Lesefassung erstellt und gemeinsam per E-Mail versandt. XML und PDF weisen dieselbe Miete mit 19 % Umsatzsteuer aus. Die Kaution ist keine steuerpflichtige Mietleistung; die gemeinsame Zahlungsanforderung steht gesondert im PDF und im XML-Hinweis. Das Format ist kein ZUGFeRD-Container und keine XRechnung-CIUS. Historische Originale bleiben unverändert.
