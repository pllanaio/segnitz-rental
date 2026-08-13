const crypto = require('node:crypto');
const fetch = require('node-fetch');
const {
    EFFECT_TYPES,
    createOperationKey,
    enqueueExternalEffect
} = require('./externalEffectsOutbox');

let cachedGraphToken = null;
let cachedGraphTokenExpiresAt = 0;

function getGraphRequestSignal() {
    const configuredTimeout = Number(process.env.GRAPH_REQUEST_TIMEOUT_MS || 10000);
    const timeoutMs = Number.isFinite(configuredTimeout)
        ? Math.min(Math.max(configuredTimeout, 1000), 30000)
        : 10000;

    return AbortSignal.timeout(timeoutMs);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getBaseUrl() {
    const baseUrl = process.env.BASE_URL;

    if (!baseUrl) {
        throw new Error('BASE_URL fehlt in der .env');
    }

    return baseUrl.replace(/\/$/, '');
}

function getGraphMailUser() {
    const mailUser = process.env.GRAPH_MAIL_USER;

    if (!mailUser) {
        throw new Error('GRAPH_MAIL_USER fehlt in der .env');
    }

    return mailUser;
}

async function getGraphAccessToken() {
    const now = Date.now();

    if (cachedGraphToken && cachedGraphTokenExpiresAt > now + 60_000) {
        return cachedGraphToken;
    }

    const tenantId = process.env.MS_TENANT_ID;
    const clientId = process.env.MS_CLIENT_ID;
    const clientSecret = process.env.MS_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
        throw new Error('Microsoft Graph ENV fehlt: MS_TENANT_ID, MS_CLIENT_ID oder MS_CLIENT_SECRET');
    }

    const response = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                scope: 'https://graph.microsoft.com/.default',
                grant_type: 'client_credentials'
            }),
            signal: getGraphRequestSignal()
        }
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(`Graph Token Fehler: ${response.status} ${JSON.stringify(result)}`);
    }

    cachedGraphToken = result.access_token;
    cachedGraphTokenExpiresAt = now + Number(result.expires_in || 3600) * 1000;

    return cachedGraphToken;
}

function normalizeRecipients(value) {
    return []
        .concat(value || [])
        .filter(Boolean)
        .map(address => String(address).trim())
        .filter(Boolean)
        .map(address => ({
            emailAddress: {
                address
            }
        }));
}

async function deliverGraphMail({ to, cc, bcc, subject, html, text, operationKey }) {
    if (process.env.DISABLE_EMAILS === '1') {
        return { disabled: true };
    }

    const token = await getGraphAccessToken();
    const graphMailUser = getGraphMailUser();

    const response = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(graphMailUser)}/sendMail`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: {
                    subject,
                    body: {
                        contentType: html ? 'HTML' : 'Text',
                        content: html || text || ''
                    },
                    toRecipients: normalizeRecipients(to),
                    ccRecipients: normalizeRecipients(cc),
                    bccRecipients: normalizeRecipients(bcc),
                    ...(operationKey ? {
                        internetMessageHeaders: [{
                            name: 'x-segnitz-operation-key',
                            value: operationKey
                        }]
                    } : {})
                },
                saveToSentItems: true
            }),
            signal: getGraphRequestSignal()
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Graph Mail Fehler: ${response.status} ${errorText}`);
    }
}

async function sendGraphMail(message, options = {}) {
    const operationKey = options.operationKey || message.operationKey || `mail:${crypto.randomUUID()}`;
    const durableMessage = {
        ...message,
        operationKey
    };
    const payload = { message: durableMessage };
    if (options.application) payload.application = options.application;

    await enqueueExternalEffect({
        operationKey,
        effectType: EFFECT_TYPES.MAIL_SEND,
        payload,
        maxAttempts: 8
    }, { connection: options.connection });

    return {
        queued: true,
        operationKey
    };
}

