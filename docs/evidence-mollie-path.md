# Mollie-Testadapter: Pfadkonfinierung

Ausgangspunkt: konkreter CodeQL-Befund `js/path-injection` im CI-Lauf 124,
`services/mollieService.js:103`, geprüfter Arbeitsstand
`fe80daca67cfd21c7a121b147f287d29ea55bbf0`.

Die bisherige ID-Regex ersetzte keine Dateisystemgrenze. Verhaltenstests zeigten
drei rote Fälle: eine Symlink-Fixture konnte außerhalb des Testverzeichnisses
lesen; eine abweichende Payment-ID im Fixtureinhalt konnte bei Storno eine Datei
außerhalb überschreiben; übergroße Fixtureinhalte wurden unbegrenzt gelesen.

Der Adapter verwendet nun für alle Fixture-Lese-/Schreibpfade eine gemeinsame
Rootauflösung, Basename-Prüfung und explizite Prüfung der normalisierten
Pfadgrenze. Dateiöffnungen folgen keinen Symlinks, akzeptieren nur reguläre
Dateien und lesen höchstens 1 MiB. Payment-Fixtures müssen dieselbe ID wie die
Anfrage enthalten. Schreiben erfolgt über exklusive zufällige temporäre Dateien
mit atomarem Rename; vorhandene temporäre Pfade werden weder benutzt noch gelöscht.
Die Pfadprüfung folgt der [offiziellen CodeQL-Empfehlung](https://codeql.github.com/codeql-query-help/javascript/js-path-injection/).
Keine Queryunterdrückung, Ausnahme oder Gateänderung wurde hinzugefügt.

Fokusprüfung vor dem Fix: **1/4 grün, 3/4 rot**. Nach dem Fix einschließlich
bestehendem Fixture-Vertragstest und temporärer Symlink-Schreibprüfung: **6/6 grün**
unter Node 22.22.2 und 24.19.0. Simulator-Payment, wiederholte
Operation, Refund und Refund-Liste laufen dabei ausdrücklich ohne
`MOLLIE_API_KEY`. Der echte SDK-Client wird ausschließlich beim Aufruf eines
echten Providerpfads instanziiert; die Restoreprobe braucht keinen API-Schlüssel.

`node --test test/*.test.js`: **301/301 grün** auf diesem Zwischenstand unter
Node 24.19.0. Syntaxprüfung von `services/mollieService.js` und `git diff --check`
sind ebenfalls erfolgreich.

Ein erneuter CodeQL-Lauf auf dem endgültigen Release-Commit ist weiterhin
erforderlich; aus Unit-Tests wird kein grüner CodeQL-Nachweis abgeleitet.
