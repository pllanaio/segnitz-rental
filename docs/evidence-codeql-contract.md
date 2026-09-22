# CodeQL-SARIF-Vertrag: CI-Nachbesserung

Stand 13.09.2026, isolierter Branch `rc/codeql-contract`, Basis `01ceed850ef7d06e6b20ccfa4385f5e1f7d04dbc`.

## Beobachtung und Ursache

Der [CI-Lauf 34754667480, CodeQL-Job 103716911868](https://github.com/pllanaio/segnitz-rental/actions/runs/34754667480/job/103716911868) verwendet CodeQL CLI 2.27.0. Das gelesene Jobprotokoll belegt 105 Query-Auswertungen, SARIF-Export und erfolgreichen Upload; anschließend scheitert `scripts/check-codeql.js` mit `Incomplete or failed CodeQL run`. Die Artefaktabfrage dieses Laufs liefert keine Artefakte. Deshalb wurde der ursprüngliche SARIF-Inhalt nicht als lokal erneut geprüfter Scan ausgegeben.

Die verwendete [CodeQL-Action an ihrem gepinnten Commit](https://github.com/github/codeql-action/blob/ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd/src/codeql.ts) setzt `--sarif-group-rules-by-pack`. Diese [offiziell dokumentierte CLI-Option](https://docs.github.com/en/code-security/reference/code-scanning/codeql/codeql-cli-manual/database-interpret-results#--no-sarif-group-rules-by-pack) legt Regeln unter `tool.extensions` ab. Der bisherige Gate verlangt ausschließlich nichtleere `tool.driver.rules`; die Vertragsabweichung ist mit reduzierten Fixtures reproduziert. Die exakte Struktur des ursprünglichen Dokuments bleibt mangels Artefakt ein offener Nachweis bis zum erneuten CI-Lauf.

## Änderung

Die Auflösung folgt [SARIF 2.1.0, Abschnitte 3.27, 3.52 und 3.54](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html): Komponenten werden über Extension-Index oder GUID gewählt, sonst gilt der Driver. Regelindex/GUID adressieren Metadaten innerhalb dieser Komponente. Redundante IDs, Indizes, Namen und GUIDs müssen zusammenpassen. Doppelte Regel-IDs sind mit eindeutigem Index zulässig; eine mehrdeutige Suche wird abgelehnt. Der vorhandene eindeutige ID-only-Driver-Vertrag bleibt unterstützt. Ein Resultat darf eine zusätzliche hierarchische ID-Komponente angeben.

Das [GitHub-SARIF-Format](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support) unterscheidet Ergebnisebene und numerische Security-Schwere. Die bestehende Sperre ab Security-Schwere 7 sowie bei explizitem/default `error` bleibt erhalten, auch für unterdrückte Findings. Unvollständige Metadaten, fehlende Ergebnisse, widersprüchliche Referenzen, erfolglose Invocations und Error-Notifications sperren. Ein erfolgreicher leerer Run kann einen zweiten fehlerhaften Run nicht überdecken.

Die CLI protokolliert nur feste Fehlercodes, numerische Datei-/Run-/Resultatindizes sowie Regel-/Ergebnis-/Invocation-Anzahlen und Format-Flags. Keine SARIF-Nachrichten, Quelltexte, Dateipfade, frei gewählten Schlüssel, Umgebungsvariablen oder JSON-Parser-Ausschnitte werden ausgegeben. Damit ist der nächste CI-Fehler ohne Roh-SARIF in Logs unterscheidbar.

## Ausgeführte Prüfungen

Alle folgenden Befehle liefen im isolierten Checkout. Keine Providerkontakte, Datenbankmutation, Veröffentlichung oder Workflowänderung.

| Befehl/Prüfung | Ergebnis |
| --- | --- |
| Vor Fix: `node --test test/codeql-contract.test.js` | 8 Tests, 6 rot, 2 grün. U.a. saubere Extension-Ausgabe abgelehnt; High-Extension durch gleichnamige Low-Driver-Regel verdeckt; zweiter High-Regeldeskriptor ignoriert. |
| Nach Fix: `node --test test/codeql-contract.test.js test/release-gate.test.js` | 14/14 grün unter Node 24.19.0. |
| Nach Fix: `/workspace/scratch/3d9a8f0d5ab7/test-runtime/node22/bin/node --test test/codeql-contract.test.js test/release-gate.test.js` | 14/14 grün unter Node 22.22.2. |
| `node --check scripts/check-codeql.js` und `node --check test/codeql-contract.test.js` | Beide grün. |
| `git diff --check` | Grün. |

Die neuen Tests enthalten echte CLI-Aufrufe gegen temporäre SARIF-Dateien: sauberer Extension-Run Exit 0, High-Finding Exit 1, fehlende/ungültige Dokumente Exit 1, feste Diagnose mit Strukturanzahlen und kein synthetischer privater Nachrichteninhalt in stdout/stderr. Fixtures sind bewusst reduzierte Vertragsbeispiele, keine behaupteten Produktionsscan-Ergebnisse.

## Verbleibender Nachweis

CodeQL muss auf dem endgültigen Release-Commit erneut auswerten, hochladen und den korrigierten Gate erfolgreich durchlaufen. Der ursprüngliche fehlgeschlagene Lauf wird durch diese lokalen 14 Tests nicht rückwirkend grün. Die Änderungen betreffen ausschließlich Gate-Skript, gezielte Verhaltenstests und dieses Nachweisdokument.
