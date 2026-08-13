'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
    EFFECT_TYPES,
    calculateBackoffSeconds,
    canonicalizeJson,
    claimExternalEffect,
    createOperationKey,
    enqueueExternalEffect,
    hashPayload,
    stableJson
} = require('../services/externalEffectsOutbox');
const {
    applyExternalEffectFailure,
    applyExternalEffectResult,
    dispatchExternalEffect,
    enqueueDependentPaymentMail,
    processClaimedExternalEffect
} = require('../services/externalEffectsWorker');

test('erzeugt stabile Operation-Keys unabhängig von Objekt-Schlüsselreihenfolge', () => {
    assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
    assert.equal(
        createOperationKey('mail', { b: 2, a: 1 }),
        createOperationKey('mail', { a: 1, b: 2 })
    );
    assert.notEqual(
        createOperationKey('mail', { a: 1 }),
        createOperationKey('mail', { a: 2 })
    );
});

test('kanonisiert optionale JSON-Werte wie MySQL JSON und lehnt unsichere Werte ab', () => {
    assert.equal(
        stableJson({ b: undefined, a: [undefined, Number.NaN, 1] }),
        '{"a":[null,null,1]}'
    );
    assert.deepEqual(canonicalizeJson({ optional: undefined, present: true }), { present: true });
    assert.throws(() => stableJson({ id: 1n }), /BIGINT/);
    const cyclic = {};
    cyclic.self = cyclic;
    assert.throws(() => stableJson(cyclic), /Zyklische/);
});

test('immutable Payload-Hash erlaubt Re-Enqueue nach Redaction und erkennt Key-Kollisionen', async () => {
    const originalPayload = { message: { to: 'kunde@example.com', subject: 'Hallo' } };
    const storedRow = {
        id: 1,
        operation_key: 'mail:event-1',
        effect_type: EFFECT_TYPES.MAIL_SEND,
        payload_json: { redacted: true },
        payload_hash: hashPayload(originalPayload),
        status: 'succeeded'
    };
    const connection = {
        async execute(sql) {
            if (/^\s*SELECT \*/u.test(sql)) return [[storedRow]];
            return [{ affectedRows: 0 }];
        }
    };

    const existing = await enqueueExternalEffect({
        operationKey: storedRow.operation_key,
        effectType: EFFECT_TYPES.MAIL_SEND,
        payload: originalPayload
    }, { connection });
    assert.equal(existing.status, 'succeeded');

    await assert.rejects(
        enqueueExternalEffect({
            operationKey: storedRow.operation_key,
            effectType: EFFECT_TYPES.MAIL_SEND,
            payload: { message: { to: 'andere@example.com', subject: 'Hallo' } }
        }, { connection }),
        /abweichendem Inhalt/
    );
});

test('begrenzt exponentiellen Retry-Backoff auf eine Stunde', () => {
    assert.equal(calculateBackoffSeconds(1), 15);
    assert.equal(calculateBackoffSeconds(2), 30);
    assert.equal(calculateBackoffSeconds(3), 60);
    assert.equal(calculateBackoffSeconds(20), 3600);
});

test('reapt eine abgelaufene letzte Worker-Lease vor dem nächsten Claim', async () => {
    const statements = [];
    const connection = {
        async beginTransaction() {},
        async execute(sql, params) {
            statements.push({ sql, params });
            if (/FROM external_effects_outbox[\s\S]*attempt_count >= max_attempts/u.test(sql)) {
                return [[]];
            }
            if (/SELECT \*/.test(sql)) return [[]];
            return [{ affectedRows: 1 }];
        },
        async commit() {},
        async rollback() {},
        async end() {}
    };

    const claimed = await claimExternalEffect({
        workerId: 'test-worker',
        leaseSeconds: 45,
        connectionFactory: async () => connection
    });

    assert.equal(claimed, null);
    assert.match(statements[0].sql, /attempt_count >= max_attempts/);
    assert.match(statements[0].sql, /FOR UPDATE SKIP LOCKED/);
    assert.deepEqual(statements[0].params, [45]);
});

