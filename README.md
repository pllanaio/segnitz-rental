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
