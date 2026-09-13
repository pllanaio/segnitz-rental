# Zahlungs- und Belegungsänderungen im Release-Kandidaten

Stand: 13.09.2026. Ausgangspunkt des isolierten Branches `codex/rc-payments-20260913` ist `1382a95444be15f692f4a8800ab521b11c3d4683`. Die folgenden Nachweise betreffen diesen fachlichen Diff, nicht das finale zusammengeführte Release-Image.

## Tatsächlich geändert

| Befund | Umsetzung | Nachweis / Status |
|---|---|---|
| Verspätetes Paid konnte einen abgelaufenen Hold nach Belegung durch B bestätigen | Webhook und Status-Sync benutzen denselben Abgleich. Produkt-IDs werden aufsteigend vor Auftrag und Ledger gesperrt. Vor Bestätigung werden aktive, nicht zurückgegebene Positionen, Miettag und aktuelle Überlappung erneut unter Sperre geprüft. Bei Verlust wird der Auftrag im selben Commit abgelaufen und die bestehende transaktionale Stornoerstattung vorgemerkt. | Neue MySQL-Tests mit zwei Verbindungen, kontrollierter MySQL-Zeit und ausgeschaltetem Cleanup sowie API-Tests für Webhook und Sync **vorbereitet, hier nicht ausgeführt**. |
| Älteres Open/Failed konnte Paid und abgeschlossene Refunds überschreiben | Explizite Transitionstabelle; abgeschlossene Zahlung/Refund regrediert nicht. Worker-Refund-Resultat und Ressourcen-Sync verwenden denselben Statusvertrag. `paid_at` bleibt erhalten. | Neue ausführbare Verhaltenstests grün. |
| Zahlungsdispute machten Mietgeräte verfügbar; Stub erfand `charged_back` als Providerzahlungsstatus | Mollie-Zahlung bleibt `paid`; separat paginierte Chargeback-Ressourcen werden über stabile IDs dedupliziert. Teilbeträge sind negative EUR-Ledgerzeilen. `reversedAt` setzt die einzelne Zeile terminal auf `cancelled`; alte Beobachtungen aktivieren sie nicht erneut. Physischer Mietstatus bleibt erhalten. `payment_dispute`, `partially_returned` und `partially_cancelled` blockieren bestehende aktive Positionen. | Teil-/Voll-Chargeback, Reversal, Duplikat und vertauschte Beobachtung als Verhaltenstest grün. MySQL-Belegungstest vorbereitet. |
| Unvollständige / falsche Providerdaten könnten Fachzustände verändern | Zahlungs-ID, optionale Auftragsmetadaten, zulässiger Providerstatus, EUR und exakte Centbeträge werden zentral geprüft, auch vor Rückgabe-Verrechnung und manueller Bar-Ersetzung. Legacy-Rent-/Deposit-Allokationen ohne Initial-Aggregat werden für Prüfung und Storno erst zu einer Absicht zusammengefasst. `amountChargedBack` und Ressourcen müssen zueinander passen. | Mismatch-Verhaltenstests grün; reale API-/MySQL-Regression offen. |
| Providererfolg vor verlorenem lokalem Refund-Commit | Refund-Metadaten enthalten jetzt den nicht geheimen finanziellen Operationsschlüssel. Reconciliation kann eine noch fehlende Refund-ID genau der lokalen Absicht zuordnen, nachdem Zahlung, Betrag und Auftrags-ID geprüft wurden. Unbekannte nicht eindeutig zuordenbare Providererstattungen stoppen den Abgleich zur Klärung. Manueller neuer Refund-Versuch verlangt vorher erfolgreichen Providerabgleich. | Verlorene ID-Zuordnung und anschließendes veraltetes Processing grün getestet. |
| Webhook und verspäteter Checkout-Worker erzeugten unterschiedliche Refund-Identitäten | Beide benutzen `ensureDuplicatePaymentRefund`, denselben Schlüssel `duplicate-payment-refund-<paymentId>`, dieselbe Payload und vorhandene Refund-Kapazität. Bereits vorgemerkte Refunds und aktive Chargebacks verbrauchen Kapazität. | Beide Ankunftsreihenfolgen gegen Worker-Result-Anwendung grün; echte konkurrierende MySQL-Verbindungen als Test vorbereitet. |
| Fehlende Webhooks und ausbleibende Refund-/Dispute-Synchronisierung | Begrenzter periodischer Abgleich: priorisierter Umlauf offener/unklarer Vorgänge plus Umlauf aller Providerzahlungen für spätere Disputes. SDK-Pagination bis 10 Seiten/1000 Ressourcen; Überschreitung bricht geschlossen zur Triage ab. DB-Verbindungen werden vor Netzaufrufen freigegeben. DB-Konflikte wiederholen die kurze lokale Anwendung höchstens dreimal mit derselben Beobachtung. | Pagination, Timeout-Fortschritt, begrenzte Batches, koaleszierte Läufe und Verbindungstrennung grün getestet. |
| Gegensätzliche Worker-/Webhook-Lockreihenfolge | Outbox-Erfolgs-/Fehleranwendung sperrt Produkt/Auftrag vor Outbox-/Ledgerzeilen. Finanzprojektion nutzt kurze READ-COMMITTED-Transaktionen und aktuelle sperrende Refund-/Dispute-Lesezugriffe; keine Netzaufrufe unter DB-Locks. | Unit-Gates grün; Deadlock-/Recovery-Lastnachweis auf MySQL offen. |

## Ausgeführte Prüfungen

