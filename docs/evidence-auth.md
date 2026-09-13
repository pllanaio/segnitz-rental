# Authentifizierung und Bild-Uploads – Umsetzungsnachweis

Stand 13.09.2026. Arbeitsbasis `1382a95444be15f692f4a8800ab521b11c3d4683`, isolierter Branch/Checkout rc-auth. Keine produktiven Providerkontakte oder Migrationen ausgeführt.

## Umsetzung und Abnahme

| Befund | Umsetzung | Ausgeführter Nachweis | Restpunkt |
|---|---|---|---|
| Passwortänderung lässt Reset-Link gültig | Unter derselben `users ... FOR UPDATE`-Sperre werden Passwort, `auth_version`, `reset_token = NULL` und Ablauf geändert. Resetanforderung sperrt denselben Benutzer; Reset verbraucht gehashten Code mit DB-Ablaufbedingung atomar. | Erweiterte bestehende echte HTTP/MySQL-Integration: Reset anfordern, Mailboxcode gegen gespeicherten Hash prüfen, regulär ändern, alten Link ablehnen; bestehender Parallel-Reset/Sessionwiderruf bleibt enthalten. | MySQL-Lauf in dieser Umgebung nicht möglich; kein Pass behauptet. |
| Adminpolicy über Change/Reset umgehbar | Gemeinsame Rollenpolicy für Setup, Registrierung, reguläre Änderung, Reset und Provisionierung; bcrypt cost 12, maximal 72 UTF-8-Bytes. Admin/Bearbeiter: 12 Zeichen, Groß-/Kleinbuchstabe, Zahl, Sonderzeichen; Kunden: bestehende 8-Zeichen/Zahl/Sonderzeichen-Policy bleibt. | Baseline-Export `isValidPassword('klein1!a', 'global_admin')` reproduzierbar rot; neue Rollenpolicy-Tests grün; Admin-Reset-HTTP-Regression vorbereitet. | Integration auf MySQL ausführen. |
| Nutzbare Tokens in Datenbank/Operationsschlüsseln | Reset- und Nutzer-/Gastverifikationscodes als `sha256:<Digest>` in bestehenden Spalten; ausschließlich Klartext aus Link wird gehasht und verglichen. UUID als Reset-Mail-Key; Workerlog nur numerische Effekt-ID/Fehlercode; Outboxfehler redigiert. | `test/auth-secrets.test.js`: Hashformat, Nichtverwendbarkeit des gespeicherten Hashes als Bearercode, Redaction. | Operations übernimmt zentrale Redaction; umgebungsabhängige Logsenken separat verifizieren. |
| Sensible Legacy-Metadaten | Neue unveränderliche `20260913_02_auth_secrets`: alte 64-Hex-Codes hashen, ausschließlich auth-bezogene Reset-Schlüssel rekeyen, Payload-Metadaten angleichen, abgeschlossene/tote Auth-Mailpayloads redigieren. Finanzschlüssel unverändert. Bereits gehashte Codes überspringen. | Echte MySQL-Integration für zweifache Migration/Finanzschlüssel/Pending-Payload vorbereitet. | Registrierung durch DB-Arbeitspaket; Backup, isolierter Upgrade-/Retry-Nachweis vor Betreiberfreigabe. |
| Pfadparameter vor Multer ungeprüft | Positive kanonische sichere Ganzzahl vor jeder Upload-Middleware; Dateinamen ausschließlich UUID und `.webp`; private Returns bleiben privat. | Echter Express/Multer HTTP-Multiparttest: `0`, negativ, Exponent, unsichere Ganzzahl, kodierter Slash, führende Null werden 400 ohne Datei. | Bestehende private Owner-/CSRF-MySQL-Tests ausführen. |
| MIME-Vertrauen, unkontrollierte Bildinhalte/Signatur | Sharp decodiert/re-encodiert Bilder zu WebP, Signaturen zu PNG; MIME muss tatsächlichem Format entsprechen; EXIF/XMP/GPS werden verworfen. 5 MiB/Bild, 20 MiB/Request, 10 Dateien/Request, 16 Mio. Pixel/Bild bzw. 2 Mio./Signatur; 4 gleichzeitige Decodes. Rückgaben maximal 20 Bilder je Position unter Positionslock. | Reale Decoder-/HTTP-Tests für kaputte Inhalte, falschen MIME, Metadatenentfernung, Pixelgrenze, Bytegrenze, Formularindex-Angriff, Requestabbruch und Fehlerbereinigung; Erfolg erzeugt nur normalisierte UUID-Datei. | MySQL-Quoten-/Besitztests und Produktionslast mit Bildspeicherprofil ausführen. |
| HTML/Leak-Fehler bei Parser/Upload | Zentrale JSON-Fehler 400/413/415/503, generischer interner Fehler ohne Stack; ausgelasteter Decoder liefert Retry-After. Multer-Arrayindex und Verschachtelung explizit begrenzt. | Tatsächliches HTTP-JSON-Parsing und Multipartfehler geprüft. | 429/CSRF/Sessionfehler im vollständigen E2E-Gate. |

## Tatsächlich ausgeführte Befehle

