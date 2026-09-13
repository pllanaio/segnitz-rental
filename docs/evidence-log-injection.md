# CodeQL-Logmeldungen: explizite strukturierte Aufrufe

Stand 13.09.2026; isolierte Arbeitsbasis `9ada8143`. Bearbeitet wurden die neun
CodeQL-Log-Injection-Fundstellen des CI-Laufs 124 in `segnitz_rental.js`
(Ersteinrichtung, Anmeldung, Registrierung, Rückgabemail, Verlängerung/Nachzahlung,
Rückgabe/Nachzahlung und manuelle Barzahlung), zusätzlich der unmittelbar
zusammengehörige Logout-Aufruf.

## Präzise Einordnung

Der vorgesehene `server.js`-Startpfad installierte bereits zentrale Redaction mit
JSON-Zeilenserialisierung. Der neue Verhaltenstest führte zunächst die
bestehenden konkreten Logging-Anweisungen mit genau dieser installierten
Console-Serialisierung aus: zehn Anweisungen erzeugten zehn parsebare JSON-Zeilen;
eingeschleuste CR/LF erzeugten **keinen** selbständigen gefälschten Logdatensatz.
Ein ausnutzbarer CRLF-Fehler im regulären Startpfad wird daraus nicht behauptet.

Die Aufrufstellen selbst nutzten jedoch weiterhin unstrukturierte
`console.log`-/`console.error`-Argumente, teils interpolierte Namen/E-Mailadressen
oder vollständige Providerfehlermeldungen. Deren Schutz hing von der globalen
Console-Ersetzung ab; diese Abhängigkeit war für die statische Analyse nicht
belegt. Ein zweiter Verhaltenstest der tatsächlichen Anweisungen ohne globale
Console-Ersetzung war rot: rohe Errorausgaben statt ausschließlich fester
strukturierter Ereignisse. Die Registrierung enthielt außerdem bisher unnötige
Vor-/Nachnamen im Freitext.

## Änderung

Alle zehn Aufrufstellen verwenden nun unmittelbar `observability.log` mit festen
Ereignisnamen und strukturierten Feldern. Dieser bestehende Logger redigiert
zuerst und serialisiert den Datensatz vor der einzigen Ausgabe mit
`JSON.stringify` plus genau einem Zeilentrenner. Das tatsächliche Sink-Verhalten
wird im Kindprozess geprüft, nicht durch eine Quelltextregex als erfolgreich
angenommen.

- Authereignisse enthalten einen deterministischen pseudonymen `actorRef` statt
  Name/E-Mail, gegebenenfalls Rolle und das boolesche `verificationResent`.
- Fehlerereignisse enthalten numerisch konvertierte Auftrags-/Positionsreferenzen
  und die vorhandene Errorprojektion aus Name/Code. Fehlermeldung, Stack, SQL,
  Providerantwortkörper, Mailpayload und Zugangsdaten werden nicht mitgegeben.
- `actorReference` zentralisiert die bereits vorhandene identische Hashfunktion
  der Admin-HTTP-Receipt. Deren bisherige Referenzwerte und die dauerhaften
  fachlichen Auditereignisse werden dadurch nicht verändert.
- Die Request-Korrelation stammt weiter aus dem vorhandenen AsyncLocalStorage.
  Zahlung, E-Mail, Session und HTTP-Antwortverhalten bleiben unverändert.

Kein CodeQL-Gate, Querysatz oder Schweregrad wurde abgesenkt. Keine Finding-
Unterdrückung und kein pauschales Sanitizer-Modell wurde hinzugefügt. Der nächste
reale CodeQL-Lauf muss zeigen, ob die expliziten strukturierten Pfade die neun
Meldungen auflösen; lokale Tests ersetzen diesen Nachweis nicht.

## Tatsächlich ausgeführt

| Prüfung | Ergebnis |
| --- | --- |
| `node --test test/application-logging.test.js` vor Änderung | 2 Fälle: bestehender zentral geschützter Pfad grün; direkter strukturierter Aufrufvertrag erwartungsgemäß rot |
| `node --test test/application-logging.test.js test/operations.test.js test/auth-secrets.test.js` nach Änderung | 11/11 grün, Node 24.19.0 |
| Derselbe fokussierte Satz mit Node 22.22.2 | 11/11 grün |
| `node --check segnitz_rental.js`; `git diff --check` | Grün |

Die Kindprozessprobe führt die tatsächlichen kleinen Aufrufanweisungen aus,
startet keine Datenbank/Provider und prüft feste Ereignisse, genau zehn JSON-Zeilen,
keine synthetischen privaten Werte sowie erhaltene Fehlercodes. Sie unterdrückt
nur die bekannte optionale lokale Node-22-Proxy-Preload-Warnung `UNDICI-EHPA` in
diesem netzwerkfreien Probeprozess, damit diese zusätzliche Runtimewarnung nicht
als elfter Anwendungslog gezählt wird. Andere Warnungen/Fehler bleiben sichtbar;
Produktionslogging und Securitygates werden dadurch nicht verändert.