test('reapt eine letzte Lease samt fachlicher DEAD-Projektion atomar', async () => {
    const effectRow = {
        id: 9,
        operation_key: 'refund:expired-lease',
        effect_type: EFFECT_TYPES.MOLLIE_REFUND_CREATE,
        payload_json: JSON.stringify({
            application: { kind: 'refund_record', paymentRecordId: 44 }
        }),
        status: 'processing',
        attempt_count: 8,
        max_attempts: 8,
        locked_by: 'old-worker'
    };
    let projectionApplied = false;
    let committed = false;
    const connection = {
        async beginTransaction() {},
        async execute(sql) {
            if (/attempt_count >= max_attempts/u.test(sql)) return [[effectRow]];
            if (/WHERE \([\s\S]*status IN \('pending', 'retry'\)/u.test(sql)) return [[]];
            if (/SET status = 'dead'/u.test(sql)) return [{ affectedRows: 1 }];
            return [{ affectedRows: 0 }];
        },
        async commit() { committed = true; },
        async rollback() {},
        async end() {}
    };

    const result = await claimExternalEffect({
        workerId: 'new-worker',
        leaseSeconds: 60,
        applyDead: async (_connection, effect) => {
            assert.equal(effect.operation_key, effectRow.operation_key);
            projectionApplied = true;
        },
        connectionFactory: async () => connection
    });

    assert.equal(result, null);
    assert.equal(projectionApplied, true);
    assert.equal(committed, true);
});

test('injiziert den stabilen Outbox-Key zwingend in Mollie-Effekte', async () => {
    let observed;
    const effect = {
        effect_type: EFFECT_TYPES.MOLLIE_REFUND_CREATE,
        operation_key: 'refund:order-1',
        payload: {
            refund: {
                paymentId: 'tr_1',
                amount: 12
            }
        }
    };

    await dispatchExternalEffect(effect, {
        executeMollie: async (type, payload, operationKey) => {
            observed = { type, payload, operationKey };
            return { id: 're_1' };
        }
    });

    assert.equal(observed.type, EFFECT_TYPES.MOLLIE_REFUND_CREATE);
    assert.equal(observed.operationKey, effect.operation_key);
});

test('Provider-Erfolg plus DB-Apply-Fehler wird mit gleichem Key sicher wiederholt', async () => {
    const providerSideEffects = new Map();
    let providerRequests = 0;
    let completionAttempts = 0;
    let failures = 0;

    const executeMollie = async (type, payload, operationKey) => {
        providerRequests += 1;
        if (!providerSideEffects.has(operationKey)) {
            providerSideEffects.set(operationKey, {
                id: 're_durable_1',
                status: 'refunded'
            });
        }
        return providerSideEffects.get(operationKey);
    };
    const completeEffect = async () => {
        completionAttempts += 1;
        if (completionAttempts === 1) throw new Error('simulierter DB-Apply-Fehler');
    };
    const failEffect = async () => {
        failures += 1;
    };
    const baseEffect = {
        id: 7,
        operation_key: 'refund:durable-order-1',
        effect_type: EFFECT_TYPES.MOLLIE_REFUND_CREATE,
        payload: {
            refund: { paymentId: 'tr_1', amount: 10 }
        },
        attempt_count: 1,
        max_attempts: 8,
        locked_by: 'worker-1'
    };

    await assert.rejects(
        processClaimedExternalEffect(baseEffect, {
            executeMollie,
            completeEffect,
            failEffect
        }),
        /DB-Apply-Fehler/
    );

    await processClaimedExternalEffect({
        ...baseEffect,
        attempt_count: 2,
        locked_by: 'worker-2'
    }, {
        executeMollie,
        completeEffect,
        failEffect
    });

    assert.equal(providerRequests, 2, 'HTTP-Versuch wird mit demselben Key wiederholt');
    assert.equal(providerSideEffects.size, 1, 'Provider-Nebenwirkung bleibt idempotent einmalig');
    assert.equal(completionAttempts, 2);
    assert.equal(failures, 1);
});

test('verzögerter Payment-Erfolg erzeugt genau eine deterministische Checkout-Mail', async () => {
    const enqueued = new Map();
    const enqueueEffect = async effect => {
        enqueued.set(effect.operationKey, effect);
        return effect;
    };
    const successMail = {
        operationKey: 'mail-rental-adjustment-operation-1',
        message: {
            to: 'kunde@example.com',
            subject: 'Nachzahlung',
            htmlTemplate: '<a href="{{CHECKOUT_URL}}">bezahlen</a>',
            textTemplate: 'Bezahlen: {{CHECKOUT_URL}}'
        }
    };

    await enqueueDependentPaymentMail(
        {},
        successMail,
        { checkoutUrl: 'https://checkout.example/pay/1' },
        enqueueEffect
    );
    await enqueueDependentPaymentMail(
        {},
        successMail,
        { checkoutUrl: 'https://checkout.example/pay/1' },
        enqueueEffect
    );

    assert.equal(enqueued.size, 1);
    const mail = enqueued.get(successMail.operationKey);
    assert.equal(mail.effectType, EFFECT_TYPES.MAIL_SEND);
    assert.match(mail.payload.message.html, /https:\/\/checkout\.example\/pay\/1/);
    assert.match(mail.payload.message.text, /https:\/\/checkout\.example\/pay\/1/);
    assert.doesNotMatch(mail.payload.message.html, /CHECKOUT_URL/);
});

test('markiert eine Bestellbestätigung erst nach erfolgreicher Mailzustellung', async () => {
    const statements = [];
    const connection = {
        async execute(sql, params) {
            statements.push({ sql, params });
            return [{ affectedRows: 1 }];
        }
    };
    const effect = {
        effect_type: EFFECT_TYPES.MAIL_SEND,
        payload: {
            application: {
                kind: 'order_confirmation_mail',
                orderId: 42
            }
        }
    };

    await applyExternalEffectResult(connection, effect, { accepted: true });

    assert.equal(statements.length, 1);
    assert.match(statements[0].sql, /order_confirmation_sent_at = COALESCE/);
    assert.deepEqual(statements[0].params, [42]);
});

test('verspätetes Payment-Create regressiert bezahlte Order nicht und storniert Checkout durable', async () => {
    const statements = [];
    const connection = {
        async execute(sql, params) {
            statements.push({ sql, params });
            if (/FROM rental_order_payments[\s\S]*id IN/u.test(sql)) {
                return [[{
                    id: 31,
                    order_id: 12,
                    order_item_id: null,
                    payment_type: 'initial_payment',
                    payment_status: 'pending',
                    amount: 460,
                    external_operation_key: 'checkout-retry-12-2'
                }]];
            }
            if (/FROM rental_orders/u.test(sql)) {
                return [[{
                    id: 12,
                    status: 'confirmed',
                    payment_status: 'paid',
                    mollie_payment_id: 'tr_canonical'
                }]];
            }
            if (/INSERT INTO external_effects_outbox/u.test(sql)) return [{ insertId: 55 }];
            if (/SELECT \*[\s\S]*external_effects_outbox/u.test(sql)) {
                const payload = {
                    paymentId: 'tr_obsolete',
                    idempotencyKey: statements.find(statement =>
                        /INSERT INTO external_effects_outbox/u.test(statement.sql)
                    ).params[0],
                    application: {
                        kind: 'cancel_payment',
                        paymentId: 'tr_obsolete',
                        paymentStatus: 'cancelled',
                        refundIfPaid: {
                            orderId: 12,
                            orderItemId: null,
                            amount: 460,
                            sourceOperationKey: 'checkout-retry-12-2'
                        }
                    }
                };
                return [[{
                    id: 55,
                    operation_key: statements.find(statement =>
                        /INSERT INTO external_effects_outbox/u.test(statement.sql)
                    ).params[0],
                    effect_type: EFFECT_TYPES.MOLLIE_PAYMENT_CANCEL,
                    payload_json: JSON.stringify(payload),
                    payload_hash: hashPayload(payload),
                    status: 'pending'
                }]];
            }
            return [{ affectedRows: 1 }];
        }
    };

    await applyExternalEffectResult(connection, {
        operation_key: 'checkout-retry-12-2',
        payload: {
            application: {
                kind: 'payment_records',
                orderId: 12,
                paymentRecordIds: [31]
            }
        }
    }, {
        id: 'tr_obsolete',
        status: 'open',
        checkoutUrl: 'https://checkout.example/obsolete',
        amount: { value: '460.00', currency: 'EUR' }
    });

    assert.equal(
        statements.some(statement =>
            /UPDATE rental_orders/u.test(statement.sql) && /payment_status = 'pending'/u.test(statement.sql)
        ),
        false
    );
    assert.equal(
        statements.some(statement =>
            /INSERT INTO external_effects_outbox/u.test(statement.sql) &&
            statement.params[1] === EFFECT_TYPES.MOLLIE_PAYMENT_CANCEL
        ),
        true
    );
});

test('DEAD-Refund projiziert Ledger und stornierte Order auf refund_failed', async () => {
    const statements = [];
    const connection = {
        async execute(sql, params) {
            statements.push({ sql, params });
            if (/FROM rental_order_payments[\s\S]*external_operation_key/u.test(sql)) {
                return [[{
                    id: 77,
                    order_id: 22,
                    order_item_id: null,
                    payment_type: 'order_cancellation_refund',
                    payment_status: 'pending'
                }]];
            }
            if (/COUNT\(\*\) AS refundCount/u.test(sql)) {
                return [[{ refundCount: 1, paidCount: 0, pendingCount: 0, failedCount: 1 }]];
            }
            return [{ affectedRows: 1 }];
        }
    };

    await applyExternalEffectFailure(connection, {
        operation_key: 'refund:dead-order-22',
        payload: {
            application: { kind: 'refund_record', paymentRecordId: 77 }
        }
    }, new Error('Provider nicht erreichbar'));

    assert.equal(
        statements.some(statement =>
            /UPDATE rental_order_payments/u.test(statement.sql) &&
            /payment_status = 'failed'/u.test(statement.sql)
        ),
        true
    );
    assert.equal(
        statements.some(statement =>
            /UPDATE rental_orders/u.test(statement.sql) &&
            statement.params?.[0] === 'refund_failed'
        ),
        true
    );
});

test('Retention löscht nur Mail-Effekte und bewahrt finanzielle Tombstones', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'services', 'externalEffectsOutbox.js'),
        'utf8'
    );
    const purge = source.slice(
        source.indexOf('async function purgeExternalEffects'),
        source.indexOf('module.exports')
    );

    assert.match(purge, /effect_type = 'mail\.send'/);
    assert.doesNotMatch(purge, /effect_type IN/u);
});

