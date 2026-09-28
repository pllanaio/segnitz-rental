'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { sendGraphMail, escapeHtml } = require('../services/mailService');
const codeHash = (user, code) => crypto.createHash('sha256').update(`${user.id}:${user.password}:${code}`).digest('hex');
function registerEmailChange(app, { createConnection, isValidEmail }) {
    const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
        message: { error: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.' } });
    const authenticated = (req, res, next) => req.session?.user ? next() : res.status(401).json({ error: 'Bitte anmelden.' });
    for (const action of ['request', 'confirm']) app.post(`/my-profile/email/${action}`, authenticated, limiter, async (req, res) => {
        let connection;
        try {
            connection = await createConnection();
            await connection.beginTransaction();
            const [[user]] = await connection.execute('SELECT *, email_change_expires > NOW() AS code_valid FROM users WHERE username = ? FOR UPDATE', [req.session.user]);
            const fail = async (status, error) => { await connection.rollback(); return res.status(status).json({ error }); };
            if (!user) return await fail(401, 'Bitte erneut anmelden.');
            if (action === 'request') {
                const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
                const password = req.body.password;
                if (!isValidEmail(email) || email.length > 255 || email === user.username.toLowerCase()) return await fail(400, 'Bitte eine andere, gültige E-Mail-Adresse eingeben.');
                if (typeof password !== 'string' || Buffer.byteLength(password) > 72 || !await bcrypt.compare(password, user.password)) return await fail(400, 'Das aktuelle Passwort ist falsch.');
                const [[existing]] = await connection.execute('SELECT id FROM users WHERE username = ?', [email]);
                if (existing) return await fail(409, 'Diese E-Mail-Adresse ist bereits vergeben.');
                const code = String(crypto.randomInt(100000, 1000000));
                await connection.execute('UPDATE users SET pending_email = ?, email_change_hash = ?, email_change_expires = DATE_ADD(NOW(), INTERVAL 15 MINUTE), email_change_attempts = 0 WHERE id = ?', [email, codeHash(user, code), user.id]);
                await sendGraphMail({ to: email, subject: 'Ihre neue E-Mail-Adresse bestätigen', html: `<h2>E-Mail-Adresse ändern</h2><p>Ihr Bestätigungscode lautet: <strong>${code}</strong>.</p><p>Geben Sie ihn innerhalb von 15 Minuten in „Meine Daten“ ein. Falls Sie diese Änderung nicht angefordert haben, ignorieren Sie diese Nachricht.</p>` }, { connection });
                await connection.commit();
                return res.json({ message: 'Der Bestätigungscode wird an die neue Adresse gesendet. Die bisherige Adresse bleibt bis zur Bestätigung gültig.' });
            }
            const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
            if (!user.pending_email || !user.code_valid || user.email_change_attempts >= 5) return await fail(400, 'Der Code ist abgelaufen oder gesperrt. Bitte einen neuen Code anfordern.');
            if (!/^\d{6}$/.test(code) || codeHash(user, code) !== user.email_change_hash) {
                await connection.execute('UPDATE users SET email_change_attempts = email_change_attempts + 1 WHERE id = ?', [user.id]);
                await connection.commit();
                return res.status(400).json({ error: 'Der Bestätigungscode ist ungültig.' });
            }
            const email = user.pending_email;
            await connection.execute('UPDATE users SET username = ?, email_verified = 1, auth_version = auth_version + 1, pending_email = NULL, email_change_hash = NULL, email_change_expires = NULL, email_change_attempts = 0, verification_token = NULL, verification_expires = NULL, reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [email, user.id]);
            // Keep email-based order access and future correspondence attached to this account.
            await connection.execute('UPDATE rental_orders SET customer_email = ?, user_id = ? WHERE user_id = ? OR customer_email = ?', [email, user.id, user.id, user.username]);
            await connection.execute('UPDATE rental_carts SET user_email = ? WHERE user_email = ?', [email, user.username]);
            await connection.execute('UPDATE product_reviews SET user_email = ? WHERE user_email = ?', [email, user.username]);
            await sendGraphMail({ to: user.username, subject: 'Ihre E-Mail-Adresse wurde geändert', html: `<p>Die E-Mail-Adresse Ihres Segnitz-Rental-Kontos wurde auf <strong>${escapeHtml(email)}</strong> geändert.</p><p>Falls Sie diese Änderung nicht selbst vorgenommen haben, kontaktieren Sie uns bitte umgehend.</p>` }, { connection });
            await connection.commit();
            req.session.user = email;
            req.session.authVersion = Number(user.auth_version) + 1;
            await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
            res.json({ email, message: 'Ihre E-Mail-Adresse wurde bestätigt und geändert. Verwenden Sie diese ab jetzt auch zur Anmeldung.' });
        } catch (error) {
            if (connection) await connection.rollback();
            res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: error.code === 'ER_DUP_ENTRY' ? 'Die Adresse ist bereits vergeben oder mit einem anderen Warenkorb verknüpft.' : 'Die E-Mail-Adresse konnte nicht geändert werden. Bitte erneut versuchen.' });
        } finally { if (connection) await connection.end(); }
    });
}
module.exports = { registerEmailChange, codeHash };