async function sendOrderEmail(
    recipients,
    orderSummary,
    customer,
    signatureDataUrl,
    paymentMethodText,
    deliveryOptions = {}
) {
    if (!recipients || recipients.length === 0) {
        return false;
    }

    const itemsHtml = orderSummary.items.map(item => `
        <tr>
            <td>${escapeHtml(item.title)}</td>
            <td>${escapeHtml(item.rentalStart)} bis ${escapeHtml(item.rentalEnd)}</td>
            <td>${escapeHtml(item.quantity)}</td>
            <td>${Number(item.rentalTotal || 0).toFixed(2)} €</td>
            <td>${Number(item.depositTotal || 0).toFixed(2)} €</td>
        </tr>
    `).join('');

    const signatureHtml = signatureDataUrl
        ? `<img src="${signatureDataUrl}" alt="Unterschrift" style="max-width:180px; max-height:70px; border:1px solid #ddd; padding:6px;">`
        : `<em>Keine Unterschrift vorhanden</em>`;

    const html = `
        <h2>Mietauftrag ${escapeHtml(orderSummary.orderNo)}</h2>

        <h3>Kundendaten</h3>
        <p>
            ${escapeHtml(customer.firstName)} ${escapeHtml(customer.lastName)}<br>
            ${customer.company ? `${escapeHtml(customer.company)}<br>` : ''}
            ${escapeHtml(customer.email)}<br>
            ${escapeHtml(customer.phone)}<br>
            ${escapeHtml(customer.address)}<br>
            ${escapeHtml(customer.zip)} ${escapeHtml(customer.city)}
        </p>

        <h3>Mietprodukte</h3>
        <table border="1" cellpadding="6" cellspacing="0">
            <thead>
                <tr>
                    <th>Produkt</th>
                    <th>Zeitraum</th>
                    <th>Menge</th>
                    <th>Miete</th>
                    <th>Kaution</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHtml}
            </tbody>
        </table>

        <h3>Summen</h3>
        <p>
            Miete: ${Number(orderSummary.totals.rentalTotal || 0).toFixed(2)} €<br>
            Kaution: ${Number(orderSummary.totals.depositTotal || 0).toFixed(2)} €<br>
            Gesamt vor Kautionsrückgabe: ${Number(orderSummary.totals.grandTotalBeforeDepositReturn || 0).toFixed(2)} €
        </p>

        <h3>Zahlung</h3>
        <p>
            Zahlungsmethode: <strong>${escapeHtml(paymentMethodText || 'Nicht angegeben')}</strong>
        </p>

        <h3>Wie geht es weiter?</h3>
        <p>
            Sie können nun während unserer Öffnungszeiten bei uns vorbeikommen und die
            reservierten Produkte unter Vorlage Ihres Personalausweises mieten.
        </p>

        <h3>Unterschrift</h3>
        ${signatureHtml}
    `;

    const customerRecipient = recipients[0];
    const internalRecipient = process.env.ORDER_BCC || 'orders@segnitzbau.de';

    await sendGraphMail({
        to: customerRecipient,
        bcc: internalRecipient,
        subject: `Mietauftrag ${orderSummary.orderNo}`,
        html
    }, {
        ...deliveryOptions,
        operationKey: deliveryOptions.operationKey || createOperationKey(
            'mail-order',
            { orderId: orderSummary.id || null, orderNo: orderSummary.orderNo }
        )
    });

    return true;
}

async function sendVerificationEmail(email, token, options = {}) {
    const verificationUrl = `${getBaseUrl()}/verify-email?token=${token}`;
    const isGuestOrder = ['guest_order', 'guest_cash_order'].includes(options.purpose);
    const verificationWindowMinutes = Number(options.verificationWindowMinutes) || 15;
    const followUpText = isGuestOrder
        ? ` Nach der Bestätigung haben Sie ${verificationWindowMinutes} Minuten Zeit, die Bestellung erneut abzusenden.`
        : '';

    await sendGraphMail({
        to: email,
        subject: 'E-Mail-Adresse bestätigen',
        text: `Bitte bestätigen Sie Ihre E-Mail-Adresse über diesen Link: ${verificationUrl}\n\nDer Link ist 24 Stunden gültig.${followUpText}`,
        html: `
            <p>Bitte bestätigen Sie Ihre E-Mail-Adresse.</p>
            <p>
                <a href="${verificationUrl}">
                    E-Mail-Adresse bestätigen
                </a>
            </p>
            <p>Der Link ist 24 Stunden gültig.${followUpText}</p>
        `
    }, {
        connection: options.connection,
        operationKey: options.operationKey || createOperationKey(
            'mail-verify',
            { email, token }
        )
    });

    console.log('Verification-Mail vorgemerkt:', {
        to: email
    });
}