- `node --test test/auth-secrets.test.js`: zunächst rot (fehlende neue Module), danach 3/3 grün. Separat gegen das unveränderte Baseline-Modul ausgeführte Adminpolicy-Verhaltensassertion rot (`true !== false`).
- `node --test test/upload-content.test.js`: 3/3 grün; enthalten sind echte HTTP-Multipartrequests, ein abgebrochener Upload, echter Sharp-Decoder und JSON-Parser. Während Implementierung rot wegen Cleanup eines bereits abgebrochenen Uploads ohne Dateipfad; `_removeFile` korrigiert und erneut grün.
- `node --test test/*.test.js`: **151 Tests, 151 bestanden**, keine übersprungenen Tests (Node 24.19.0, gepatchte Dependencies inklusive Sharp 0.35.4/Multer 2.3.0 aus Dependency-Arbeitspaket).
- `npm run check:syntax`: **92 Dateien erfolgreich** einschließlich des MySQL-Migrationstests; finales Gesamtgate muss auf integriertem Commit erneut laufen.

Nicht ausgeführt: MySQL-Integration, Playwright und produktive Migration. Die bestehenden Tests wurden an echte PNG-Signaturen und isolierte Outbox-Testmailboxen angepasst; sie lesen keine verwendbaren Authcodes mehr aus `users` oder `guest_verifications`.

## Token-Retention und Wiederherstellung

Pending-/Retry-Auth-Mailpayloads benötigen den Klartextlink bis zur Übergabe an Graph; Hashing der Benutzerzeile beseitigt diesen bewussten sensiblen Datenbestand nicht. Outbox-Zugriff und verschlüsselte Backups auf zuständige Betreiber beschränken, keine Payloads in Logs/Tracing kopieren. Erfolgreiche Payloads werden wie zuvor unmittelbar redigiert; künftig werden auch erschöpfte Auth-Mailpayloads unmittelbar redigiert. Ein toter/redigierter Authmailjob darf nicht blind wiederholt werden: Kunde fordert einen neuen Link an. Bestehende valide Codes können nur aus noch vorhandenen ausstehenden Auth-Mailpayloads für eine erneute Verifikationsmail gewonnen werden, niemals aus dem Hash. Sind diese bereits redigiert, wird unter Benutzersperre ein neuer Code erzeugt. Finanzielle Deduplizierungsschlüssel werden niemals rotiert oder redigiert.

Die Datenmigration hasht Legacy-Hexcodes einmalig in situ; dieselben bereits versandten Links funktionieren nach dem Upgrade bis zu ihrem Ablauf. Ein Downgrade auf Klartext-vergleichenden Altcode ist nach Migration inkompatibel und bedarf einer DB-kompatiblen Recoveryversion. Keine Rücktransformation von Hashes und kein Datenreset.

**Freigabestatus dieses Pakets:** lokale Syntax-/Unit-/reale Middlewaretests bestanden, MySQL-/E2E-Abnahme und betriebliche Nachweise offen; keine Produktionsfreigabe.

## Review-Nachbesserung

Nach unabhängigem Dependencyreview: Auch ungültige Multipart-Feldnamen und Parser-Charsetfehler erhalten JSON mit 400/415, Größenfehler bleiben 413. Maximal vier Uploadanfragen werden **vor dem Puffern** zugelassen; weitere Anfragen bekommen 503 mit Retry-After. Zusätzlich zu vier gleichzeitigen Decodes ist dadurch der Eingangsbuffer pro Prozess begrenzt. Fehler-/End-Events können keine doppelte Callback-Ausführung und spätere verwaiste Dateien mehr verursachen. Echte HTTP-Tests für vier parallel gestallte Multipartrequests, fünften Request mit 503, Cleanup/Recovery, Verschachtelung, JSON-Größe und Charset: grün. Vollständige Unit-Suite erneut **151/151 grün**.

MySQL-Test ergänzt: regulärer Passwortwechsel und Reset starten parallel hinter einer echten Benutzersperre; eine zweite MySQL-Verbindung beobachtet beide wartenden Mutationen; nach Freigabe darf genau eine erfolgreich sein und nur ein Passwort gelten. Dieser Integrationstest ist implementiert/syntaxgeprüft, mangels MySQL noch nicht ausgeführt. Verifikations-TTL basiert auf 24 realen Stunden (`Date.now`) statt DST-abhängigem `setHours`.

## Nachprüfung: letzter Lease-Abbruch

Bei der Dokumentationsprüfung wurde ein weiterer konkreter Retentionfehler reproduziert: Nach einem Workerabbruch im letzten Versuch setzte der Lease-Reaper Auth-Mails auf `dead`, behielt aber deren Klartextlink. Der neue Verhaltenstest war vor dem Fix rot (Payload enthielt weiter den synthetischen Link). `claimExternalEffect` und der reguläre Fehlerpfad verwenden nun denselben Auth-Mail-Scrubber innerhalb der bestehenden Transaktion; Operation-Key und unveränderlicher Payload-Hash bleiben erhalten. Finanzvorgänge und gewöhnliche Geschäftsmails behalten ihre Payloads.

Ausgeführt: `node --test --test-name-pattern='letzte abgelaufene Auth' test/external-effects.test.js` vor Fix: **0/1 grün**; `node --test test/external-effects.test.js test/auth-secrets.test.js` nach Fix: **32/32 grün**. Zusätzlich ist der echte MySQL-Neustart-/zweimalige-Reaper-Test in `test/integration/auth-secrets-migration.integration.test.js` vorbereitet; lokal wegen fehlendem MySQL nicht ausgeführt. Pausierte Mailjobs werden weiterhin nicht vom Reaper übernommen.
