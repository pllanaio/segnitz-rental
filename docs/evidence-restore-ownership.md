# Private Testvolumes und unterschiedliche Host-/Container-UIDs

Bestätigter Ablaufdefekt vor dem ersten vollständigen Restore-CI-Lauf:
`umask 077` erstellt die synthetischen Bildverzeichnisse mit Modus 0700.
Der echte App-Entrypoint überträgt sie korrekt an Node-UID 1000. Ein CI-Host
mit UID 1001 kann sie danach nicht inventarisieren. Außerdem lief die bisherige
`TemporaryDirectory`-Bereinigung noch vor dem Stoppen des restaurierten Writers.

`rehearsal_workspace.py` kapselt jetzt nur die durch diesen Lauf erzeugten
Container-IDs und vier zulässigen Bildverzeichnisse innerhalb seines eigenen
temporären Verzeichnisses. Nach geprüftem Source-Drain erhält der Host seine
UID/GID durch einen separaten netzlosen Container mit demselben unveränderlichen
Image zurück. Die normale App behält Entrypoint und Node-UID; 0700/0600 werden
nicht aufgeweicht. Das Programm folgt keinen Symlinks und akzeptiert keine
fremden oder unregistrierten Mounts. Es startet keine Provider-/Appdienste.

Beim Verlassen des Probeablaufs werden auch nach Fehlern zuerst alle selbst
erzeugten Container beendet/entfernt. Danach folgen Eigentumsrückgabe und
Dateibereinigung. Schlägt der Writerstop fehl, bleibt das Workspace erhalten;
kein impliziter Tempverzeichnis-Finalizer löscht unter einem laufenden Writer.
Ein Erfolgsereignis wird erst nach dieser Bereinigung ausgegeben.

Geprüft: vier Python-Verhaltenstests für private Dateimodi und Hostinventar,
Fehlerabbruch mit Writer→Eigentum→Cleanup-Reihenfolge, fehlgeschlagenen
Writerstop mit erhaltenem Datenstand sowie Ablehnung fremder/Symlink-Ziele.
Das tatsächliche Node-Programm wird lokal gegen temporäre Dateien ausgeführt;
der unterschiedliche UID-Zugriff wird zusätzlich modelliert, da die lokale
User-Namespace die Übertragung auf UID1000 nicht zulässt. Kein Docker-Erfolg
wird hieraus abgeleitet. Zusammen mit vorhandenen Restoreprüfungen **9/9 Node-
Tests grün** (Pythonwrapper enthält die vier Fälle); Python-Syntax grün.
Ein realer CI-Restore unter der Host-/Container-UID-Kombination steht aus.
