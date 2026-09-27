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

Jede neue Abholung setzt ein unterschriebenes und festgeschriebenes Übergabeprotokoll
voraus. Ohne Protokoll oder mit einem Entwurf bleibt die Abholung gesperrt. Bereits
abgeholte Aufträge erhalten kein nachträglich als Übergabe ausgegebenes Protokoll.
Neue Datenbanktabelle: `handover_reports`, automatische Migration `20260927_09_handover_reports`.