test('Retention-Fehler blockiert den Worker-Dispatch nicht', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'services', 'externalEffectsWorker.js'),
        'utf8'
    );
    const drain = source.slice(
        source.indexOf('async function drainExternalEffects'),
        source.indexOf('async function startExternalEffectsWorker')
    );
    const purgeCatch = drain.indexOf("console.error('Outbox-Retention fehlgeschlagen");
    const claim = drain.indexOf('const effect = await claimExternalEffect');

    assert.ok(purgeCatch > -1 && claim > purgeCatch);
});

test('App-Code verbietet direkte mutierende Mollie-Aufrufe außerhalb des Outbox-Executors', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');

    for (const mutation of [
        'createMolliePaymentForOrder',
        'createMollieRefundForPayment',
        'cancelMolliePayment',
        'createMollieCustomer'
    ]) {
        assert.doesNotMatch(source, new RegExp(`\\b${mutation}\\b`, 'u'));
    }
});

test('Payment-Sync trennt Ursprungszahlung und Refund-Ledger trotz gemeinsamer Mollie-ID', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');
    const sourceStatusHelper = source.slice(
        source.indexOf('const INITIAL_MOLLIE_SOURCE_PAYMENT_TYPES'),
        source.indexOf('function rememberGuestOrder')
    );
    const syncRoute = source.slice(
        source.indexOf("app.post('/orders/:id/payment-status/sync'"),
        source.indexOf("app.post('/admin/order-payments/manual'")
    );
    const webhookRoute = source.slice(
        source.indexOf("app.post('/webhooks/mollie'"),
        source.indexOf('let cleanupTimer = null')
    );
    const cancellationHelper = source.slice(
        source.indexOf('async function cancelOpenMolliePayments'),
        source.indexOf('async function enqueueMollieCancellationIntent')
    );
    const returnSettlementRoute = source.slice(
        source.indexOf("app.put('/admin/order-items/:itemId/return'"),
        source.indexOf("app.delete('/admin/return-images/:id'")
    );
    const manualPaymentRoute = source.slice(
        source.indexOf("app.post('/admin/order-payments/manual'"),
        source.indexOf("app.post('/admin/order-payments/:id/retry-refund'")
    );

    assert.match(
        sourceStatusHelper,
        /INITIAL_MOLLIE_SOURCE_PAYMENT_TYPES = Object\.freeze\(\[\s*'initial_payment',\s*'rental',\s*'deposit'/u
    );
    assert.match(
        sourceStatusHelper,
        /ADDITIONAL_MOLLIE_SOURCE_PAYMENT_TYPES = Object\.freeze\(\[\s*'rental_adjustment',\s*'return_additional_charge'/u
    );
    assert.match(sourceStatusHelper, /AND mollie_refund_id IS NULL/u);
    assert.match(sourceStatusHelper, /AND payment_method = 'online'/u);
    assert.match(sourceStatusHelper, /AND payment_type IN \(\$\{typePlaceholders\}\)/u);
    assert.match(webhookRoute, /rop\.id AS paymentRecordId/u);
    assert.match(
        webhookRoute,
        /rop\.payment_type IN \([\s\S]*?'initial_payment'[\s\S]*?'return_additional_charge'[\s\S]*?\)/u
    );
    assert.match(syncRoute, /updateMollieSourcePaymentStatus/u);
    assert.match(webhookRoute, /updateMollieSourcePaymentStatus/u);
    assert.doesNotMatch(
        syncRoute,
        /UPDATE rental_order_payments[\s\S]{0,300}?WHERE mollie_payment_id = \?/u
    );
    assert.doesNotMatch(
        webhookRoute,
        /UPDATE rental_order_payments[\s\S]{0,300}?WHERE mollie_payment_id = \?/u
    );
    assert.match(cancellationHelper, /AND mollie_refund_id IS NULL/u);
    assert.match(
        cancellationHelper,
        /payment_type IN \([\s\S]*?'initial_payment'[\s\S]*?'return_additional_charge'[\s\S]*?\)/u
    );
    assert.doesNotMatch(cancellationHelper, /WHERE mollie_payment_id = \?/u);
    assert.match(
        returnSettlementRoute,
        /updateMollieSourcePaymentStatus\(connection, \{[\s\S]*?paymentType: 'rental_adjustment',[\s\S]*?paymentRecordId: adjustment\.id/u
    );
    assert.doesNotMatch(
        returnSettlementRoute,
        /UPDATE rental_order_payments[\s\S]{0,300}?WHERE mollie_payment_id = \?/u
    );
    assert.match(
        manualPaymentRoute,
        /updateMollieSourcePaymentStatus\(connection, \{[\s\S]*?paymentId: openAdditionalPayment\.mollie_payment_id,[\s\S]*?paymentRecordId: openAdditionalPayment\.id/u
    );
    assert.doesNotMatch(
        manualPaymentRoute,
        /UPDATE rental_order_payments[\s\S]{0,300}?WHERE mollie_payment_id = \?/u
    );
});

test('Registrierung persistiert Benutzer und Verifikations-Mail in derselben Transaktion', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');
    const registration = source.slice(
        source.indexOf("app.post('/register-customer'"),
        source.indexOf("app.get('/verify-email'")
    );

    assert.match(registration, /runInTransactionWithRetry/);
    assert.match(registration, /sendVerificationEmail\(email, token, \{\s*connection/);
    assert.doesNotMatch(registration, /await sendVerificationEmail\(email, token\);/);
    assert.match(registration, /verificationResent: true/);
    assert.match(registration, /COALESCE\(email_verified, 0\) != 1/);
    assert.match(registration, /verification_token_valid/u);
    assert.match(registration, /mail-verify-resend-/u);
    assert.doesNotMatch(
        registration,
        /SET password = \?,[\s\S]*?verification_token = \?/u
    );
    assert.match(registration, /status\(verificationResent \? 202 : 201\)/);
});

test('Verifikations- und Reset-Tokens werden scanner-sicher und ohne Query-Referrer transportiert', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');
    const loginSource = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'login_config.js'),
        'utf8'
    );
    const verificationPage = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'verify-email.html'),
        'utf8'
    );

    assert.match(appSource, /app\.get\('\/verify-email'[\s\S]*?res\.redirect\(`\/verify-email\.html#token=/u);
    assert.match(appSource, /app\.post\('\/verify-email\/complete'/u);
    assert.match(appSource, /\/login\.html#resetToken=\$\{encodeURIComponent\(resetToken\)\}/u);
    assert.match(appSource, /\/login\.html#resetToken=\$\{token\}/u);
    assert.match(loginSource, /window\.location\.hash\.slice\(1\)/u);
    assert.match(loginSource, /window\.history\.replaceState/u);
    assert.match(verificationPage, /<meta name="referrer" content="no-referrer">/u);
    assert.ok(
        verificationPage.indexOf('/js/csrf.js') > -1 &&
        verificationPage.indexOf('/js/csrf.js') < verificationPage.indexOf('/js/verify_email_config.js'),
        'Die Browser-Verifikation muss den CSRF-Fetch-Wrapper vor ihrer POST-Logik laden.'
    );
});

test('Auth-Version-Prüfung überspringt nur explizit öffentliche statische Assets', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');
    const classifier = source.slice(
        source.indexOf('function isPublicStaticAssetPath'),
        source.indexOf('async function refreshSetupStateWhenRequired')
    );
    const middleware = source.slice(
        source.indexOf("app.use(async (req, res, next) => {\n    if (!req.session?.user"),
        source.indexOf('app.use(requireCsrfToken)')
    );

    assert.match(classifier, /pathname\.startsWith\('\/css\/'\)/u);
    assert.match(classifier, /pathname\.startsWith\('\/js\/'\)/u);
    assert.match(classifier, /pathname\.startsWith\('\/img\/products\/'\)/u);
    assert.match(classifier, /PUBLIC_BRAND_ASSET_PATHS\.has\(pathname\)/u);
    assert.doesNotMatch(classifier, /pathname\.startsWith\('\/img\/'\)/u);
    assert.doesNotMatch(classifier, /backend\.html/u);
    assert.match(middleware, /isPublicStaticAssetPath\(req\.path\)[\s\S]*?mysql\.createConnection/u);
});

test('Jede Gastbestellung verlangt eine frische, danach konsumierte Mailbox-Verifikation', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');
    const orderRoute = source.slice(
        source.indexOf("app.post('/data'"),
        source.indexOf("app.post('/register-customer'")
    );

    assert.match(orderRoute, /if \(!hasFreshGuestVerification\(req, email\)\)/u);
    assert.doesNotMatch(orderRoute, /paymentMethod === 'cash' && !hasFreshGuestVerification/u);
    assert.ok(
        [...orderRoute.matchAll(/consumeGuestVerification\(req\)/gu)].length >= 2,
        'Bar- und Onlinepfad müssen die Verifikation nach dem Commit konsumieren'
    );
});

test('E-Mail-Verifikation sperrt Self-Service-Kunden, aber keine out-of-band Mitarbeiterrollen', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');
    const helper = source.slice(
        source.indexOf('function roleRequiresEmailVerification'),
        source.indexOf('function mayAccessOrder')
    );

    assert.match(helper, /\['global_admin', 'bearbeiter'\]/u);
    assert.match(source, /roleRequiresEmailVerification\(rows\[0\]\.role\)/u);
    assert.match(source, /roleRequiresEmailVerification\(account\?\.role\)/u);
});

test('Bar-Mietverlängerung persistiert Status und Mail atomar', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');
    const adjustmentRoute = source.slice(
        source.indexOf("app.put('/admin/order-items/:itemId/rental-adjustment'"),
        source.indexOf("app.put('/admin/order-items/:itemId/return'")
    );
    const mailPosition = adjustmentRoute.indexOf('await sendRentalAdjustmentEmailWithPayment(');
    const commitPosition = adjustmentRoute.indexOf('await connection.commit();');

    assert.notEqual(mailPosition, -1, 'Mietverlängerungs-Mail fehlt');
    assert.notEqual(commitPosition, -1, 'Transaktions-Commit fehlt');
    assert.ok(mailPosition < commitPosition, 'Mail-Outbox muss vor dem Business-Commit geschrieben werden');
    assert.match(adjustmentRoute, /sendRentalAdjustmentEmailWithPayment\([\s\S]*?\{\s*connection,/u);
});

test('Checkout-Retry verwendet einen bereits pending Outbox-Versuch erneut', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');
    const checkoutRoute = source.slice(
        source.indexOf("app.post('/orders/:id/mollie-checkout'"),
        source.indexOf("app.get('/orders/:id/payment-status'")
    );

    assert.match(checkoutRoute, /effect\.status IN \('pending', 'processing', 'retry'\)/);
    assert.match(checkoutRoute, /processExternalEffectByKey\(operationKey\)/);
    assert.match(
        checkoutRoute,
        /COUNT\(DISTINCT COALESCE\(mollie_payment_id, external_operation_key\)\)/
    );
});

test('manueller Refund-Retry dedupliziert pending und versioniert nach DEAD', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');
    const retryRoute = source.slice(
        source.indexOf("app.post('/admin/order-payments/:id/retry-refund'"),
        source.indexOf("app.post('/admin/order-refunds/manual'")
    );

    assert.match(retryRoute, /\['pending', 'processing', 'retry'\]\.includes/);
    assert.match(retryRoute, /COUNT\(\*\) AS retryCount/);
    assert.match(retryRoute, /retry-refund-\$\{failedRefund\.id\}-\$\{retryAttempt\}/);
    assert.ok(
        retryRoute.indexOf('existingRetryEffects') < retryRoute.indexOf('sourceRows'),
        'Pending-Retry muss vor der Kapazitätsberechnung dedupliziert werden'
    );
});

test('Payment-Cancellation dedupliziert aktive Effekte und versioniert nach DEAD', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');
    const cancellation = source.slice(
        source.indexOf('async function enqueueMollieCancellationIntent'),
        source.indexOf('async function persistOnlineRefundIntent')
    );

    assert.match(cancellation, /\['pending', 'processing', 'retry'\]\.includes/);
    assert.match(cancellation, /existingEffects\.length \+ 1/);
    assert.match(cancellation, /getExternalEffect\(activeEffect\.operationKey/);
});

test('Order-Jahrfilter begrenzt MySQL-kompatible Jahreswerte', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');
    const validation = source.slice(
        source.indexOf('function validateOrderDateFilters'),
        source.indexOf('function addOrderListFilters')
    );
    assert.match(validation, /Number\(year\) < 1000/);
    assert.match(validation, /Number\(year\) > 9998/);
});

test('Recheckout lehnt deaktivierte Produkte nach dem Produkt-Lock ab', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'segnitz_rental.js'), 'utf8');
    const checkout = source.slice(
        source.indexOf("app.post('/orders/:id/mollie-checkout'"),
        source.indexOf("app.get('/orders/:id/payment-status'")
    );
    assert.match(checkout, /const lockedProducts = await lockRentalProducts/);
    assert.match(checkout, /lockedProducts\.some\(product => Number\(product\.is_active\) !== 1\)/);
    assert.match(checkout, /Mindestens ein Produkt dieser Bestellung ist nicht mehr aktiv/);
});

test('Migration definiert langlebige Outbox und eindeutigen Ledger-Key', () => {
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'database', 'migrations', '20260813_external_effects_outbox.sql'),
        'utf8'
    );

    assert.match(migration, /CREATE TABLE external_effects_outbox/);
    assert.match(migration, /UNIQUE KEY uq_external_effects_operation_key/);
    assert.match(migration, /external_operation_key/);
    assert.match(migration, /payload_hash CHAR\(64\) NOT NULL/);
    assert.match(migration, /attempt_count/);
    assert.match(migration, /locked_at/);
});
