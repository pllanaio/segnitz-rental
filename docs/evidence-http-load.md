# Reale HTTP-/MySQL-Stauprobe: vorbereiteter Abnahmetest

Stand 13.09.2026, Ausgangscommit `e9d292ff`, isolierter Branch
`codex/rc-load-integration-20260913`. Der neue Test ergänzt die vorhandenen
Budget-/SQL-/Probe-Komponententests um den vollständigen tatsächlichen
`server.js`-Startpfad, Sessionstore, Middleware und eigene API-Endpunkte.

## Definiertes isoliertes Profil

`test/integration/http-load-recovery.integration.test.js` erstellt ausschließlich
eine neue unvorhersehbar benannte `segnitz_http_load_test_<pid>_<random>`-Datenbank,
initialisiert das kanonische Schema mit unverändertem Migrationsmanifest und
fügt genau einen verifizierten synthetischen Administrator hinzu. Kein fremdes
Schema und kein Bildvolume wird verändert. Eine echte Anmeldung erzeugt ein
persistiertes Sessioncookie; Cookie/CSRF/Passwort werden nicht ausgegeben.
Mollie bleibt lokal simuliert, Mailjobs pausiert, periodische Fachbereinigung und
Paymentreconciliation deaktiviert. Der echte Outboxworker bleibt mit 250-ms-Takt
aktiv und teilt das DB-Budget.

| Einstellung / Phase | Konkreter Testvertrag |
| --- | --- |
| DB-Verbindungen | 4 insgesamt im App-Kindprozess: 3 normale und höchstens 1 serielle Kontrollconnection; externe Lock-/Beobachterverbindung separat |
| Queue / Fristen | Queue 4, Acquire 250 ms, Query 4000 ms, Readiness 350 ms; unabhängige Observer-/Holder-Verbindungen verwenden das normale Test-Runtimebudget |
| Kontrollierter Lock | Eine externe eigene Transaktion sperrt ausschließlich die eigene synthetische Benutzerzeile; drei tatsächliche `PUT /my-profile` versuchen einen abweichenden Adresswert zu schreiben |
| Nachweis vor Belastung | Eine zweite echte MySQL-Verbindung sieht alle drei App-UPDATEs am Lock warten; die Probe beginnt erst dann |
| Burst | 24 gleichzeitige echte HTTP-Requests: 8 `/live`, 8 `/ready`, 8 authentifizierte `/my-profile`; jeweils vier Live-/Ready-Proben mit echtem Sessioncookie und vier ohne Cookie |
| Liveness | Alle 8 liefern 200; jeder Request unter 750 ms einschließlich dokumentierter CI-Scheduler-/HTTP-Toleranz |
| Readiness / API | Alle 8 Ready- und 8 Profilabrufe liefern 503, jeder unter 1500 ms; weder Loginverlust noch ein unbekannter DB-Zustand wird als erfolgreich ausgegeben |
| SQL-Frist | Alle 3 gesperrten Schreibrequests liefern 503 unter 6500 ms einschließlich SQL-/HTTP-Abschlussreserve |
| Ressourcen | PROCESSLIST-Sampling während des Staus: höchstens 4 App-Threads; alle drei zuvor gesperrten konkreten Thread-IDs müssen vor Freigabe des Testlocks verschwinden |
| Kein verspäteter Schreibeffekt | Ursprüngliche Adresse bleibt sowohl vor Lockfreigabe als auch nach API-Erholung erhalten; die versuchte abweichende Adresse darf nicht später committen |
| Erholung | Live/Ready mit und ohne Cookie wieder 200; dieselbe Session liest Profil und Adminmetriken, Produkt-API liefert 200; Queue 0, höchstens 2 aktuell legitime Slots (eigener Authcheck vor dessen finally/end plus periodischer Worker), keine Quarantäne/Cancellationfehler, tatsächlich erhöhte Reject-/Acquire-Timeoutzähler |
| Shutdown | Tatsächliches SIGTERM/Runtime-Drain, Exit 0; danach keine App-/Kontrollconnection mehr in der ausschließlich eigenen DB |

Die 27 kontrollierten Belastungsrequests (3 blockierte Schreibrequests plus
24 Burstrequests) werden von Setup, Login, Erholungsprüfungen und Observer-SQL
getrennt gezählt. Der Test gibt nach vollständigem Erfolg ausschließlich numerische
Messwerte und feste Bezeichnungen aus: tatsächliche Statuscounts, maximale Live-/
Ready-Latenz, maximal beobachtete App-Threadzahl, Queue-/Fehlerzähler und Shutdowncode.
Er erzeugt keine Testendpunkte, ersetzt keine eigene API und verändert keine
produktiven Limits. MySQL darf die wartende Query bereits durch sein eigenes
InnoDB-Locklimit beenden; andernfalls wirkt die Clientdeadline. In beiden Fällen
muss die tatsächliche Serverconnection verschwinden. Der getrennte vorhandene
SQL-Test erzwingt gezielt den KILL-Pfad.

## Ausführung und Aussagegrenzen

Lokal ausgeführt:

```sh
node --check test/integration/http-load-recovery.integration.test.js
git diff --check
```

Beide Prüfungen bestanden. Eine unabhängige Quellprüfung korrigierte vor Übergabe
die ursprünglich zu schwache unveränderte-Payload-Fixture: Der versuchte
Adresswert unterscheidet sich nun tatsächlich vom gespeicherten Wert. Außerdem
wird das Verschwinden der konkreten gesperrten Serverthread-IDs geprüft, nicht nur
das Ende einer sichtbaren SQL-Anweisung.

**Noch kein lokaler MySQL-/HTTP-Lastpass:** Es steht lokal kein MySQL-Server zur
Verfügung. Der Test wird über den vorhandenen seriellen MySQL-CI-Job automatisch
mit `npm run test:integration` ausgeführt. Der erste tatsächliche Lauf muss die
hier genannten Status-/Latenz-/Thread-/Queue-Messwerte liefern; Syntax ist dafür
kein Ersatz. Ein fehlschlagender Start-/DB-Hook wird nicht als ausgeführter
Lastversuch gewertet.

Dieses begrenzte deterministische Profil ersetzt nicht das in
[operations.md](operations.md) beschriebene 60-Sekunden-Lastprofil auf der
vorgesehenen Produktionshardware, keine Replik-/Netzwerktopologieprüfung und
keine gemessenen produktiven Perzentile. Die großzügigeren CI-Latenztoleranzen
sind keine Betreiber-SLO-Zusage. Es wurden keine produktiven DBs, Provider,
Migrations- oder Deploymentaktionen ausgeführt.