async function sendPasswordChangedEmail(email, deliveryOptions = {}) {
    await sendGraphMail({
        to: email,
        subject: 'Ihr Passwort wurde geändert',
        text: 'Ihr Passwort für Ihr Segnitz Rental Kundenkonto wurde erfolgreich geändert.',
        html: `
            <p>Ihr Passwort für Ihr Segnitz Rental Kundenkonto wurde erfolgreich geändert.</p>
            <p>
                Falls Sie diese Änderung nicht selbst vorgenommen haben,
                kontaktieren Sie uns bitte umgehend.
            </p>
        `
    }, deliveryOptions);
}

async function sendPasswordResetEmail(email, resetUrl, deliveryOptions = {}) {
    await sendGraphMail({
        to: email,
        subject: 'Passwort zurücksetzen',
        text: `Sie können Ihr Passwort über folgenden Link zurücksetzen: ${resetUrl}

Der Link ist 30 Minuten gültig.

Falls Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail.`,
        html: `
            <p>Sie haben das Zurücksetzen Ihres Passworts angefordert.</p>

            <p>
                <a href="${resetUrl}">
                    Passwort zurücksetzen
                </a>
            </p>

            <p>Der Link ist 30 Minuten gültig.</p>

            <p>
                Falls Sie diese Anfrage nicht gestellt haben,
                ignorieren Sie diese E-Mail.
            </p>
        `
    }, {
        ...deliveryOptions,
        operationKey: deliveryOptions.operationKey || createOperationKey(
            'mail-password-reset',
            { email, resetUrl }
        )
    });
}

async function sendPickedUpEmail(order, deliveryOptions = {}) {
    await sendGraphMail({
        to: order.customer_email,
        subject: `Mietauftrag ${order.order_no} wurde abgeholt`,
        html: `
            <h2>Ihre Mietartikel wurden abgeholt</h2>
            <p>Ihr Mietauftrag <strong>${escapeHtml(order.order_no)}</strong> wurde als abgeholt markiert.</p>
            <p>Bitte bringen Sie die Artikel zum vereinbarten Rückgabetermin zurück.</p>
        `
    }, {
        ...deliveryOptions,
        operationKey: deliveryOptions.operationKey || createOperationKey(
            'mail-picked-up',
            { orderId: order.id || null, orderNo: order.order_no }
        )
    });
}

async function sendOrderCancelledEmail(order, reason = null, deliveryOptions = {}) {
    await sendGraphMail({
        to: order.customer_email,
        subject: `Mietauftrag ${order.order_no} wurde storniert`,
        html: `
            <h2>Ihr Mietauftrag wurde storniert</h2>
            <p>Ihr Mietauftrag <strong>${escapeHtml(order.order_no)}</strong> wurde storniert.</p>
            ${reason ? `<p><strong>Grund:</strong> ${escapeHtml(reason)}</p>` : ''}
        `
    }, {
        ...deliveryOptions,
        operationKey: deliveryOptions.operationKey || createOperationKey(
            'mail-order-cancelled',
            { orderId: order.id || null, orderNo: order.order_no }
        )
    });
}

async function sendItemCancelledEmail(order, item, deliveryOptions = {}) {
    await sendGraphMail({
        to: order.customer_email,
        subject: `Artikel aus Mietauftrag ${order.order_no} wurde storniert`,
        html: `
            <h2>Ein Mietartikel wurde storniert</h2>
            <p>Aus Ihrem Mietauftrag <strong>${escapeHtml(order.order_no)}</strong> wurde folgender Artikel storniert:</p>
            <p><strong>${escapeHtml(item.title)}</strong></p>
        `
    }, {
        ...deliveryOptions,
        operationKey: deliveryOptions.operationKey || createOperationKey(
            'mail-item-cancelled',
            { orderId: order.id || null, orderNo: order.order_no, itemId: item.id }
        )
    });
}

