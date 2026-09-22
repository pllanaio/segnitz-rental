# Lokale Browserbibliotheken und Aktualisierung

Geprüft am 13.09.2026 auf Basis `59fb535180c68e7551d0121200816308ccc2256e` in einem isolierten Checkout. Die aktiven HTML-/CSS-Referenzen und die vorhandenen Dateien wurden untersucht. Diese Bestandsaufnahme ersetzt keinen vollständigen Browser-Sicherheitstest.

## Ausgelieferte Abhängigkeiten

| Bibliothek | Festgehaltene Version | Nutzung / Integritätsumfang |
| --- | --- | --- |
| Bootstrap | 5.3.8 | Lokale CSS-Datei, JS-Bundle und MIT-Lizenz; bisherige drei Prüfsummen bleiben erhalten. |
| Flatpickr | 4.6.13 | Lokaler Kalender, CSS, deutsche Lokalisierung und MIT-Lizenz; bisherige vier Prüfsummen bleiben erhalten. |
| Signature Pad | 2.3.2 mit bestehender lokaler Anpassung | `index.html` lädt `js/signature_pad.js`; Signaturzeichnung und PNG-Ausgabe. Genau die vorhandenen JS-Bytes und die ergänzte MIT-Lizenz werden geprüft. |
| Bootstrap Icons | 1.11.3 | Acht HTML-Seiten laden `css/bootstrap-icons-1.11.3/font/bootstrap-icons.min.css`; deren CSS referenziert WOFF2 und WOFF. Beide Fonts, beide vorhandenen CSS-Versionen und die ergänzte MIT-Lizenz werden geprüft. |

`public/vendor/manifest.json` umfasst jetzt **14 Dateien**. `basePath` ist relativ zu `public`, sodass historische Pfade erhalten bleiben. `files` enthält jeweils SHA-256; `source` und `archiveSha512` identifizieren das offizielle npm-Archiv. Der Verifier verwirft fehlende/veränderte Dateien, unversionierte Einträge, ungültige Prüfsummen, Pfade außerhalb des Verzeichnisses und Symlinks. Der neue Unit-Test ruft den echten Verifier auf und bindet diese Prüfung in die bestehenden Unit-Gates ein.

Die vier Icon-CSS-/Fontdateien stimmen **bytegenau** mit `bootstrap-icons@1.11.3` aus dem offiziellen npm-Archiv überein. Das bisherige Iconverzeichnis enthält zusätzlich 2051 SVG-Dateien, eine SCSS-Datei und eine JSON-Zuordnung. Im aktiven Anwendungscode wurden keine Referenzen auf diese Einzel-SVGs gefunden; sie bleiben unverändert vorhanden. Sie gehören nicht zu den 14 einzeln geprüften Dateien. Der MIT-Lizenztext aus demselben Archiv wurde unter dem bestehenden Iconverzeichnis ergänzt und deckt auch diesen erhaltenen Bestand ab.

## Signature Pad

Der Versionsheader allein wäre kein Beleg für unveränderten Upstream-Code. Die vorhandene Datei weicht vom offiziellen npm-Paket 2.3.2 ab: lokale Touch-Handler verwenden passive Listener, entfernen `preventDefault()` und stellen beim Abschalten `touchAction` wieder her; außerdem wurden Formatierung, Kommentare und gleichwertige String-Verkettungen verändert. Diese Änderungen bestanden bereits vor diesem Release-Kandidaten. Relevante Repositoryhistorie: `68bcb629`, `3c049497`, `fbe3b21f8f64ae8ecaea08145611d4284ade44ac`, `e28918ac`. JS-Inhalt und bestehende Signaturdaten wurden hier nicht geändert.

