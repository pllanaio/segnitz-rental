# Validierung optionaler Migrationszugangsdaten

13.09.2026, isolierter Branch `rc/migration-credentials`, Basis `0e4a595118985b1fc221cee7a14aa759a1f00c1d`.

`DB_MIGRATION_USER` und `DB_MIGRATION_PW` sind optional, wenn beide Variablen fehlen. Sobald eine definiert ist, müssen beide nichtleere Strings sein. Leere oder nur aus Leerzeichen bestehende Werte sind ungültig; gültige Passwortwerte werden nicht normalisiert. Laufzeitkonto und -passwort bleiben separat. Die zentrale Validierung meldet ausschließlich Variablennamen und gibt Zugangsdaten weder im Ergebnis noch in Fehlern aus.

Der neue Verhaltenstest war vor dem Fix rot (unvollständige Zugangsdaten wurden akzeptiert). Danach bestanden `node --test test/production-config.test.js` unter Node 24.19.0 und `/workspace/scratch/3d9a8f0d5ab7/test-runtime/node22/bin/node --test test/production-config.test.js` jeweils **11/11 Tests**. `node --check config/runtimeConfig.js` und `git diff --check` bestanden. Das umfasst gültige/fehlende Paare, einzelne Werte, leere/Whitespace-/Nichtstring-Werte und Fehler ohne Credential-Ausgabe.

Diese isolierte Änderung prüft den Konfigurationsvertrag. Die Auswahl des tatsächlichen DB-Migrationskontos, dessen MySQL-Rechte und separate Verbindungsprüfungen werden durch die Datenbankänderung und ihre Tests belegt; hier wurden keine Datenbankverbindungen oder Migrationen ausgeführt.
