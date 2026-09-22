# Isolierte TLS-Abnahme im Restore-Kandidaten

Stand13.09.2026, vorbereitet im vorhandenen isolierten Restoreverfahren. Keine
Betreiber-CA, privaten Betreiberkeys, produktiven DBs oder Providerkontakte verwendet.

Die Rehearsal erzeugt zwei unabhängige kurzlebige CAs und ein auf zwei Tage
begrenztes Serverzertifikat mit SAN `restore-mysql`, `localhost`, `127.0.0.1`.
Private Schlüssel sind0600 in einem neu angelegten0700-Verzeichnis; nur öffentliche
CA-Zertifikate sind lesbar für den unprivilegierten Appbenutzer. Die CA-Keys
werden in keinen Container eingebunden. Der ausschließlich neu erzeugte MySQL-
Container kopiert seine drei benötigten Dateien in private eigene Pfade und
ändert keine Host-Dateieigentümer. Er verlangt `require_secure_transport=ON`.
Die MySQL-Startoptionen und `VERIFY_IDENTITY` entsprechen dem
[offiziellen MySQL-Vertrag](https://dev.mysql.com/doc/refman/8.4/en/using-encrypted-connections.html).

Der bereits gebaute und gescannte App-Kandidat führt
`scripts/ops/verify-database-tls.js` im internen providergesperrten Docker-Netz aus:

1. Passende CA und `restore-mysql`: tatsächliche SQL-Queries bestätigen
   Verschlüsselung, TLS1.2/1.3 und die UTC-Session.
2. Nur die CA wird durch eine unabhängige CA ersetzt: der echte mysql2-Handshake
   muss `HANDSHAKE_SSL_ERROR` liefern. Timeout/DNS-/Loginfehler gelten nicht als Pass.
3. Nur der Hostname ändert sich zu einem anderen Alias derselben MySQL-Instanz,
   der nicht im Zertifikat steht: ebenfalls ausdrücklicher TLS-Handshakefehler.
4. Passende CA/Identität erneut: verschlüsselte SQL-Verbindung muss weiterhin gehen.

Alle Aufrufe verwenden das reale `config/db.js`, seinen UTC-/Budgetwrapper und
`rejectUnauthorized:true`, `verifyIdentity:true`, mindestensTLS1.2. Es gibt
keinen unverschlüsselten Retry und keinen austauschbaren eigenen DB-Adapter.
mysql2 verwendet dabei die
[Node-Serveridentitätsprüfung](https://nodejs.org/api/tls.html#tlscheckserveridentityhostname-cert).
Auch Quell-/Zielapp, Dump und Restore bleiben anschließend auf verifiziertem TLS;
die lokale Offlineprüfung verwendet `localhost` als geprüften DNS-Namen.
Ausgegeben werden nur feste Modus-/Ergebnisflags und Protokollversion, keine
Keys, Zertifikate, Credentials oder rohe Fehlermeldungen. Erst vollständig
bestandene Aufrufe erzeugen `databaseTlsAcceptance` im Restore-Nachweis.

Lokal ausgeführt: `node --test test/restore-tls.test.js` **2/2 bestanden**,
einschließlich echter OpenSSL-Ketten-/SAN-/Negativprüfungen und Keydateirechten.
`node --test test/database-timezone.test.js test/database-migration-credentials.test.js`
**6/6 bestanden**. Python-Kompilierung, Node-Syntax und `git diff --check` bestanden.
Die Zertifikatsfixture wurde tatsächlich erzeugt und wieder entfernt; dies ist
noch kein MySQL-TLS-Pass. **Der vollständige Docker-/MySQL-/Restorelauf steht aus.**
Voraussetzung im vorhandenen CI-Rehearsal: zusätzlich `openssl` auf dem Runner.

Ein erfolgreicher synthetischer Lauf belegt die Anwendungskonfiguration, keine
Betreiber-CA-/DNS-/Netzwerkfreigabe und keine Prüfung realer Zertifikatsabläufe.
Diese Nachweise bleiben bei der konkreten Deploymentkonfiguration erforderlich.