Das npm-Registry-Metadatum nennt für 2.3.2 den [Upstream-Commit 78a90b70](https://github.com/szimek/signature_pad/tree/78a90b70d5b503b1aa8052dc63667dcdbc4ca0c9). `upstreamFileSha256` hält zusätzlich die unveränderte Archivdatei `dist/signature_pad.js` fest; `files.signature_pad.js` hält ausdrücklich die lokalen Bytes fest. Ein Update darf diese Unterscheidung nicht entfernen.

Das alte npm-Archiv enthält keinen separaten Lizenztext, aber den MIT-Hinweis im JS-Header sowie in README und Paketmetadaten. Der vollständige, unverändert übernommene [MIT-Lizenztext des Autors aus Commit 9a99148b](https://github.com/szimek/signature_pad/blob/9a99148b9d9f469214c62f42b801349f3955d8e1/LICENSE) wurde als `public/js/signature_pad.LICENSE.txt` ergänzt. Der ursprüngliche Copyright-Hinweis von 2017 im JS bleibt erhalten; der zusätzliche Upstream-Lizenztext stammt von 2018 und wird im Manifest mit eigener Quelle bezeichnet.

## Versions- und Advisory-Abgleich

Die offiziellen Veröffentlichungen und `npm view` melden aktuell [Signature Pad 5.1.4](https://github.com/szimek/signature_pad/releases/tag/v5.1.4) und [Bootstrap Icons 1.13.1](https://github.com/twbs/icons/releases/tag/v1.13.1). Die eingesetzten älteren Versionen werden dadurch nicht als aktuelle Upstream-Versionen bezeichnet. Ohne belegte Sicherheitskorrektur wurde weder die historische Signaturanpassung durch einen Major-Wechsel ersetzt noch die Iconbelegung verändert.

Ein eigenes temporäres npm-Projekt erfasste exakt `signature_pad@2.3.2`, `bootstrap-icons@1.11.3`, `flatpickr@4.6.13` und `bootstrap@5.3.8` sowie den aufgelösten Peer `@popperjs/core@2.11.8`. `npm audit --omit=dev --json` meldete **0 bekannte Schwachstellen** in allen Schweregraden bei insgesamt fünf Abhängigkeiten (Node 24.19.0, npm 11.9.0). Es wurden keine Paket-Installationsskripte ausgeführt. Das Anwendungs-Lockfile wurde nicht verändert.

Dies ist ein zeitpunktbezogener Abgleich mit der npm-Advisory-Datenbank. Er bewertet weder die lokale Signature-Pad-Anpassung noch unbekannte Schwachstellen oder die Sicherheit eines konkreten Browsers. Die GitHub-Advisory-Seiten beider Upstreams waren über den eingesetzten Webzugriff nicht abrufbar; ein negatives Suchergebnis wurde nicht als zusätzlicher Sicherheitsnachweis gewertet.

## Tatsächlich ausgeführte Prüfungen

| Prüfung | Ergebnis |
| --- | --- |
| `npm view signature_pad dist-tags version license dist.integrity --json` und entsprechender Icons-Aufruf | Aktuelle Registry-Versionen und MIT-Zuordnung bestätigt. |
| `npm pack signature_pad@2.3.2 bootstrap-icons@1.11.3 --ignore-scripts --json` | Beide offiziellen Archive geladen, SHA-512 berechnet; Icon-CSS/-Fonts bytegenau verglichen, lokale Signaturabweichungen inventarisiert. |
| `npm init -y --silent` im separaten temporären Verzeichnis | Eigenes Auditprojekt, keine Anwendungsänderung. |
| `npm install --package-lock-only --ignore-scripts --save-exact --fund=false --audit=false signature_pad@2.3.2 bootstrap-icons@1.11.3 flatpickr@4.6.13 bootstrap@5.3.8` | Eigenes Lockfile v3, fünf aufgelöste Abhängigkeiten. SHA-256 des Audit-Lockfiles: `106cf757ede5f5ac4bd00531ced3d4c051f4b44f794ca6ad1d00bef96ac80a55`. |
| `npm audit --omit=dev --json > browser-audit.json` in diesem Verzeichnis | Exit 0, info/low/moderate/high/critical jeweils 0. |
| Vor Erweiterung: `node --test test/browser-assets.test.js` | 2 Tests rot: Signatur-/Iconeinträge und exportierter Verifier fehlten. |
| Nach Erweiterung: `node scripts/verify-browser-assets.js` | 14 Dateien grün. |
| `node --test test/browser-assets.test.js` unter Node 24 und Node 22 | Jeweils 2/2 grün, einschließlich manipulierter/fehlender Datei und Pfad-/Symlink-Negativfällen. |
| `node --check scripts/verify-browser-assets.js`, `node --check test/browser-assets.test.js`, `git diff --check` | Grün. |

In dieser Teilaufgabe wurden keine Browserinteraktionen erneut ausgeführt. Die von Browsern verwendeten JS-/CSS-/Fontbytes bleiben unverändert; die Hauptabläufe des Release-Kandidaten werden unabhängig davon im echten E2E-Gate geprüft.

## Aktualisierung

Für jede Aktualisierung eine exakte Version auswählen, das offizielle Archiv mit deaktivierten Installationsskripten holen, Archiv- und Dateiprüfsummen vergleichen, Lizenztexte erhalten und die geplanten Dateien samt Manifest gemeinsam reviewen. Bei Signature Pad zuerst die dokumentierte lokale Touch-Anpassung vergleichen. Danach `node scripts/verify-browser-assets.js` und die Unit-Gates ausführen; geänderte Signatur-, Font-, Bootstrap- oder Kalenderbytes zusätzlich im echten Desktop-/Mobilablauf einschließlich Touch, Tastatur und Signatur-Upload prüfen. Den separaten npm-Audit mit sämtlichen manifestierten Paketversionen wiederholen. Das Manifest darf nicht ohne Prüfung aus beliebigen lokalen Bytes neu erzeugt werden.