async function sendRentalAdjustmentEmailWithPayment(
    order,
    item,
    paymentUrl,
    amountDue,
    deliveryOptions = {}
) {
    await sendGraphMail({
        to: order.customer_email,
        subject: `Mietzeitraum zu Auftrag ${order.order_no} wurde angepasst`,
        html: `
            <h2>Ihr Mietzeitraum wurde angepasst</h2>
            <p>Der Mietzeitraum für <strong>${escapeHtml(item.title)}</strong> wurde geändert.</p>

            ${amountDue > 0 ? `
                <p>Durch die Änderung ergibt sich ein offener Betrag von <strong>${amountDue.toFixed(2)} €</strong>.</p>

                ${paymentUrl ? `
                    <p>
                        <a href="${paymentUrl}">Jetzt online bezahlen</a>
                    </p>
                ` : `
                    <p>
                        Die Nachzahlung ist bei uns vor Ort zu begleichen.
                    </p>
                `}
            ` : `
                <p>Es ergibt sich aktuell kein zusätzlicher Zahlungsbetrag.</p>
            `}
        `
    }, {
        ...deliveryOptions,
        operationKey: deliveryOptions.operationKey || createOperationKey(
            'mail-rental-adjustment',
            {
                orderId: order.id || null,
                orderNo: order.order_no,
                itemId: item.id,
                adjustedEnd: item.adjusted_rental_end || item.adjustedRentalEnd || null,
                amountDue
            }
        )
    });
}

async function sendReturnAdditionalChargeEmail(
    order,
    item,
    paymentUrl,
    amountDue,
    reason,
    deliveryOptions = {}
) {
    await sendGraphMail({
        to: order.customer_email,
        subject: `Nachzahlung zu Mietauftrag ${order.order_no}`,
        html: `
            <h2>Nachzahlung zu Ihrem Mietartikel</h2>
            <p>Für den Artikel <strong>${escapeHtml(item.title)}</strong> aus Mietauftrag <strong>${escapeHtml(order.order_no)}</strong> wurde eine Nachzahlung erfasst.</p>

            <p><strong>Grund:</strong> ${escapeHtml(reason || 'Zusatzkosten')}</p>
            <p><strong>Betrag:</strong> ${amountDue.toFixed(2)} €</p>

            <p>
                <a href="${paymentUrl}">Jetzt online bezahlen</a>
            </p>

            <p>Alternativ können Sie den Betrag auch direkt bei uns vor Ort bezahlen.</p>
        `
    }, {
        ...deliveryOptions,
        operationKey: deliveryOptions.operationKey || createOperationKey(
            'mail-return-charge',
            { orderId: order.id || null, orderNo: order.order_no, itemId: item.id, amountDue }
        )
    });
}

