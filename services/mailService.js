const fetch = require('node-fetch');

let cachedGraphToken = null;
let cachedGraphTokenExpiresAt = 0;

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
            })
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

async function sendGraphMail({ to, cc, bcc, subject, html, text }) {
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
                    bccRecipients: normalizeRecipients(bcc)
                },
                saveToSentItems: true
            })
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Graph Mail Fehler: ${response.status} ${errorText}`);
    }
}

async function sendOrderEmail(recipients, orderSummary, customer, signatureDataUrl, paymentMethodText) {
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
    });

    return true;
}

async function sendVerificationEmail(email, token) {
    const verificationUrl = `${getBaseUrl()}/verify-email?token=${token}`;

    await sendGraphMail({
        to: email,
        subject: 'E-Mail-Adresse bestätigen',
        text: `Bitte bestätigen Sie Ihre E-Mail-Adresse über diesen Link: ${verificationUrl}`,
        html: `
            <p>Bitte bestätigen Sie Ihre E-Mail-Adresse.</p>
            <p>
                <a href="${verificationUrl}">
                    E-Mail-Adresse bestätigen
                </a>
            </p>
            <p>Der Link ist 24 Stunden gültig.</p>
        `
    });

    console.log('Verification-Mail gesendet:', {
        to: email
    });
}

async function sendPasswordChangedEmail(email) {
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
    });
}

async function sendPasswordResetEmail(email, resetUrl) {
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
    });
}

module.exports = {
    escapeHtml,
    sendOrderEmail,
    sendVerificationEmail,
    sendPasswordChangedEmail,
    sendPasswordResetEmail
};