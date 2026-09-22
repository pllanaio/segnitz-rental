# Restore-Verifikation und synthetische Wiederherstellungsprobe

Basis dieser isolierten Änderung: `012c9ee8a372f0b2842456d3f336e0dd61f1556f`.

| Befund | Umsetzung | Verhaltenstest / Ergebnis | Restpunkt |
|---|---|---|---|
| Dateiexistenz und Signaturregex akzeptieren beschädigte Bildinhalte | `restore-images.js`: Sharp-Decoding aller Pixel, tatsächliches Format, Byte-/Pixel-/Zeitlimits, keine Symlinks, generische Fehlercodes | Metadaten-only: 4 grün/1 rot; beschädigter PNG-Pixelstream wurde akzeptiert. Nach vollständigem Decoder: 5/5 grün. | Reale restaurierte Bestände müssen diese Prüfung noch durchlaufen; größere Legacybilder werden kontrolliert abgelehnt. |
| Verifier lädt ganze Bild-/Signaturtabellen | Keyset-Batches, zwei Decoder, Größenprüfung bereits in Signatur-SQL, Datensatz-/Gesamtfrist | Zwei weitere Tests prüfen Pagination, Parallelitätsgrenze und expliziten Abbruch vor Teilnachweis. | Betreiber muss ausreichend Zeit und Speicher für reale Bestandsgröße vorsehen. |
| Kein ausführbarer DB+Datei+App-Restore-Nachweis | `rehearse_restore.py` erstellt ausschließlich synthetische isolierte Ressourcen; normaler Serverstart, echter Stop/Drain, vorhandener verschlüsselter Backuphelfer, neue Ziel-DB/Verzeichnisse, Offline-Decode, erneuter Appstart und API-Smoke | Python-Syntax und CLI geprüft; tatsächlicher Docker/MySQL/age-Lauf in dieser lokalen Umgebung nicht möglich (Tools fehlen). CI-Aufruf vorbereitet, Workflow wird durch Release-Verantwortlichen integriert. | Erfolgreiches CI-Artefakt `restore-rehearsal.json` dieses endgültigen Image-IDs steht aus. Keine Produktionsbackup-/RTO-Behauptung. |

Ausgeführt:

- `NODE_PATH=.../segnitz-rental/node_modules node --test test/restore-image-verification.test.js test/backup-restore.test.js`: **8/8 grün** (7 neue JS-Verhaltenstests plus bestehender Python-Backup-Testwrapper).
- Derselbe Fokuslauf mit Node **22.22.2** und **24.19.0**: jeweils **8/8 grün**.
- `node scripts/check-syntax.js`: **169 JavaScript-Dateien grün**.
- Gesamter Unit-Lauf auf obigem Zwischenstand: **274/275**, ein bestehender `database-readiness.test.js`-Mock kennt die neue Admin-Audit-Triggerabfrage nicht. Dieser unabhängige Integrationsrest wurde an den Release-Verantwortlichen gemeldet; kein voller grüner Unit-Gate wird behauptet.
- `python3 -m py_compile scripts/ops/rehearse_restore.py`: erfolgreich.
- `python3 scripts/ops/rehearse_restore.py --help`: erfolgreich; keine externen Ressourcen angelegt.

Die isolierte Probe benutzt ausschließlich den bestehenden Kandidaten-Image-ID
nach Abgleich des OCI-Revisionlabels mit dem Checkout. Providercredentials fehlen;
internes Docker-Netz, Mollie-Testadapter und pausierte Mails sind explizit.
Es werden weder Produktionsdaten noch bestehende Container/Volumes adressiert.
Das eigenständige Offline-Verifikationswerkzeug behauptet weiterhin keinen App-Smoke;
nur ein vollständig erfolgreicher Rehearsal-Lauf darf diesen Nachweis setzen.