async function sendPaymentReceiptEmail(order, payment, deliveryOptions = {}) {
    const paymentTypeLabels = {
        initial_payment: 'Miete und Kaution / ursprünglicher Mietauftrag',
        rental: 'Miete / ursprünglicher Mietauftrag',
        deposit: 'Kaution / ursprünglicher Mietauftrag',
        rental_adjustment: 'Nachzahlung wegen Mietzeitraumänderung',
        return_additional_charge: 'Nachzahlung aus Rückgabe',
        deposit_refund: 'Kautionsrückerstattung',
        order_cancellation_refund: 'Rückerstattung wegen Stornierung',
        duplicate_payment_refund: 'Rückerstattung einer Doppelzahlung'
    };
    const isRefund = Number(payment.amount || 0) < 0 ||
        String(payment.payment_type || '').endsWith('_refund');
    const heading = isRefund ? 'Rückerstattung ausgezahlt' : 'Zahlung erhalten';
    const actionText = isRefund
        ? 'Wir haben Ihnen den folgenden Betrag zu Ihrem Mietauftrag ausgezahlt.'
        : 'Wir haben Ihre Zahlung zu Ihrem Mietauftrag erhalten.';
    const methodLabel = payment.payment_method === 'cash'
        ? (isRefund ? 'Barauszahlung vor Ort' : 'Barzahlung vor Ort')
        : (isRefund ? 'Online-Rückerstattung' : 'Onlinezahlung');

    await sendGraphMail({
        to: order.customer_email,
        subject: `${isRefund ? 'Auszahlungs' : 'Zahlungs'}bestätigung zu Mietauftrag ${order.order_no}`,
        html: `
            <h2>${heading}</h2>

            <p>
                ${actionText}<br>
                Mietauftrag: <strong>${escapeHtml(order.order_no)}</strong>
            </p>

            <p>
                Betrag: <strong>${Math.abs(Number(payment.amount)).toFixed(2)} €</strong><br>
                Zahlungsart: <strong>${methodLabel}</strong><br>
                Zweck: <strong>${escapeHtml(paymentTypeLabels[payment.payment_type] || payment.payment_type)}</strong>
            </p>

            ${payment.note ? `<p>Hinweis: ${escapeHtml(payment.note)}</p>` : ''}

            <p>Vielen Dank.</p>
        `
    }, {
        ...deliveryOptions,
        operationKey: deliveryOptions.operationKey || createOperationKey(
            'mail-payment-receipt',
            {
                orderId: order.id || null,
                orderNo: order.order_no,
                paymentId: payment.id || payment.mollie_payment_id || payment.mollie_refund_id || null,
                paymentType: payment.payment_type,
                amount: payment.amount
            }
        )
    });
}

