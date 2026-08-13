## Segnitz Rental Manager
Modular rental tool for several types of products including tools, cars and construction machinery with database integration, pdf signing option and payment gateway integration

## Datenbank

Beim Programmstart wird die Datenbank vor dem Öffnen des HTTP-Ports automatisch
initialisiert:

- Existiert die in `DB_NAME` konfigurierte Datenbank nicht, versucht der
  Datenbankbenutzer sie anzulegen.
- Fehlende Tabellen werden aus `database/schema.sql` erstellt.
- Ausstehende versionierte Migrationen werden einmalig ausgeführt und in
  `app_schema_migrations` protokolliert. Eine nachträglich veränderte bereits
  ausgeführte Migration verhindert den Start.
- Bei Fehlern bricht der Prozess ab, anstatt mit einem unvollständigen Schema zu
  starten. Für Deployments mit mehreren Replikas wird ein MySQL-Advisory-Lock
  verwendet.

Der konfigurierte Datenbankbenutzer benötigt damit `CREATE`, `ALTER`, `INDEX`,
`SELECT`, `INSERT`, `UPDATE` und `DELETE`. Soll das Programm auch die Datenbank
selbst anlegen, wird zusätzlich `CREATE` auf Serverebene benötigt. Kann der
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

## Authors and acknowledgment
Leon Pllana @ Segnitz Rental

## Resources
Node-Modules: <br>
"pdf-lib": "^1.17.1" - https://pdf-lib.js.org <br>
"node-fetch": "^2.7.0" - https://github.com/node-fetch/node-fetch <br>
"file-saver": "^2.0.5" - https://github.com/eligrey/FileSaver.js#readme <br>
"express": "^4.18.2" - https://expressjs.com <br>
"dotenv": "^16.4.4" - https://github.com/motdotla/dotenv#readme <br>
"cors": "^2.8.5" - https://github.com/expressjs/cors#readme <br>
"bootstrap-icons": "^1.11.3" - https://icons.getbootstrap.com <br>
"bcrypt": "^5.1.1" - https://github.com/kelektiv/node.bcrypt.js#readme <br>
"mysql2": "^3.9.7" - https://sidorares.github.io/node-mysql2/docs <br>
"express-session": "^1.18.0" - https://github.com/expressjs/session#readme <br>
"nodemailer": "^6.9.13" - https://nodemailer.com<br>
<br>
Javascript Modules: <br>
Bootstrap v5.3.3 - https://getbootstrap.com <br>
@popperjs/core v2.11.8 - https://github.com/floating-ui/floating-ui#readme <br>
Signature Pad v2.3.2 - https://github.com/szimek/signature_pad <br>
Tempus Dominus v6.9.4 - https://getdatepicker.com/<br>