- `node --test test/payment-observation.test.js` zunächst **3 fehlgeschlagene Tests** vor Einführung der Transition-/Betragsfunktionen, danach grün; später auf **10 grüne Verhaltenstests** erweitert. Kein behaupteter MySQL-Red/Green-Nachweis.
- `npm run check:syntax`: **90 JavaScript-Dateien grün** (Node 24.19.0).
- `npm run test:unit`: **155/155 grün**, 0 übersprungen (Node 24.19.0).
- `/workspace/scratch/3d9a8f0d5ab7/test-runtime/node22/bin/node --test test/*.test.js`: **155/155 grün**, 0 übersprungen (Node 22.22.2).
- `git diff --check`: grün.

Die bestehenden Quelltext-Prüfungen zur Zahlungsrouten-Sicherheit wurden auf den gemeinsamen Abgleich umgestellt und behalten ihre Ownership-/CSRF-/Source-vs.-Refund-Abgrenzung. Sie ersetzen die neuen Verhaltenstests nicht.

## Noch nicht ausgeführt / Freigabegrenzen

- Echter MySQL-8-Lauf von `test/integration/payment-observation.integration.test.js` (3 neue Tests) und `test/integration/order-lifecycle.integration.test.js` (3 neue API-Regressionsfälle zusätzlich zu den bestehenden Geschäftsabläufen). Die verfügbare Umgebung stellte keinen nutzbaren MySQL-Server bereit; Downloads der benötigten Distribution waren blockiert. Das ist **kein Testpass**.
- Kein realer Mollie-Sandboxkontakt, keine echten Zahlungen/Erstattungen. Der lokale Simulator verwendet bereinigte Payment-/Refund-/Chargeback-Ressourcen und persistente Test-Idempotenz zum Neustarttest; er ist ausdrücklich kein Live-Providervertragsnachweis.
- Keine Produktionsmigration, kein Deployment, kein Container-Digest/Scan und keine Produktionsdatenänderung in diesem Teilauftrag.
- Für alte Providererstattungen ohne erhaltene lokale Refund-ID **und** ohne Operationsmetadaten bleibt eine manuelle eindeutige Zuordnung notwendig. Der Code erfindet diese Zuordnung nicht. Alte Dispute-Sonderzustände ohne identifizierbare Chargeback-Ressourcen werden nicht automatisch als bezahlt freigegeben.
- Die finanzielle EUR-Absicht ist geprüft. Provider-Timeout bedeutet weiterhin unbekannten Providerabschluss; der SDK-Aufruf kann serverseitig abgeschlossen worden sein. Wiederholung erfolgt über den stabilen Outbox-Schlüssel und periodischen Abgleich. Endgültige Netzwerk-/Last-/Provider-Idempotenzfristen müssen in der Sandbox bestätigt werden.

## Betrieb des Abgleichs

- `PAYMENT_RECONCILIATION_BATCH_SIZE`: Standard 10, höchstens 100; etwa die Hälfte des Budgets ist offenen/unklaren Vorgängen vorbehalten.
- `PAYMENT_RECONCILIATION_INTERVAL_MS`: Standard 60000, 1000 bis 3600000.
- `DISABLE_PAYMENT_RECONCILIATION=1`: ausdrückliche Pause für isolierte Restore-/Testumgebungen; Rückstand bleibt bestehen. Der produktive Sollwert ist aktiviert, sofern Mollie aktiviert ist.
- Der Runtime-Export `paymentReconciler.progress` enthält `attempted`, `succeeded`, `failed`, `lastCompletedAt`, `cursor`. Fehlermeldungen enthalten Code und Zahlungsdatensatz-ID, keine Providerantworten oder Mailpayloads.
- `PROVIDER_OBSERVATION_INCOMPLETE`: späteren vollständigen Abgleich abwarten. `PROVIDER_REFUND_UNMATCHED`/`PROVIDER_CONTRACT_MISMATCH`: lokalen Auftrag, Absicht, Provider-ID/Währung/Betrag in berechtigtem Betriebswerkzeug vergleichen; keine neue Erstattung mit neuem Schlüssel erzeugen. `MOLLIE_PAGINATION_LIMIT`: zugehörige Ressourcen vollständig kontrolliert inventarisieren, ehe die Vorgänge freigegeben werden.
- Aktive Chargebacks: `payment_type='chargeback' AND payment_status='charged_back'`. Reversals behalten Betrag und Ressourcenschlüssel, werden als `cancelled` geführt und dürfen nicht als Nettoverlust addiert werden.

## Offizieller Providervertrag

Am 13.09.2026 gelesen: [Get payment](https://docs.mollie.com/reference/get-payment), [List payment chargebacks](https://docs.mollie.com/reference/list-payment-chargebacks), [List payment refunds](https://docs.mollie.com/reference/list-refunds). Payment erlaubt eingebettete Refunds/Chargebacks; beide Listen sind paginiert. Zusätzlich wurden die installierten offiziellen SDK-Typen `ChargebackData` (`amount`, `paymentId`, `reversedAt`) und `Page` (`nextPage`) gegen die Implementierung geprüft. Die Web-Dokumentation als Markdown war in dieser Umgebung nicht zusätzlich abrufbar.

**Freigabestatus dieses Arbeitspakets:** implementierter, lokal auf Node 22/24 geprüfter Code-Kandidat; keine Produktionsfreigabe ohne die benannten MySQL-, API-/Browser-, Security- und Betriebsnachweise des endgültigen Release-Commits.