async function sendReturnSummaryEmail(order, item, payments = [], deliveryOptions = {}) {
    const depositRefund = payments.find(payment =>
        payment.paymentType === 'deposit_refund' ||
        payment.payment_type === 'deposit_refund'
    );

    const returnCharge = payments.find(payment =>
        payment.paymentType === 'return_additional_charge' ||
        payment.payment_type === 'return_additional_charge'
    );
    const offsetRentalAdjustments = payments.filter(payment =>
        (payment.paymentType === 'rental_adjustment' || payment.payment_type === 'rental_adjustment') &&
        (payment.paymentStatus === 'offset' || payment.payment_status === 'offset')
    );
    const offsetRentalAdjustmentAmount = offsetRentalAdjustments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0
    );
    const plannedReturnDate = item.adjustedRentalEnd || item.adjusted_rental_end || item.rentalEnd || item.rental_end;
    const actualReturnDate = item.actualReturnDate || item.actual_return_date;
    const actualDate = actualReturnDate ? new Date(`${String(actualReturnDate).slice(0, 10)}T00:00:00.000Z`) : null;
    const plannedDate = plannedReturnDate ? new Date(`${String(plannedReturnDate).slice(0, 10)}T00:00:00.000Z`) : null;
    const lateDays = actualDate && plannedDate && actualDate > plannedDate
        ? Math.ceil((actualDate - plannedDate) / (1000 * 60 * 60 * 24))
        : 0;
    const pricePerDay = Number(item.adjustedPricePerDay || item.adjusted_price_per_day || item.pricePerDay || item.price_per_day || 0);
    const lateFee = lateDays * pricePerDay;

    const statusLabels = {
        returned_ok: 'Ordnungsgemäß zurückgegeben',
        returned_late: 'Verspätet zurückgegeben',
        returned_damaged: 'Beschädigt zurückgegeben',
        returned_late_damaged: 'Verspätet und beschädigt'
    };

    const depositDecisionLabels = {
        full_refund: 'Kaution vollständig zurückzuzahlen',
        partial_refund: 'Kaution teilweise zurückzuzahlen',
        no_refund: 'Keine Kautionsrückzahlung'
    };

    await sendGraphMail({
        to: order.customer_email,
        subject: `Rückgabenachweis zu Mietauftrag ${order.order_no}`,
        html: `
            <h2>Rückgabenachweis</h2>

            <p>
                Die Rückgabe zu Mietauftrag
                <strong>${escapeHtml(order.order_no)}</strong>
                wurde erfasst.
            </p>

            <h3>Artikel</h3>
            <p>
                <strong>${escapeHtml(item.title)}</strong><br>
                Mietzeitraum: ${escapeHtml(item.adjustedRentalStart || item.adjusted_rental_start || item.rentalStart || item.rental_start)} bis ${escapeHtml(plannedReturnDate)}<br>
                Tatsächliche Rückgabe: ${escapeHtml(actualReturnDate || '-')}<br>
                Rückgabestatus: <strong>${escapeHtml(statusLabels[item.returnStatus || item.return_status] || item.returnStatus || item.return_status || '-')}</strong>
            </p>

            <h3>Zustand</h3>
            <p>
                Beschädigt: ${item.isDamaged || item.is_damaged ? 'Ja' : 'Nein'}<br>
                Verspätet: ${item.isLate || item.is_late ? 'Ja' : 'Nein'}<br>
                ${item.damageDescription || item.damage_description ? `Schaden: ${escapeHtml(item.damageDescription || item.damage_description)}<br>` : ''}
                ${item.lateDescription || item.late_description ? `Verspätung: ${escapeHtml(item.lateDescription || item.late_description)}<br>` : ''}
                ${item.returnNotes || item.return_notes ? `Hinweise: ${escapeHtml(item.returnNotes || item.return_notes)}<br>` : ''}
            </p>

            <h3>Kaution und Nachzahlungen</h3>
            <p>
                Kaution: ${Number(item.deposit || 0).toFixed(2)} €<br>
                Kaution zurück: ${Number(item.depositRefundAmount || item.deposit_refund_amount || 0).toFixed(2)} €<br>
                Kaution einbehalten: ${Number(item.depositDeductionAmount || item.deposit_deduction_amount || 0).toFixed(2)} €<br>
                Entscheidung: ${escapeHtml(depositDecisionLabels[item.depositDecision || item.deposit_decision] || item.depositDecision || item.deposit_decision || '-')}<br>
                Zusatzforderung: ${Number(item.additionalChargeAmount || item.additional_charge_amount || 0).toFixed(2)} €<br>
                Verspätungskosten: ${lateFee.toFixed(2)} €<br>
                Mit Kaution verrechnete Mietverlängerung: ${offsetRentalAdjustmentAmount.toFixed(2)} €<br>
                ${item.depositDeductionReason || item.deposit_deduction_reason ? `Begründung: ${escapeHtml(item.depositDeductionReason || item.deposit_deduction_reason)}` : ''}
            </p>

            ${returnCharge ? `
                <p>
                    Rückgabe-Nachzahlung:
                    <strong>${Number(returnCharge.amount || 0).toFixed(2)} €</strong>
                    (${escapeHtml(returnCharge.paymentStatus || returnCharge.payment_status || 'offen')})
                </p>
            ` : ''}

            ${depositRefund ? `
                <p>
                    Kautionsrückerstattung:
                    <strong>${Math.abs(Number(depositRefund.amount || 0)).toFixed(2)} €</strong>
                    (${escapeHtml(depositRefund.paymentStatus || depositRefund.payment_status || 'offen')})
                </p>
            ` : ''}

            <p>
                Bitte bewahren Sie diese E-Mail als Nachweis Ihrer Rückgabe auf.
            </p>
        `
    }, {
        ...deliveryOptions,
        operationKey: deliveryOptions.operationKey || createOperationKey(
            'mail-return-summary',
            {
                orderId: order.id || null,
                orderNo: order.order_no,
                itemId: item.id,
                actualReturnDate: item.actualReturnDate || item.actual_return_date || null
            }
        )
    });
}

module.exports = {
    deliverGraphMail,
    escapeHtml,
    sendOrderEmail,
    sendVerificationEmail,
    sendPasswordChangedEmail,
    sendPasswordResetEmail,
    sendPickedUpEmail,
    sendOrderCancelledEmail,
    sendItemCancelledEmail,
    sendRentalAdjustmentEmailWithPayment,
    sendReturnAdditionalChargeEmail,
    sendPaymentReceiptEmail,
    sendReturnSummaryEmail
};
