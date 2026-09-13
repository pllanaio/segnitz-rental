# Release-Attestierungen: Vertrag und Nachweis

Stand: 13.09.2026. Reviewbasis: `b109b5e08ba3f964fe227c7499b93519863734c7`.

## Befund und Änderung

`validateOci` prüfte bereits die OCI-Referenzen und Blob-Prüfsummen. Ein vollständig
gehashtes Image ohne SBOM oder Provenance wurde dennoch als Release-Kandidat
akzeptiert. Dasselbe galt für Attestierungen mit fremdem Subject oder leerem
Predicate. Zwölf neue CLI-Verhaltenstests reproduzierten diese Fälle vor dem Fix.

`release-artifact.js create` und `verify` verlangen jetzt für jedes enthaltene
Anwendungsmanifest eine SPDX-SBOM und BuildKit-SLSA-Provenance. Die OCI-Digests,
Referenzannotation, gegebenenfalls das OCI-Subject und die in-toto-Subjects müssen
zusammenpassen. Eine zusätzliche Plattform ohne eigene Nachweise stoppt das Gate.
SBOM-Dokument, Erstellerinformation und Paketbestand sowie BuildKit-Buildtyp,
Materialien und geordnete Buildzeitpunkte werden strukturell geprüft. Leere
Predicate und unbekannte Provenance-Versionen ersetzen keinen Nachweis.

Unterstützt sind BuildKits Legacy-Attestierungsmanifest und das OCI-Artefaktformat,
in-toto Statement v0.1/v1, SPDX 2.2/2.3 sowie SLSA-Provenance v0.2/v1. BuildKit
verknüpft Attestierungen über das Image-Index-Manifest; bei OCI-Artefakten kommen
`artifactType` und `subject` hinzu. Eine vorhandene Predicate-Annotation muss dem
JSON-Inhalt entsprechen. Grundlage: [Docker: Attestation storage](https://docs.docker.com/build/metadata/attestations/attestation-storage/).

Die beiden SLSA-Versionen haben unterschiedliche BuildKit-Buildtypen und
Feldstrukturen. Diese werden explizit interpretiert. Ein optional leerer
`builder.id` wird nicht als authentifizierte Buildidentität dargestellt. Grundlage:
[Docker: Provenance attestations](https://docs.docker.com/build/metadata/attestations/slsa-provenance/)
und [Docker: SLSA definitions](https://docs.docker.com/build/metadata/attestations/slsa-definitions/).

Die neue Prüfung belegt Erhalt, Grundstruktur und Digest-Zuordnung der Nachweise.
Sie ist kein vollständiger SPDX/SLSA-Schemavalidator und authentifiziert allein
keinen Herausgeber. Erfolgreiche Checks für denselben Commit sowie die getrennte
OIDC-Signaturprüfung des freigegebenen Digests bleiben erforderlich. Insbesondere
ist BuildKits lokale VCS-Metadatenangabe lediglich ein Hinweis des Buildclients.
Es wird weder ein SLSA-Level noch ein reproduzierbarer Build behauptet.

Die sichere Diagnose enthält nur Subject-/Attestierungsdigests und bekannte
Predicate-Typen. Fehler beim JSON-Decoding geben keinen Payload-Ausschnitt aus.
Die begrenzte JSON-Lesemenge beträgt für Manifest/Config 8 MiB und für Statements
81 MiB; BuildKit begrenzt die Eingabe vor dem Statement-Wrapper auf 80 MiB.

## Tatsächlich ausgeführte Tests

| Befehl | Ergebnis |
| --- | --- |
| `node --version` | v24.19.0 |
| `node --test test/release-artifact.test.js` vor dem Fix | 17 Tests: 5 grün, 12 rot; fehlende/falsche Attestierungen wurden fälschlich angenommen |
| `node --test test/release-artifact.test.js` nach dem Fix und zusätzlichem Redaction-Test | 18 Tests grün, 0 rot/übersprungen |
| `/workspace/scratch/3d9a8f0d5ab7/test-runtime/node22/bin/node --version` | v22.22.2 |
| `/workspace/scratch/3d9a8f0d5ab7/test-runtime/node22/bin/node --test test/release-artifact.test.js` | 18 Tests grün, 0 rot/übersprungen |

Die Tests erzeugen isolierte synthetische OCI-Tararchive mit tatsächlichen
SHA-256-Deskriptoren und starten den echten CLI-Prozess. Positivfälle umfassen
beide Speicherformate sowie beide SLSA-Versionen. Negativfälle umfassen fehlende
Nachweistypen, falsche Subjects/Annotationen, leere Paketbestände, nicht
unterstützte Versionen, ungültiges JSON ohne Inhaltsleck, beschädigte/fehlende
OCI-Blobs und leere Scanberichte. Kein Container oder externer Provider wird
gestartet; die synthetischen Layer sind ausdrücklich keine lauffähigen Images.

## Echter CI-Artefaktnachweis: Transfer blockiert

Der GitHub-Connector lieferte für das historische CI-124-Artefakt `10317052234`
zweimal erfolgreich eine Dateireferenz. Beide anschließenden Materialisierungen
der neu angeforderten Referenz antworteten mit HTTP 403. Die kurzlebigen URLs
wurden nicht ausgegeben oder gespeichert. Damit wurden die Archivbytes hier
nicht zugänglich; ihr Hash und ihre tatsächlichen Predicate-Versionen sind lokal
nicht verifiziert.

Die vom übergeordneten CI-Review genannten erwarteten Identitäten sind:

- ZIP-SHA-256: `f92a9d2f04317c7c75903d7a377f8823cf78ea994cda2987a9069e7afe60c611`
- OCI-Digest: `sha256:4950b3775373200281e047a3d00c2d99ab9299b23d35139acc91325e8178ce03`
- Historischer PR-Merge-Commit: `6fe6d4f687654719e0de6e5aa78479dd0f2ba062`

Diese Werte sind erwartete Vergleichswerte, kein Ergebnis einer lokalen
Byteprüfung. Es wurde kein Image neu gebaut, veröffentlicht oder deployed.

Offener Nachweis: `node scripts/release-artifact.js verify release-image` auf dem
tatsächlichen Artefakt des endgültigen Release-Commits muss erfolgreich laufen.
Die vorhandene CI ruft denselben Helfer bereits auf. Sein neues JSON-Ergebnis
enthält für jedes Subject die geprüften SBOM-/Provenance-Layerdigests und
Predicate-Typen. Dieses Ergebnis zusammen mit Archivhash, Image-Digest, finalem
Commit, vollständigen Gates und Signaturprüfung ist aufzubewahren. Ein Erfolg
des älteren CI-124-Artefakts wäre kein Nachweis für den späteren Release-Commit.
