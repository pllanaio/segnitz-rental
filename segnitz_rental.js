const express = require("express");
const app = express();
const path = require("path");
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(express.json({
    limit: '1mb'
}));
app.use(express.urlencoded({
    limit: '1mb',
    extended: true
}));
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const fsp = require("fs").promises;
const fs = require('fs');
const mysql = require('mysql2/promise');
const dbConfig = require('./config/db');
const crypto = require('crypto');
const multer = require('multer');
const { checkAdmin } = require('./middleware/auth');
const { syncProductCategories } = require('./utils/categories');
const productRoutes = require('./routes/productRoutes');
const { runDatabaseCleanup } = require('./utils/cleanup');
const {
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
} = require('./services/mailService');

const {
    getFormValue,
    getUserIdByEmail,
    generateOrderNo,
    calculateRentalDays,
    buildOrderSummary
} = require('./services/orderService');

const {
    getOrCreateActiveCart,
    getActiveCart,
    mergeGuestCartIntoUserCart,
    checkCartItemConflict,
    getCartItemsForOrder
} = require('./services/cartService');

const cartRoutes = require('./routes/cartRoutes');
const { checkProductAvailability } = require('./utils/availability');

const {
    createMolliePaymentForOrder,
    getMolliePayment,
    createMollieRefundForPayment,
    listMollieRefundsForPayment,
    getMollieCheckoutUrl,
    cancelMolliePayment
} = require('./services/mollieService');


async function cleanupOnStartup() {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);
        console.log(`${new Date().toISOString()} - Datenbank-Cleanup beim Serverstart ausgeführt`);
    } catch (error) {
        console.error('Fehler beim Datenbank-Cleanup beim Serverstart:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

async function expireOldReservations(connection) {
    const [updatedItems] = await connection.execute(
        `UPDATE rental_order_items roi
     JOIN rental_orders ro ON ro.id = roi.order_id
     SET roi.item_status = 'expired',
         roi.return_status = 'not_required'
     WHERE ro.status = 'reserved'
     AND ro.reserved_until IS NOT NULL
     AND ro.reserved_until < NOW()`
    );

    const [updatedOrders] = await connection.execute(
        `UPDATE rental_orders
     SET status = 'expired',
         return_status = 'not_required',
         return_case_status = 'closed'
     WHERE status = 'reserved'
     AND reserved_until IS NOT NULL
     AND reserved_until < NOW()`
    );

    if (updatedOrders.affectedRows > 0 || updatedItems.affectedRows > 0) {
        console.log(
            `${new Date().toISOString()} - Cleanup: ${updatedOrders.affectedRows} Orders expired, ${updatedItems.affectedRows} Order-Items gelöscht`
        );
    }
}

async function deleteExpiredGuestVerifications(connection) {
    const [result] = await connection.execute(
        `DELETE FROM guest_verifications
         WHERE expires_at IS NOT NULL
         AND expires_at < NOW()`
    );

    if (result.affectedRows > 0) {
        console.log(
            `${new Date().toISOString()} - Cleanup: ${result.affectedRows} Guest-Verifications gelöscht`
        );
    }
}

async function deleteOldActiveCarts(connection) {
    const [result] = await connection.execute(
        `DELETE FROM rental_carts
         WHERE status = 'active'
         AND updated_at < NOW() - INTERVAL 24 HOUR`
    );

    if (result.affectedRows > 0) {
        console.log(
            `${new Date().toISOString()} - Cleanup: ${result.affectedRows} alte Carts gelöscht`
        );
    }
}

const productImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public', 'img', 'products'));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `product_${Date.now()}_${Math.round(Math.random() * 1E9)}${ext}`);
    }
});

const returnImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public', 'img', 'returns'));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `return_item_${req.params.itemId}_${Date.now()}_${Math.round(Math.random() * 1E9)}${ext}`);
    }
});

const uploadReturnImages = multer({
    storage: returnImageStorage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 10
    },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Nur Bilddateien erlaubt.'));
        }

        cb(null, true);
    }
});

const sessionStore = new MySQLStore({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PW,
    database: process.env.DB_NAME,

    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 30 * 60 * 1000,

    createDatabaseTable: true,
    schema: {
        tableName: 'user_sessions',
        columnNames: {
            session_id: 'session_id',
            expires: 'expires',
            data: 'data'
        }
    }
});
app.set('trust proxy', 1);

app.use(session({
    key: 'segnitz.sid',
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        secure: false,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 60 * 1000
    }
}));

app.use('/', productRoutes);
app.use('/', cartRoutes);

// Spezifische Route für die Startseite
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/auth-status', (req, res) => {
    res.json({
        loggedIn: !!req.session.user,
        user: req.session.user || null,
        role: req.session.role || null
    });
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/backend.html', checkAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'backend.html'));
});

// Statische Dateien bereitstellen
app.use(express.static("public"));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: 'Zu viele Login-Versuche. Bitte versuche es in 15 Minuten erneut.'
});

app.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
        typeof username !== 'string' ||
        typeof password !== 'string' ||
        !username.trim() ||
        !password
    ) {
        return res.status(400).send('Benutzername und Passwort sind erforderlich.');
    }

    const normalizedUsername = username.trim().toLowerCase();

    if (normalizedUsername.length > 254 || password.length > 128) {
        return res.status(400).send('Eingabe ist zu lang.');
    }

    if (!emailRegex.test(normalizedUsername)) {
        return res.status(400).send('Ungültige E-Mail-Adresse.');
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(
            'SELECT password, role FROM users WHERE username = ? LIMIT 1',
            [normalizedUsername]
        );

        if (rows.length === 0) {
            return res.status(401).send('Falsche Zugangsdaten.');
        }

        const passwordValid = await bcrypt.compare(password, rows[0].password);

        if (!passwordValid) {
            return res.status(401).send('Falsche Zugangsdaten.');
        }

        const previousRedirectAfterLogin = req.session.redirectAfterLogin || null;
        const previousCartKey = req.session.cartKey || null;

        req.session.regenerate(async (err) => {
            if (err) {
                console.error('Session Regenerate Fehler:', err);
                return res.status(500).send('Login fehlgeschlagen.');
            }

            try {
                req.session.user = normalizedUsername;
                req.session.role = rows[0].role;
                req.session.createdAt = Date.now();

                if (previousRedirectAfterLogin) {
                    req.session.redirectAfterLogin = previousRedirectAfterLogin;
                }

                if (previousCartKey) {
                    req.session.cartKey = previousCartKey;
                }

                await mergeGuestCartIntoUserCart(connection, req, normalizedUsername);

                if (connection) await connection.end();
                connection = null;

                const redirectAfterLogin = req.session.redirectAfterLogin || null;
                delete req.session.redirectAfterLogin;

                console.log(
                    new Date().toISOString(),
                    '- Anmeldung: Benutzer',
                    normalizedUsername,
                    'erfolgreich angemeldet mit Rolle',
                    rows[0].role
                );

                return res.status(200).json({
                    message: 'Login erfolgreich!',
                    redirectTo: redirectAfterLogin || (
                        rows[0].role === 'global_admin'
                            ? '/backend.html'
                            : '/index.html'
                    )
                });
            } catch (sessionError) {

                if (connection) await connection.end();
                connection = null;

                console.error('Fehler nach Session-Regeneration:', sessionError);
                return res.status(500).send('Login fehlgeschlagen.');
            }
        });
    } catch (error) {
        console.error('Fehler beim Login:', error);
        return res.status(500).send('Serverfehler beim Versuch, sich anzumelden.');
    } finally {
        // Verbindung wird erst nach Callback benutzt; deshalb hier NICHT schließen
    }
});

app.post('/logout', (req, res) => {
    const timestamp = new Date();
    if (req.session.user) {
        console.log(
            timestamp.toISOString(),
            '- Abmeldung: Benutzer',
            req.session.user,
            'erfolgreich abgemeldet'
        ); // Zugriff auf den gespeicherten Benutzernamen
        req.session.destroy(err => {
            if (err) {
                console.log('Fehler beim Beenden der Sitzung:', err);
                return res.status(500).send('Fehler beim Abmelden');
            }

            res.clearCookie('segnitz.sid');

            res.send('Logout erfolgreich');
        });
    } else {
        res
            .status(400)
            .send("Kein Benutzer ist angemeldet.");
    }
});

function getSignatureDataUrl(formData) {
    for (const step of formData) {
        const signatureElement = step.elements.find(element => element.name === 'Signature');

        if (signatureElement && signatureElement.value) {
            return signatureElement.value;
        }
    }

    return null;
}

app.post('/data', async (req, res) => {
    let connection;

    try {
        const formData = req.body.form;

        const email =
            getFormValue(formData, 'CustomerEmail') ||
            getFormValue(formData, 'email');

        const firstName = getFormValue(formData, 'FirstName');
        const lastName = getFormValue(formData, 'LastName');
        const company = getFormValue(formData, 'CustomerCompany');
        const phone = getFormValue(formData, 'CustomerPhone');
        const address = getFormValue(formData, 'CustomerAddress');
        const zip = getFormValue(formData, 'CustomerZip');
        const city = getFormValue(formData, 'CustomerCity');

        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        if (!req.session.user && email) {
            const [existingUsers] = await connection.execute(
                'SELECT id FROM users WHERE username = ? LIMIT 1',
                [email]
            );

            if (existingUsers.length > 0) {
                return res.status(409).json({
                    error: 'Diese E-Mail-Adresse gehört bereits zu einem Konto. Bitte einloggen.'
                });
            }
        }

        await connection.beginTransaction();

        const userId = await getUserIdByEmail(connection, email);
        const cartId = await getOrCreateActiveCart(connection, req);
        const cartItems = await getCartItemsForOrder(connection, cartId);

        if (cartItems.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Der Warenkorb ist leer.'
            });
        }

        for (const item of cartItems) {
            const available = await checkProductAvailability(
                connection,
                item.productId,
                item.rentalStart,
                item.rentalEnd
            );

            if (!available) {
                await connection.rollback();
                return res.status(409).json({
                    error: `Das Produkt "${item.title}" ist im gewählten Zeitraum nicht mehr verfügbar.`
                });
            }
        }

        const orderNo = await generateOrderNo(connection);
        const orderSummary = buildOrderSummary(orderNo, cartItems);
        const signatureDataUrl = getSignatureDataUrl(formData);

        const [orderResult] = await connection.execute(
            `INSERT INTO rental_orders
            (order_no, cart_id, user_id, customer_email, customer_first_name, customer_last_name,
            customer_company, customer_phone, customer_address, customer_zip, customer_city, signature_data_url, status, reserved_until, confirmation_json, total_amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', DATE_ADD(NOW(), INTERVAL 15 MINUTE), ?, ?)`,
            [
                orderNo,
                cartId,
                userId,
                email,
                firstName,
                lastName,
                company,
                phone,
                address,
                zip,
                city,
                signatureDataUrl,
                JSON.stringify(orderSummary),
                orderSummary.totals.grandTotalBeforeDepositReturn
            ]
        );

        const orderId = orderResult.insertId;

        const [orderRows] = await connection.execute(
            `SELECT DATE_FORMAT(reserved_until, '%Y-%m-%d %H:%i:%s') AS reservedUntil
             FROM rental_orders
             WHERE id = ?`,
            [orderId]
        );

        const reservedUntil = orderRows[0].reservedUntil;

        for (const item of cartItems) {
            await connection.execute(
                `INSERT INTO rental_order_items
                (order_id, product_id, rental_start, rental_end, price_per_day, deposit)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    item.productId,
                    item.rentalStart,
                    item.rentalEnd,
                    item.pricePerDay,
                    item.deposit
                ]
            );

            await connection.execute(
                `UPDATE rental_products
                SET times_ordered = COALESCE(times_ordered, 0) + 1
                WHERE id = ?`,
                [item.productId]
            );
        }

        const paymentMethod =
            req.body.paymentMethod === 'online'
                ? 'online'
                : 'cash';

        console.log('Payment-Methode Backend:', paymentMethod);

        if (paymentMethod === 'online') {

            const payment = await createMolliePaymentForOrder({
                id: orderId,
                orderNo,
                totalAmount: orderSummary.totals.grandTotalBeforeDepositReturn,
                type: 'order_payment'
            });

            await connection.execute(
                `INSERT INTO rental_order_payments
     (order_id, order_item_id, payment_type, payment_method, payment_status, amount, mollie_payment_id, note)
     VALUES (?, NULL, 'initial_payment', 'online', 'pending', ?, ?, ?)`,
                [
                    orderId,
                    orderSummary.totals.grandTotalBeforeDepositReturn,
                    payment.id,
                    'Gesamtzahlung aus Miete und Kaution'
                ]
            );

            await connection.execute(
                `INSERT INTO rental_order_payments
     (order_id, order_item_id, payment_type, payment_method, payment_status, amount, mollie_payment_id, note)
     VALUES (?, NULL, 'rental', 'online', 'pending', ?, ?, ?)`,
                [
                    orderId,
                    orderSummary.totals.rentalTotal,
                    payment.id,
                    'Mietanteil der Initialzahlung'
                ]
            );

            await connection.execute(
                `INSERT INTO rental_order_payments
     (order_id, order_item_id, payment_type, payment_method, payment_status, amount, mollie_payment_id, note)
     VALUES (?, NULL, 'deposit', 'online', 'pending', ?, ?, ?)`,
                [
                    orderId,
                    orderSummary.totals.depositTotal,
                    payment.id,
                    'Kautionsanteil der Initialzahlung'
                ]
            );

            await connection.execute(
                `UPDATE rental_orders
SET payment_method = 'online',
    payment_status = 'pending',
    mollie_payment_id = ?
WHERE id = ?`,
                [
                    payment.id,
                    orderId
                ]
            );

            await connection.commit();

            const checkoutUrl = getMollieCheckoutUrl(payment);

            if (!checkoutUrl) {
                throw new Error('Mollie Checkout-URL fehlt.');
            }

            return res.status(200).json({
                message: 'Online-Zahlung wurde vorbereitet.',
                orderId,
                orderNo,
                checkoutUrl
            });
        }

        await connection.execute(
            `UPDATE rental_orders
     SET payment_method = 'cash',
         payment_status = 'pending'
     WHERE id = ?`,
            [orderId]
        );

        await connection.execute(
            `INSERT INTO rental_order_payments
     (order_id, order_item_id, payment_type, payment_method, payment_status, amount, note)
     VALUES (?, NULL, 'rental', 'cash', 'pending', ?, ?)`,
            [
                orderId,
                orderSummary.totals.rentalTotal,
                'Mietanteil bei Barzahlung'
            ]
        );

        if (Number(orderSummary.totals.depositTotal || 0) > 0) {
            await connection.execute(
                `INSERT INTO rental_order_payments
         (order_id, order_item_id, payment_type, payment_method, payment_status, amount, note)
         VALUES (?, NULL, 'deposit', 'cash', 'pending', ?, ?)`,
                [
                    orderId,
                    orderSummary.totals.depositTotal,
                    'Kautionsanteil bei Barzahlung'
                ]
            );
        }

        await connection.commit();

        const customerOrderEmail =
            getFormValue(formData, 'email') ||
            email;

        const internalOrderEmail = 'orders@segnitzbau.de';

        const recipients = [
            customerOrderEmail,
            internalOrderEmail
        ]
            .filter(Boolean)
            .map(e => e.trim().toLowerCase());

        const uniqueRecipients = [...new Set(recipients)];

        let emailSent = false;

        try {
            emailSent = await sendOrderEmail(
                uniqueRecipients,
                {
                    ...orderSummary,
                    id: orderId,
                    reservedUntil
                },
                {
                    firstName,
                    lastName,
                    company,
                    email,
                    phone,
                    address,
                    zip,
                    city
                },
                signatureDataUrl,
                'Zahlung bei Abholung'
            );
        } catch (emailError) {
            console.error('Fehler beim E-Mail-Versand:', emailError);
        }

        await connection.execute(
            `DELETE FROM rental_carts
             WHERE id = ?`,
            [cartId]
        );

        delete req.session.cartKey;

        return res.status(200).json({
            message: 'Bestellung erfolgreich reserviert.',
            orderId,
            orderNo,
            reservedUntil,
            emailSent
        });

    } catch (error) {
        console.error('Fehler beim Reservieren der Bestellung:', error);

        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback fehlgeschlagen:', rollbackError);
            }
        }

        return res.status(500).json({
            error: 'Bestellung konnte nicht reserviert werden.'
        });

    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

function createVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
}

function getVerificationExpiry() {
    const expires = new Date();
    expires.setHours(expires.getHours() + 24);
    return expires;
}

async function generateCustomerNo(connection) {
    const year = new Date().getFullYear();

    const [rows] = await connection.execute(
        `SELECT customer_no 
         FROM users 
         WHERE customer_no LIKE ?
         ORDER BY customer_no DESC 
         LIMIT 1`,
        [`K${year}%`]
    );

    let nextNumber = 1;

    if (rows.length > 0 && rows[0].customer_no) {
        nextNumber = Number(rows[0].customer_no.slice(5)) + 1;
    }

    return `K${year}${String(nextNumber).padStart(5, '0')}`;
}

app.post('/register-customer', loginLimiter, async (req, res) => {
    const {
        firstName,
        lastName,
        company,
        email,
        phone,
        address,
        zip,
        city,
        password
    } = req.body;

    if (!firstName || !lastName || !email || !phone || !address || !zip || !city || !password) {
        return res.status(400).json({
            error: 'Pflichtfelder fehlen'
        });
    }

    const passwordPolicyRegex = /^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

    if (!passwordPolicyRegex.test(password)) {
        return res.status(400).json({
            error: 'Das Passwort muss mindestens 8 Zeichen, eine Zahl und ein Sonderzeichen enthalten.'
        });
    }

    try {
        const connection = await mysql.createConnection(dbConfig);

        const [existingUsers] = await connection.execute(
            'SELECT id FROM users WHERE username = ?',
            [email]
        );

        if (existingUsers.length > 0) {
            await connection.end();
            return res.status(409).json({
                error: 'Für diese E-Mail existiert bereits ein Konto'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const customerNo = await generateCustomerNo(connection);
        const token = createVerificationToken();
        const expires = getVerificationExpiry();

        await connection.execute(
            `INSERT INTO users 
            (username, password, role, first_name, last_name, company, phone, address, zip, city, customer_no, email_verified, verification_token, verification_expires)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email,
                hashedPassword,
                'user',
                firstName,
                lastName,
                company || null,
                phone,
                address,
                zip,
                city,
                customerNo,
                0,
                token,
                expires
            ]
        );

        await connection.end();

        await sendVerificationEmail(email, token);

        console.log(
            `${new Date().toISOString()} - Registrierung: Neuer Benutzer ${firstName} ${lastName} (E-Mail: ${email}, Kundennummer: ${customerNo}) wurde erfolgreich registriert und eine Bestätigungsmail wurde versendet`
        );

        res.status(201).json({
            message: 'Kundenkonto wurde erstellt. Bitte bestätigen Sie Ihre E-Mail-Adresse.',
            customerNo
        });
    } catch (error) {
        console.error('Fehler beim Erstellen des Kundenkontos:', error);
        res.status(500).json({
            error: 'Fehler beim Erstellen des Kundenkontos'
        });
    }
});

app.get('/verify-email', async (req, res) => {
    const {
        token
    } = req.query;

    if (!token) {
        return res.status(400).send('Ungültiger Bestätigungslink.');
    }

    try {
        const connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const [users] = await connection.execute(
            `SELECT id, username 
             FROM users 
             WHERE verification_token = ? 
             AND verification_expires > NOW()`,
            [token]
        );

        if (users.length > 0) {
            await connection.execute(
                `UPDATE users 
                 SET email_verified = 1, verification_token = NULL, verification_expires = NULL 
                 WHERE id = ?`,
                [users[0].id]
            );

            await connection.end();

            return res.redirect('/email-verified.html');
        }

        const [guests] = await connection.execute(
            `SELECT id, email 
             FROM guest_verifications 
             WHERE verification_token = ? 
             AND expires_at > NOW()`,
            [token]
        );

        if (guests.length > 0) {
            await connection.execute(
                `UPDATE guest_verifications 
                 SET verified = 1 
                 WHERE id = ?`,
                [guests[0].id]
            );

            await connection.end();

            return res.redirect('/email-verified.html');
        }

        await connection.end();
        return res.status(400).send('Bestätigungslink ungültig oder abgelaufen.');
    } catch (error) {
        console.error('Fehler bei E-Mail-Verifikation:', error);
        res.status(500).send('Fehler bei der E-Mail-Verifikation.');
    }
});

app.get('/my-profile', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({
            error: 'Nicht angemeldet'
        });
    }

    try {
        const connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(
            `SELECT 
                username AS email,
                first_name AS firstName,
                last_name AS lastName,
                company AS company,
                phone,
                address,
                zip,
                city,
                customer_no AS customerNo,
                email_verified AS emailVerified
             FROM users
             WHERE username = ?`,
            [req.session.user]
        );

        await connection.end();

        if (rows.length === 0) {
            return res.status(404).json({
                error: 'Benutzer nicht gefunden'
            });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Fehler beim Laden des Benutzerprofils:', error);
        res.status(500).json({
            error: 'Fehler beim Laden des Benutzerprofils'
        });
    }
});

app.put('/my-profile', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Nicht angemeldet.' });
    }

    const { firstName, lastName, company, phone, address, zip, city } = req.body;

    if (!firstName || !lastName || !phone || !address || !zip || !city) {
        return res.status(400).json({ error: 'Pflichtfelder fehlen.' });
    }

    const onlyDigits = /^[0-9]+$/;
    const addressRegex = /^[a-zA-Z0-9äöüÄÖÜß\s]+$/;

    if (!onlyDigits.test(phone)) {
        return res.status(400).json({ error: 'Telefon darf nur Ziffern enthalten.' });
    }

    if (!onlyDigits.test(zip)) {
        return res.status(400).json({ error: 'PLZ darf nur Ziffern enthalten.' });
    }

    if (!addressRegex.test(address)) {
        return res.status(400).json({ error: 'Adresse darf nur Buchstaben, Zahlen und Leerzeichen enthalten.' });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        await connection.execute(
            `UPDATE users
             SET first_name = ?,
                 last_name = ?,
                 company = ?,
                 phone = ?,
                 address = ?,
                 zip = ?,
                 city = ?
             WHERE username = ?`,
            [firstName, lastName, company, phone, address, zip, city, req.session.user]
        );

        res.json({ message: 'Profildaten wurden aktualisiert.' });
    } catch (error) {
        console.error('Fehler beim Aktualisieren des Profils:', error);
        res.status(500).json({ error: 'Profildaten konnten nicht aktualisiert werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.put('/my-profile/password', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Nicht angemeldet.' });
    }

    const { currentPassword, newPassword, newPasswordConfirm } = req.body;

    if (!currentPassword || !newPassword || !newPasswordConfirm) {
        return res.status(400).json({ error: 'Bitte alle Passwortfelder ausfüllen.' });
    }

    if (newPassword !== newPasswordConfirm) {
        return res.status(400).json({ error: 'Die neuen Passwörter stimmen nicht überein.' });
    }

    const passwordPolicyRegex = /^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

    if (!passwordPolicyRegex.test(newPassword)) {
        return res.status(400).json({
            error: 'Das neue Passwort muss mindestens 8 Zeichen, eine Zahl und ein Sonderzeichen enthalten.'
        });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [users] = await connection.execute(
            `SELECT password FROM users WHERE username = ? LIMIT 1`,
            [req.session.user]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
        }

        const passwordValid = await bcrypt.compare(currentPassword, users[0].password);

        if (!passwordValid) {
            return res.status(401).json({ error: 'Das aktuelle Passwort ist falsch.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await connection.execute(
            `UPDATE users SET password = ? WHERE username = ?`,
            [hashedPassword, req.session.user]
        );

        try {
            await sendPasswordChangedEmail(req.session.user);
        } catch (mailError) {
            console.error('Passwort wurde geändert, aber Mailversand fehlgeschlagen:', mailError);
        }

        res.json({ message: 'Passwort wurde geändert. Eine Bestätigungs-E-Mail wurde versendet.' });
    } catch (error) {
        console.error('Fehler beim Ändern des Passworts:', error);
        res.status(500).json({ error: 'Passwort konnte nicht geändert werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.get('/my-orders', async (req, res) => {
    let connection;

    if (!req.session.user) {
        return res.status(401).json({ error: 'Nicht angemeldet.' });
    }

    try {
        connection = await mysql.createConnection(dbConfig);

        const [orders] = await connection.execute(
            `SELECT
                id,
                order_no,
                customer_email,
                customer_first_name,
                customer_last_name,
                status,
                payment_method,
                payment_status,
                DATE_FORMAT(reserved_until, '%Y-%m-%d %H:%i:%s') AS reserved_until,
                DATE_FORMAT(returned_at, '%Y-%m-%d %H:%i:%s') AS returned_at,
                cancel_reason AS cancelReason,
                cancelled_by_name AS cancelledByName,
                DATE_FORMAT(cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelledAt
             FROM rental_orders
             WHERE customer_email = ?
             ORDER BY id DESC`,
            [req.session.user]
        );

        const orderIds = orders.map(order => order.id);

        if (orderIds.length === 0) {
            return res.json([]);
        }

        const placeholders = orderIds.map(() => '?').join(',');

        const [items] = await connection.execute(
            `SELECT
                roi.id,
                roi.order_id AS orderId,
                roi.item_status AS itemStatus,
                roi.return_status AS returnStatus,
                roi.is_damaged AS isDamaged,
                roi.is_late AS isLate,
                roi.deposit_decision AS depositDecision,
                roi.deposit_refund_amount AS depositRefundAmount,
                roi.deposit_deduction_amount AS depositDeductionAmount,
                roi.deposit_deduction_reason AS depositDeductionReason,
                roi.additional_charge_reason AS additionalChargeReason,
                roi.additional_charge_amount AS additionalChargeAmount,
                DATE_FORMAT(roi.returned_at, '%Y-%m-%d %H:%i:%s') AS returnedAt,
                DATE_FORMAT(roi.return_case_processed_at, '%Y-%m-%d %H:%i:%s') AS returnCaseProcessedAt,
                DATE_FORMAT(roi.cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelledAt,
                roi.cancel_reason AS cancelReason,
                roi.cancelled_by_name AS cancelledByName
             FROM rental_order_items roi
             WHERE roi.order_id IN (${placeholders})
             ORDER BY roi.id ASC`,
            orderIds
        );

        const itemsByOrderId = items.reduce((map, item) => {
            const orderId = Number(item.orderId);

            if (!map[orderId]) {
                map[orderId] = [];
            }

            map[orderId].push(item);
            return map;
        }, {});

        const ordersWithItems = orders.map(order => ({
            ...order,
            items: itemsByOrderId[Number(order.id)] || []
        }));

        res.json(ordersWithItems);
    } catch (error) {
        console.error('Fehler beim Laden der Kundenbestellungen:', error);
        res.status(500).json({ error: 'Bestellungen konnten nicht geladen werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.get('/my-orders/:id', async (req, res) => {
    let connection;

    if (!req.session.user) {
        return res.status(401).json({ error: 'Nicht angemeldet.' });
    }

    try {
        connection = await mysql.createConnection(dbConfig);

        const [orders] = await connection.execute(
            `SELECT
                id,
                order_no,
                customer_email,
                customer_first_name,
                customer_last_name,
                customer_company,
                customer_phone,
                customer_address,
                customer_zip,
                customer_city,
                status,
                payment_method,
                payment_status,
                DATE_FORMAT(reserved_until, '%Y-%m-%d %H:%i:%s') AS reserved_until,
                DATE_FORMAT(returned_at, '%Y-%m-%d %H:%i:%s') AS returned_at,
                confirmation_json,
                cancel_reason,
                cancelled_by_name AS cancelledByName,
                DATE_FORMAT(cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelled_at
             FROM rental_orders
             WHERE id = ?
             AND customer_email = ?
             LIMIT 1`,
            [req.params.id, req.session.user]
        );

        if (orders.length === 0) {
            return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
        }

        const [items] = await connection.execute(
            `SELECT
                roi.id,
                roi.order_id AS orderId,
                roi.product_id AS productId,
                p.title,
                DATE_FORMAT(roi.rental_start, '%Y-%m-%d') AS rentalStart,
                DATE_FORMAT(roi.rental_end, '%Y-%m-%d') AS rentalEnd,
                roi.price_per_day AS pricePerDay,
                roi.deposit AS deposit,
                roi.item_status AS itemStatus,
                DATE_FORMAT(roi.cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelledAt,
                roi.cancel_reason AS cancelReason,
                roi.cancelled_by_name AS cancelledByName,
                DATE_FORMAT(roi.actual_return_date, '%Y-%m-%d') AS actualReturnDate,
                roi.return_status AS returnStatus,
                roi.is_damaged AS isDamaged,
                roi.damage_description AS damageDescription,
                roi.is_late AS isLate,
                roi.late_description AS lateDescription,
                DATE_FORMAT(roi.adjusted_rental_start, '%Y-%m-%d') AS adjustedRentalStart,
                DATE_FORMAT(roi.adjusted_rental_end, '%Y-%m-%d') AS adjustedRentalEnd,
                roi.adjusted_price_per_day AS adjustedPricePerDay,
                roi.adjusted_rental_total AS adjustedRentalTotal,
                roi.deposit_decision AS depositDecision,
                roi.deposit_refund_amount AS depositRefundAmount,
                roi.deposit_deduction_amount AS depositDeductionAmount,
                roi.deposit_deduction_reason AS depositDeductionReason,
                roi.additional_charge_reason AS additionalChargeReason,
                roi.additional_charge_amount AS additionalChargeAmount,
                roi.return_notes AS returnNotes,
                DATE_FORMAT(roi.returned_at, '%Y-%m-%d %H:%i:%s') AS returnedAt,
                DATE_FORMAT(roi.return_case_processed_at, '%Y-%m-%d %H:%i:%s') AS returnCaseProcessedAt
             FROM rental_order_items roi
             JOIN rental_products p ON p.id = roi.product_id
             WHERE roi.order_id = ?
             ORDER BY roi.id ASC`,
            [req.params.id]
        );

        let finalItems = items;

        if (finalItems.length === 0 && orders[0].confirmation_json) {
            try {
                const confirmationJson =
                    typeof orders[0].confirmation_json === 'string'
                        ? JSON.parse(orders[0].confirmation_json)
                        : orders[0].confirmation_json;

                finalItems =
                    confirmationJson.order?.items ||
                    confirmationJson.items ||
                    [];
            } catch (jsonError) {
                console.error('Fehler beim Lesen der confirmation_json:', jsonError);
                finalItems = [];
            }
        }

        const [images] = await connection.execute(
            `SELECT
    id,
    order_item_id AS orderItemId,
    image_path AS imagePath,
    created_at
FROM rental_order_return_images
WHERE order_id = ?
ORDER BY id DESC`,
            [req.params.id]
        );

        const [reviews] = await connection.execute(
            `SELECT
        id,
        product_id AS productId,
        order_id AS orderId,
        rating,
        review_text AS reviewText,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
     FROM product_reviews
     WHERE order_id = ?
     AND user_email = ?`,
            [req.params.id, req.session.user]
        );

        const reviewsByProductId = reviews.reduce((map, review) => {
            map[Number(review.productId)] = review;
            return map;
        }, {});

        finalItems = finalItems.map(item => ({
            ...item,
            review: reviewsByProductId[Number(item.productId)] || null
        }));

        const { confirmation_json, ...safeOrder } = orders[0];

        const imagesByItemId = images.reduce((map, image) => {
            const itemId = Number(image.orderItemId);

            if (!itemId) return map;

            if (!map[itemId]) {
                map[itemId] = [];
            }

            map[itemId].push(image);
            return map;
        }, {});

        finalItems = finalItems.map(item => ({
            ...item,
            returnImages: imagesByItemId[Number(item.id)] || []
        }));

        res.json({
            ...safeOrder,
            items: finalItems,
            returnImages: images
        });
    } catch (error) {
        console.error('Fehler beim Laden der Kundenbestellung:', error);
        res.status(500).json({ error: 'Bestellung konnte nicht geladen werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

async function refundFullOnlineOrderPaymentOnCancellation(connection, orderId, order) {
    const [alreadyRefunded] = await connection.execute(
        `SELECT id
         FROM rental_order_payments
         WHERE order_id = ?
         AND payment_type = 'deposit_refund'
         AND note LIKE '%Stornierung%'
         AND payment_status = 'paid'
         LIMIT 1`,
        [orderId]
    );

    if (alreadyRefunded.length > 0) {
        return null;
    }

    const [paidPayments] = await connection.execute(
        `SELECT
        mollie_payment_id,
        amount
     FROM rental_order_payments
     WHERE order_id = ?
     AND payment_type = 'initial_payment'
     AND payment_method = 'online'
     AND payment_status = 'paid'
     AND mollie_payment_id IS NOT NULL
     ORDER BY id ASC
     LIMIT 1`,
        [orderId]
    );

    if (paidPayments.length === 0) {
        return null;
    }

    const paymentId = paidPayments[0].mollie_payment_id;
    const originalPaidAmount = Number(paidPayments[0].amount || 0);

    if (originalPaidAmount <= 0) {
        return null;
    }

    const existingRefunds = await listMollieRefundsForPayment(paymentId);

    const refundList =
        existingRefunds?._embedded?.refunds ||
        existingRefunds?._embedded?.payment_refunds ||
        existingRefunds ||
        [];

    const alreadyRefundedAmount = refundList
        .filter(refund => !['failed', 'canceled', 'cancelled'].includes(String(refund.status || '').toLowerCase()))
        .reduce((sum, refund) => {
            return sum + Number(refund.amount?.value || 0);
        }, 0);

    const refundableAmount = Math.max(
        Number((originalPaidAmount - alreadyRefundedAmount).toFixed(2)),
        0
    );

    if (refundableAmount <= 0) {
        await connection.execute(
            `INSERT INTO rental_order_payments
         (
            order_id,
            order_item_id,
            payment_type,
            payment_method,
            payment_status,
            amount,
            mollie_payment_id,
            note,
            paid_at
         )
         VALUES (?, NULL, 'deposit_refund', 'online', 'paid', 0, ?, ?, NOW())`,
            [
                orderId,
                paymentId,
                'Stornierung: Kein weiterer Mollie-Refund möglich, Zahlung war bereits vollständig erstattet'
            ]
        );

        return null;
    }

    const refund = await createMollieRefundForPayment({
        paymentId,
        amount: refundableAmount,
        description: `Storno Rückerstattung Bestellung ${order.order_no}`,
        metadata: {
            orderId: String(orderId),
            type: 'order_cancellation_refund'
        }
    });

    await connection.execute(
        `INSERT INTO rental_order_payments
         (
            order_id,
            order_item_id,
            payment_type,
            payment_method,
            payment_status,
            amount,
            mollie_payment_id,
            mollie_refund_id,
            note,
            paid_at
         )
         VALUES (?, NULL,'deposit_refund', 'online', 'paid', ?, ?, ?, ?, NOW())`,
        [
            orderId,
            -Math.abs(refundableAmount),
            paymentId,
            refund.id,
            'Komplette Rückerstattung wegen Stornierung vor Abholung'
        ]
    );

    return refund;
}

app.post('/my-orders/:id/cancel', async (req, res) => {
    return res.status(403).json({
        error: 'Stornierungen können nur durch einen Administrator durchgeführt werden.'
    });
});

app.post('/my-orders/:orderId/items/:itemId/cancel', async (req, res) => {

    return res.status(403).json({
        error: 'Stornierungen können nur durch einen Administrator durchgeführt werden.'
    });
});

app.get('/admin/orders', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [orders] = await connection.execute(
            `SELECT
        id,
        order_no,
        customer_email,
        customer_first_name,
        customer_last_name,
        customer_company,
        customer_phone,
        customer_address,
        customer_zip,
        customer_city,
        status,
        payment_method,
        payment_status,
        return_status,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        deposit_decision,
        DATE_FORMAT(reserved_until, '%Y-%m-%d %H:%i:%s') AS reserved_until,
        DATE_FORMAT(returned_at, '%Y-%m-%d %H:%i:%s') AS returned_at,
        cancel_reason AS cancelReason,
        cancelled_by_name AS cancelledByName,
        DATE_FORMAT(cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelledAt
     FROM rental_orders
     ORDER BY id DESC`
        );

        const [items] = await connection.execute(
            `SELECT
        roi.id,
        roi.order_id AS orderId,
        roi.item_status AS itemStatus,
        roi.return_status AS returnStatus,
        DATE_FORMAT(roi.returned_at, '%Y-%m-%d %H:%i:%s') AS returnedAt,
        DATE_FORMAT(roi.cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelledAt,
        roi.cancel_reason AS cancelReason,
        roi.cancelled_by_name AS cancelledByName
     FROM rental_order_items roi
     ORDER BY roi.id ASC`
        );

        const itemsByOrderId = items.reduce((map, item) => {
            const orderId = Number(item.orderId);

            if (!map[orderId]) {
                map[orderId] = [];
            }

            map[orderId].push(item);
            return map;
        }, {});

        const ordersWithItems = orders.map(order => ({
            ...order,
            items: itemsByOrderId[Number(order.id)] || []
        }));

        res.json(ordersWithItems);
    } catch (error) {
        console.error('Fehler beim Laden der Bestellungen:', error);
        res.status(500).json({
            error: 'Bestellungen konnten nicht geladen werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.get('/admin/orders/:id', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [orders] = await connection.execute(
            `SELECT 
        ro.*,
        u.username AS return_processed_by_username,
        cancelledUser.username AS cancelled_by_username
     FROM rental_orders ro
     LEFT JOIN users u ON u.id = ro.return_processed_by_user_id
     LEFT JOIN users cancelledUser ON cancelledUser.id = ro.cancelled_by_user_id
     WHERE ro.id = ?
     LIMIT 1`,
            [req.params.id]
        );

        if (orders.length === 0) {
            return res.status(404).json({
                error: 'Bestellung nicht gefunden.'
            });
        }

        const [items] = await connection.execute(
            `SELECT
                roi.id,
                roi.product_id AS productId,
                roi.item_status AS itemStatus,
                DATE_FORMAT(roi.cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelledAt,
                roi.cancel_reason AS cancelReason,
                roi.cancelled_by_name AS cancelledByName,
                p.title,
                DATE_FORMAT(roi.rental_start, '%Y-%m-%d') AS rentalStart,
                DATE_FORMAT(roi.rental_end, '%Y-%m-%d') AS rentalEnd,
                roi.price_per_day AS pricePerDay,
                roi.deposit,
                DATE_FORMAT(roi.actual_return_date, '%Y-%m-%d') AS actualReturnDate,
                roi.return_status AS returnStatus,
                roi.is_damaged AS isDamaged,
                roi.damage_description AS damageDescription,
                roi.is_late AS isLate,
                roi.late_description AS lateDescription,
                DATE_FORMAT(roi.adjusted_rental_start, '%Y-%m-%d') AS adjustedRentalStart,
                DATE_FORMAT(roi.adjusted_rental_end, '%Y-%m-%d') AS adjustedRentalEnd,
                roi.adjusted_price_per_day AS adjustedPricePerDay,
                roi.adjusted_rental_total AS adjustedRentalTotal,
                roi.deposit_decision AS depositDecision,
                roi.deposit_refund_amount AS depositRefundAmount,
                roi.deposit_deduction_amount AS depositDeductionAmount,
                roi.deposit_deduction_reason AS depositDeductionReason,
                roi.additional_charge_reason AS additionalChargeReason,
                roi.additional_charge_amount AS additionalChargeAmount,
                roi.return_notes AS returnNotes,
                DATE_FORMAT(roi.returned_at, '%Y-%m-%d %H:%i:%s') AS returnedAt,
                DATE_FORMAT(roi.return_case_processed_at, '%Y-%m-%d %H:%i:%s') AS returnCaseProcessedAt
             FROM rental_order_items roi
             JOIN rental_products p ON p.id = roi.product_id
             WHERE roi.order_id = ?
             ORDER BY roi.id ASC`,
            [req.params.id]
        );

        let finalItems = items;

        if (finalItems.length === 0 && orders[0].confirmation_json) {
            try {
                const confirmationJson =
                    typeof orders[0].confirmation_json === 'string'
                        ? JSON.parse(orders[0].confirmation_json)
                        : orders[0].confirmation_json;

                finalItems = confirmationJson.items || confirmationJson.order?.items || [];
            } catch (jsonError) {
                console.error('Fehler beim Lesen der confirmation_json:', jsonError);
            }
        }

        const [images] = await connection.execute(
            `SELECT
    id,
    order_item_id AS orderItemId,
    image_path AS imagePath,
    created_at
FROM rental_order_return_images
WHERE order_id = ?
ORDER BY id DESC`,
            [req.params.id]
        );

        const [payments] = await connection.execute(
            `SELECT
        id,
        order_id AS orderId,
        order_item_id AS orderItemId,
        payment_type AS paymentType,
        payment_method AS paymentMethod,
        payment_status AS paymentStatus,
        amount,
        mollie_payment_id AS molliePaymentId,
        DATE_FORMAT(paid_at, '%Y-%m-%d %H:%i:%s') AS paidAt,
        note,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
        mollie_customer_id AS mollieCustomerId,
        mollie_mandate_id AS mollieMandateId,
        sequence_type AS sequenceType
     FROM rental_order_payments
     WHERE order_id = ?
     ORDER BY created_at DESC`,
            [req.params.id]
        );

        const imagesByItemId = images.reduce((map, image) => {
            const itemId = Number(image.orderItemId);

            if (!itemId) return map;

            if (!map[itemId]) {
                map[itemId] = [];
            }

            map[itemId].push(image);
            return map;
        }, {});

        finalItems = finalItems.map(item => ({
            ...item,
            returnImages: imagesByItemId[Number(item.id)] || []
        }));

        res.json({
            ...orders[0],
            items: finalItems,
            returnImages: images,
            payments
        });

    } catch (error) {
        console.error('Fehler beim Laden der Bestellung:', error);
        res.status(500).json({
            error: 'Bestellung konnte nicht geladen werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.put('/admin/order-items/:itemId/pickup', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const pickedUpByUserId = await getUserIdByEmail(connection, req.session.user);

        const [items] = await connection.execute(
            `SELECT
                roi.id,
                roi.order_id,
                roi.item_status,
                ro.order_no,
                ro.customer_email,
                ro.payment_method,
                ro.payment_status
             FROM rental_order_items roi
             JOIN rental_orders ro ON ro.id = roi.order_id
             WHERE roi.id = ?
             LIMIT 1`,
            [req.params.itemId]
        );

        if (items.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Artikel nicht gefunden.' });
        }

        const item = items[0];

        if (
            String(item.payment_method || '').toLowerCase() === 'cash' &&
            String(item.payment_status || '').toLowerCase() !== 'paid'
        ) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Der Artikel kann erst abgeholt werden, wenn Miete und Kaution bar kassiert wurden.'
            });
        }

        if (String(item.item_status || 'active') !== 'active') {
            await connection.rollback();
            return res.status(409).json({ error: 'Nur aktive Artikel können als abgeholt markiert werden.' });
        }

        await connection.execute(
            `UPDATE rental_order_items
             SET item_status = 'picked_up',
                 picked_up_at = NOW(),
                 picked_up_by_user_id = ?
             WHERE id = ?`,
            [pickedUpByUserId, req.params.itemId]
        );

        await connection.execute(
            `UPDATE rental_orders
             SET status = 'picked_up',
                 return_case_status = 'open',
                 picked_up_at = COALESCE(picked_up_at, NOW()),
                 picked_up_by_user_id = COALESCE(picked_up_by_user_id, ?)
             WHERE id = ?
             AND status IN ('reserved', 'confirmed', 'paid', 'active')`,
            [pickedUpByUserId, item.order_id]
        );

        await connection.commit();

        res.json({ message: 'Artikel wurde als abgeholt markiert.' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Fehler beim Markieren des Artikels als abgeholt:', error);
        res.status(500).json({ error: 'Artikel konnte nicht als abgeholt markiert werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.put('/admin/orders/:id/pick-up', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [orders] = await connection.execute(
            `SELECT id, status, order_no, customer_email, payment_method, payment_status
             FROM rental_orders
             WHERE id = ?
             LIMIT 1`,
            [req.params.id]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
        }

        const order = orders[0];

        if (
            String(order.payment_method || '').toLowerCase() === 'cash' &&
            String(order.payment_status || '').toLowerCase() !== 'paid'
        ) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Die Bestellung kann erst abgeholt werden, wenn Miete und Kaution bar kassiert wurden.'
            });
        }

        if (!['reserved', 'confirmed', 'paid', 'active'].includes(order.status)) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Diese Bestellung kann nicht als abgeholt markiert werden.'
            });
        }

        const pickedUpByUserId = await getUserIdByEmail(connection, req.session.user);

        await connection.execute(
            `UPDATE rental_orders
             SET status = 'picked_up',
                 return_case_status = 'open',
                 picked_up_at = NOW(),
                 picked_up_by_user_id = ?
             WHERE id = ?`,
            [pickedUpByUserId, req.params.id]
        );

        await connection.execute(
            `UPDATE rental_order_items
             SET item_status = 'picked_up',
                 picked_up_at = NOW(),
                 picked_up_by_user_id = ?
             WHERE order_id = ?
             AND COALESCE(item_status, 'active') = 'active'`,
            [pickedUpByUserId, req.params.id]
        );

        await connection.commit();

        try {
            await sendPickedUpEmail(order);
        } catch (mailError) {
            console.error('Abholung gespeichert, aber Mailversand fehlgeschlagen:', mailError);
        }

        res.json({ message: 'Bestellung wurde als abgeholt markiert.' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Fehler beim Markieren als abgeholt:', error);
        res.status(500).json({ error: 'Bestellung konnte nicht als abgeholt markiert werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.put('/admin/orders/:id/cancel', checkAdmin, async (req, res) => {
    let connection;

    try {
        const cancelReason = 'Bestellung durch Administrator storniert';
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [orders] = await connection.execute(
            `SELECT id, status, order_no, customer_email, payment_method
             FROM rental_orders
             WHERE id = ?
             LIMIT 1`,
            [req.params.id]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: 'Bestellung nicht gefunden.'
            });
        }

        const order = orders[0];

        if (['cancelled', 'returned', 'expired', 'picked_up'].includes(order.status)) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Diese Bestellung kann nicht storniert werden.'
            });
        }

        const [pickedUpItems] = await connection.execute(
            `SELECT id
             FROM rental_order_items
             WHERE order_id = ?
             AND (
                item_status = 'picked_up'
                OR picked_up_at IS NOT NULL
             )
             LIMIT 1`,
            [req.params.id]
        );

        if (pickedUpItems.length > 0) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Diese Bestellung kann nicht storniert werden, weil mindestens ein Artikel bereits abgeholt wurde.'
            });
        }

        const cancelledByUserId = await getUserIdByEmail(connection, req.session.user);

        await connection.execute(
            `UPDATE rental_orders
             SET status = 'cancelled',
                 return_case_status = 'closed',
                 cancel_reason = ?,
                 cancelled_by_user_id = ?,
                 cancelled_by_name = ?,
                 cancelled_at = NOW()
             WHERE id = ?`,
            [
                cancelReason,
                cancelledByUserId,
                req.session.user,
                req.params.id
            ]
        );

        await connection.execute(
            `UPDATE rental_order_items
             SET item_status = 'cancelled',
                 cancelled_at = NOW(),
                 cancel_reason = 'Artikel durch Administrator storniert',
                 cancelled_by_name = ?
             WHERE order_id = ?
             AND COALESCE(item_status, 'active') = 'active'
             AND picked_up_at IS NULL
             AND item_status <> 'picked_up'`,
            [
                req.session.user,
                req.params.id
            ]
        );

        if (String(order.payment_method || '').toLowerCase() === 'online') {
            await refundFullOnlineOrderPaymentOnCancellation(
                connection,
                req.params.id,
                order
            );
        }

        await connection.commit();

        try {
            await sendOrderCancelledEmail(order, cancelReason);
        } catch (mailError) {
            console.error('Storno gespeichert, aber Mailversand fehlgeschlagen:', mailError);
        }

        res.json({
            message: 'Bestellung wurde storniert.'
        });

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback fehlgeschlagen:', rollbackError);
            }
        }

        console.error('Fehler beim Stornieren der Bestellung:', error);
        res.status(500).json({
            error: 'Bestellung konnte nicht storniert werden.'
        });
    } finally {
        if (connection) await connection.end();
    }
});

async function refundOnlineOrderItemOnCancellation(connection, item) {
    const [alreadyRefunded] = await connection.execute(
        `SELECT id
         FROM rental_order_payments
         WHERE order_item_id = ?
         AND payment_type = 'order_cancellation_refund'
         AND payment_status = 'paid'
         LIMIT 1`,
        [item.id]
    );

    if (alreadyRefunded.length > 0) {
        return null;
    }

    const rentalDays = calculateRentalDays(item.rental_start, item.rental_end);
    const refundAmount = Number((
        rentalDays * Number(item.price_per_day || 0) +
        Number(item.deposit || 0)
    ).toFixed(2));

    if (refundAmount <= 0) {
        return null;
    }

    const [payments] = await connection.execute(
        `SELECT mollie_payment_id
         FROM rental_order_payments
         WHERE order_id = ?
         AND payment_type = 'initial_payment'
         AND payment_method = 'online'
         AND payment_status = 'paid'
         AND mollie_payment_id IS NOT NULL
         ORDER BY id ASC
         LIMIT 1`,
        [item.order_id]
    );

    if (payments.length === 0) {
        return null;
    }

    const paymentId = payments[0].mollie_payment_id;

    const refund = await createMollieRefundForPayment({
        paymentId,
        amount: refundAmount,
        description: `Artikel-Storno ${item.order_no} - ${item.title} (#${item.id})`,
        metadata: {
            orderId: String(item.order_id),
            itemId: String(item.id),
            type: 'item_cancellation_refund'
        }
    });

    await connection.execute(
        `INSERT INTO rental_order_payments
         (
            order_id,
            order_item_id,
            payment_type,
            payment_method,
            payment_status,
            amount,
            mollie_payment_id,
            mollie_refund_id,
            note,
            paid_at
         )
         VALUES (?, ?, 'order_cancellation_refund', 'online', 'paid', ?, ?, ?, ?, NOW())`,
        [
            item.order_id,
            item.id,
            -Math.abs(refundAmount),
            paymentId,
            refund.id,
            'Anteilig erstattet wegen Artikel-Storno vor Abholung'
        ]
    );

    return refund;
}

app.put('/admin/order-items/:itemId/cancel', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [items] = await connection.execute(
            `SELECT 
    roi.id,
    roi.order_id,
    roi.item_status,
    roi.rental_start,
    roi.rental_end,
    roi.price_per_day,
    roi.deposit,
    ro.payment_method,
    roi.picked_up_at,
    p.title,
    ro.order_no,
    ro.customer_email
FROM rental_order_items roi
JOIN rental_orders ro ON ro.id = roi.order_id
JOIN rental_products p ON p.id = roi.product_id
WHERE roi.id = ?
LIMIT 1`,
            [req.params.itemId]
        );

        if (items.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: 'Bestellposition nicht gefunden.'
            });
        }

        const item = items[0];

        if (item.item_status === 'picked_up' || item.picked_up_at) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Dieser Artikel wurde bereits abgeholt und muss über die Rückgabe abgewickelt werden.'
            });
        }

        if (!['active'].includes(item.item_status)) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Nur aktive Artikel können storniert werden.'
            });
        }

        const cancelledByUserId = await getUserIdByEmail(connection, req.session.user);

        await connection.execute(
            `UPDATE rental_order_items
     SET item_status = 'cancelled',
         cancelled_at = NOW(),
         cancelled_by_user_id = ?,
         cancelled_by_name = ?,
         cancel_reason = 'Artikel durch Administrator storniert'
     WHERE id = ?`,
            [
                cancelledByUserId,
                req.session.user,
                req.params.itemId
            ]
        );
        if (String(item.payment_method || '').toLowerCase() === 'online') {
            await refundOnlineOrderItemOnCancellation(connection, item);
        }

        const [openItems] = await connection.execute(
            `SELECT COUNT(*) AS count
             FROM rental_order_items
             WHERE order_id = ?
             AND COALESCE(item_status, 'active') = 'active'`,
            [item.order_id]
        );

        if (openItems[0].count === 0) {
            await connection.execute(
                `UPDATE rental_orders
         SET status = 'cancelled',
             return_case_status = 'closed',
             cancel_reason = 'Alle Artikel durch Administrator storniert',
             cancelled_by_user_id = ?,
             cancelled_by_name = ?,
             cancelled_at = NOW()
         WHERE id = ?
         AND status NOT IN ('returned', 'expired')`,
                [
                    cancelledByUserId,
                    req.session.user,
                    item.order_id
                ]
            );
        } else {
            await connection.execute(
                `UPDATE rental_orders
                 SET return_case_status = 'partial'
                 WHERE id = ?`,
                [item.order_id]
            );
        }

        await connection.commit();

        try {
            await sendItemCancelledEmail(
                {
                    order_no: item.order_no,
                    customer_email: item.customer_email
                },
                item
            );
        } catch (mailError) {
            console.error('Artikel-Storno gespeichert, aber Mailversand fehlgeschlagen:', mailError);
        }

        res.json({
            message: 'Artikel wurde storniert.'
        });

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback fehlgeschlagen:', rollbackError);
            }
        }

        console.error('Fehler beim Stornieren der Bestellposition:', error);
        res.status(500).json({
            error: 'Artikel konnte nicht storniert werden.'
        });
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/admin/order-items/:itemId/return-images', checkAdmin, uploadReturnImages.array('images', 10), async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [items] = await connection.execute(
            `SELECT id, order_id
             FROM rental_order_items
             WHERE id = ?
             LIMIT 1`,
            [req.params.itemId]
        );

        if (items.length === 0) {
            return res.status(404).json({ error: 'Bestellposition nicht gefunden.' });
        }

        const item = items[0];
        const uploadedByUserId = await getUserIdByEmail(connection, req.session.user);

        for (const file of req.files) {
            const imagePath = `img/returns/${file.filename}`;

            await connection.execute(
                `INSERT INTO rental_order_return_images
                 (order_id, order_item_id, image_path, uploaded_by_user_id)
                 VALUES (?, ?, ?, ?)`,
                [item.order_id, item.id, imagePath, uploadedByUserId]
            );
        }

        res.json({ message: 'Rückgabefotos für den Artikel wurden hochgeladen.' });

    } catch (error) {
        console.error('Fehler beim Hochladen der Artikel-Rückgabefotos:', error);
        res.status(500).json({ error: 'Rückgabefotos konnten nicht hochgeladen werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/admin/order-items/:itemId/send-return-summary', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [items] = await connection.execute(
            `SELECT
                roi.id,
                roi.order_id AS orderId,
                roi.product_id AS productId,
                p.title,
                DATE_FORMAT(roi.rental_start, '%Y-%m-%d') AS rentalStart,
                DATE_FORMAT(roi.rental_end, '%Y-%m-%d') AS rentalEnd,
                DATE_FORMAT(roi.actual_return_date, '%Y-%m-%d') AS actualReturnDate,
                roi.return_status AS returnStatus,
                roi.is_damaged AS isDamaged,
                roi.is_late AS isLate,
                roi.deposit,
                roi.deposit_decision AS depositDecision,
                roi.deposit_refund_amount AS depositRefundAmount,
                roi.deposit_deduction_amount AS depositDeductionAmount,
                roi.additional_charge_amount AS additionalChargeAmount,
                roi.return_notes AS returnNotes,
                ro.order_no AS order_no,
                ro.customer_email AS customer_email
             FROM rental_order_items roi
             JOIN rental_orders ro ON ro.id = roi.order_id
             JOIN rental_products p ON p.id = roi.product_id
             WHERE roi.id = ?
             LIMIT 1`,
            [req.params.itemId]
        );

        if (items.length === 0) {
            return res.status(404).json({
                error: 'Bestellposition nicht gefunden.'
            });
        }

        const item = items[0];

        if (!String(item.returnStatus || '').startsWith('returned_')) {
            return res.status(409).json({
                error: 'Eine Rückgabe-Abschlussmail kann erst nach festgeschriebener Rückgabe versendet werden.'
            });
        }

        const [payments] = await connection.execute(
            `SELECT
                payment_type AS paymentType,
                payment_method AS paymentMethod,
                payment_status AS paymentStatus,
                amount,
                note
             FROM rental_order_payments
             WHERE order_id = ?
             AND order_item_id = ?
             AND payment_type IN ('deposit_refund', 'return_additional_charge')
             ORDER BY id DESC`,
            [
                item.orderId,
                req.params.itemId
            ]
        );

        await sendReturnSummaryEmail(
            {
                order_no: item.order_no,
                customer_email: item.customer_email
            },
            item,
            payments
        );

        res.json({
            message: 'Rückgabe-Abschlussmail wurde versendet.'
        });

    } catch (error) {
        console.error('Fehler beim Versand der Rückgabe-Abschlussmail:', error);
        res.status(500).json({
            error: 'Abschlussmail konnte nicht versendet werden.'
        });
    } finally {
        if (connection) await connection.end();
    }
});

app.put('/admin/order-items/:itemId/rental-adjustment', checkAdmin, async (req, res) => {
    let connection;

    try {
        const {
            adjustedRentalStart,
            adjustedRentalEnd,
            adjustedPricePerDay,
            paymentMethod
        } = req.body;

        connection = await mysql.createConnection(dbConfig);

        const [items] = await connection.execute(
            `SELECT 
    roi.id,
    roi.order_id,
    roi.product_id,
    roi.price_per_day,
    roi.rental_start,
    roi.rental_end,
    roi.adjusted_rental_start,
    roi.adjusted_rental_end,
    roi.adjusted_price_per_day,
    roi.adjusted_rental_total,
    roi.item_status,
    p.title,
    ro.order_no,
ro.customer_email,
ro.payment_method,
ro.mollie_customer_id,
ro.mollie_mandate_id
FROM rental_order_items roi
JOIN rental_orders ro ON ro.id = roi.order_id
JOIN rental_products p ON p.id = roi.product_id
WHERE roi.id = ?
LIMIT 1`,
            [req.params.itemId]
        );

        if (items.length === 0) {
            return res.status(404).json({ error: 'Bestellposition nicht gefunden.' });
        }

        const item = items[0];
        if (!['active', 'picked_up'].includes(item.item_status)) {
            return res.status(409).json({
                error: 'Nur aktive Artikel können geändert werden.'
            });
        }

        const currentStart = item.adjusted_rental_start || item.rental_start;
        const currentEnd = item.adjusted_rental_end || item.rental_end;

        const finalStart = adjustedRentalStart || currentStart;
        const finalEnd = adjustedRentalEnd || currentEnd;
        const finalPricePerDay = Number(
            adjustedPricePerDay ||
            item.adjusted_price_per_day ||
            item.price_per_day ||
            0
        );

        if (new Date(finalEnd) < new Date(finalStart)) {
            return res.status(400).json({
                error: 'Das angepasste Mietende darf nicht vor dem angepassten Mietbeginn liegen.'
            });
        }

        if (new Date(finalEnd) <= new Date(currentEnd)) {
            return res.status(400).json({
                error: 'Es sind nur Verlängerungen möglich. Verkürzungen werden über die Rückgabe abgewickelt.'
            });
        }

        const days = calculateRentalDays(finalStart, finalEnd);
        const adjustedRentalTotal = days * finalPricePerDay;

        const available = await checkProductAvailability(
            connection,
            item.product_id,
            finalStart,
            finalEnd,
            req.params.itemId
        );

        if (!available) {
            return res.status(409).json({
                error: 'Das Produkt ist im gewählten Zeitraum nicht verfügbar.'
            });
        }

        await connection.execute(
            `UPDATE rental_order_items
             SET adjusted_rental_start = ?,
                 adjusted_rental_end = ?,
                 adjusted_price_per_day = ?,
                 adjusted_rental_total = ?
             WHERE id = ?`,
            [
                adjustedRentalStart || null,
                adjustedRentalEnd || null,
                finalPricePerDay,
                adjustedRentalTotal,
                req.params.itemId
            ]
        );

        await connection.execute(
            `UPDATE rental_orders
             SET return_case_status = COALESCE(return_case_status, 'open')
             WHERE id = ?
             AND status != 'returned'`,
            [item.order_id]
        );

        const extensionStartDate = new Date(currentEnd);
        extensionStartDate.setDate(extensionStartDate.getDate() + 1);

        const extensionStart = extensionStartDate.toISOString().slice(0, 10);

        const extensionDays = calculateRentalDays(extensionStart, finalEnd);

        const amountDue = Math.max(extensionDays * finalPricePerDay, 0);
        if (amountDue > 0) {
            const [existingOpenRentalAdjustments] = await connection.execute(
                `SELECT id
         FROM rental_order_payments
         WHERE order_id = ?
         AND order_item_id = ?
         AND payment_type = 'rental_adjustment'
         AND payment_status IN ('pending', 'open', 'authorized')
         LIMIT 1`,
                [item.order_id, req.params.itemId]
            );

            if (existingOpenRentalAdjustments.length > 0) {
                return res.status(409).json({
                    error: 'Es existiert bereits eine offene Mietzeitraum-Nachzahlung für diesen Artikel. Bitte diese zuerst begleichen oder stornieren.'
                });
            }
        }
        const baseUrl = process.env.BASE_URL.replace(/\/$/, '');
        let paymentUrl = null;

        if (amountDue > 0 && item.payment_method === 'cash') {
            await connection.execute(
                `INSERT INTO rental_order_payments
         (
            order_id,
            order_item_id,
            payment_type,
            payment_method,
            payment_status,
            amount,
            note
         )
         VALUES (?, ?, 'rental_adjustment', 'cash', 'pending', ?, ?)`,
                [
                    item.order_id,
                    req.params.itemId,
                    amountDue,
                    'Mietzeitraum-Nachzahlung vor Ort zu zahlen'
                ]
            );

            paymentUrl = null;
        } else if (amountDue > 0) {
            const payment = await createMolliePaymentForOrder({
                id: item.order_id,
                orderNo: item.order_no,
                totalAmount: amountDue,
                description: `Nachzahlung Mietzeitraum ${item.order_no} - ${item.title} (#${req.params.itemId})`,
                type: 'rental_adjustment',
                itemId: req.params.itemId,
                redirectUrl: `${baseUrl}/index.html?payment=extension&orderId=${encodeURIComponent(item.order_id)}&paymentType=rental_adjustment&itemId=${encodeURIComponent(req.params.itemId)}`
            });

            await connection.execute(
                `INSERT INTO rental_order_payments
         (
            order_id,
            order_item_id,
            payment_type,
            payment_method,
            payment_status,
            amount,
            mollie_payment_id
         )
         VALUES (?, ?, 'rental_adjustment', 'online', 'pending', ?, ?)`,
                [
                    item.order_id,
                    req.params.itemId,
                    amountDue,
                    payment.id
                ]
            );

            paymentUrl = getMollieCheckoutUrl(payment);
        }

        try {
            await sendRentalAdjustmentEmailWithPayment(
                {
                    order_no: item.order_no,
                    customer_email: item.customer_email
                },
                item,
                paymentUrl,
                amountDue
            );
        } catch (mailError) {
            console.error(
                'Mietzeitraum gespeichert, aber Mailversand fehlgeschlagen:',
                mailError
            );
        }

        res.json({
            message: 'Mietzeitraum wurde gespeichert.',
            adjustedRentalTotal
        });

    } catch (error) {
        console.error('Fehler beim Speichern des angepassten Mietzeitraums:', error);
        res.status(500).json({
            error: 'Mietzeitraum konnte nicht gespeichert werden.'
        });
    } finally {
        if (connection) await connection.end();
    }
});

function calculateLateDays(actualReturnDate, plannedReturnDate) {
    if (!actualReturnDate || !plannedReturnDate) return 0;

    const actual = new Date(String(actualReturnDate).slice(0, 10));
    const planned = new Date(String(plannedReturnDate).slice(0, 10));

    if (actual <= planned) {
        return 0;
    }

    return Math.ceil((actual - planned) / (1000 * 60 * 60 * 24));
}

app.put('/admin/order-items/:itemId/return', checkAdmin, async (req, res) => {
    let connection;

    try {
        const {
            actualReturnDate,
            additionalChargePaymentMethod,
            adjustedRentalStart,
            adjustedRentalEnd,
            adjustedPricePerDay,
            returnStatus,
            isDamaged,
            damageDescription,
            isLate,
            lateDescription,
            depositDecision,
            depositDeductionPercent,
            depositDeductionReason,
            additionalChargeReason,
            additionalChargeAmount,
            returnNotes
        } = req.body;

        connection = await mysql.createConnection(dbConfig);

        const processedByUserId = await getUserIdByEmail(connection, req.session.user);

        const [items] = await connection.execute(
            `SELECT 
    roi.id,
    roi.order_id,
    roi.price_per_day,
    roi.rental_start,
    roi.rental_end,
    roi.deposit,
    roi.item_status,
    p.title,
ro.order_no,
ro.customer_email,
ro.payment_method,
ro.mollie_payment_id,
ro.mollie_customer_id,
ro.mollie_mandate_id
FROM rental_order_items roi
JOIN rental_orders ro ON ro.id = roi.order_id
JOIN rental_products p ON p.id = roi.product_id
WHERE roi.id = ?
LIMIT 1`,
            [req.params.itemId]
        );

        if (items.length === 0) {
            return res.status(404).json({ error: 'Bestellposition nicht gefunden.' });
        }

        const item = items[0];

        if (item.item_status !== 'picked_up') {
            return res.status(409).json({
                error: 'Nur abgeholte Artikel können zurückgegeben werden.'
            });
        }

        if (item.item_status === 'cancelled') {
            return res.status(409).json({
                error: 'Stornierte Artikel können nicht zurückgegeben werden.'
            });
        }

        if (String(item.item_status || '').startsWith('returned_')) {
            return res.status(409).json({
                error: 'Diese Rückgabe wurde bereits festgeschrieben und kann nicht erneut geändert werden.'
            });
        }

        const finalStart = adjustedRentalStart || item.rental_start;
        const finalEnd = adjustedRentalEnd || actualReturnDate || item.rental_end;
        const finalPricePerDay = Number(adjustedPricePerDay || item.price_per_day || 0);

        const days = calculateRentalDays(finalStart, finalEnd);
        const adjustedRentalTotal = days * finalPricePerDay;
        const deposit = Number(item.deposit || 0);
        const plannedReturnDate = adjustedRentalEnd || item.rental_end;
        const lateDays = calculateLateDays(actualReturnDate, plannedReturnDate);
        const lateFee = lateDays * finalPricePerDay;

        const normalizedAdditionalChargeAmount =
            additionalChargeAmount === null || additionalChargeAmount === undefined || additionalChargeAmount === ''
                ? 0
                : Number(additionalChargeAmount);

        if (Number.isNaN(normalizedAdditionalChargeAmount) || normalizedAdditionalChargeAmount < 0) {
            return res.status(400).json({
                error: 'Zusätzlicher Betrag ist ungültig.'
            });
        }

        const finalReturnStatus =
            isDamaged && isLate
                ? 'returned_late_damaged'
                : isDamaged
                    ? 'returned_damaged'
                    : isLate
                        ? 'returned_late'
                        : 'returned_ok';

        const [openRentalAdjustmentRows] = await connection.execute(
            `SELECT COALESCE(SUM(amount), 0) AS amount
     FROM rental_order_payments
     WHERE order_id = ?
     AND order_item_id = ?
     AND payment_type = 'rental_adjustment'
     AND payment_status IN ('pending', 'open', 'authorized')`,
            [item.order_id, req.params.itemId]
        );

        const openRentalAdjustmentAmount = Number(openRentalAdjustmentRows[0]?.amount || 0);
        const totalOffsetAgainstDeposit =
            normalizedAdditionalChargeAmount +
            openRentalAdjustmentAmount;

        if (openRentalAdjustmentAmount > 0) {
            await connection.execute(
                `UPDATE rental_order_payments
         SET payment_status = 'cancelled',
             note = CONCAT(
                 COALESCE(note, ''),
                 CASE WHEN note IS NULL OR note = '' THEN '' ELSE ' | ' END,
                 'Offene Mietzeitraum-Nachzahlung wurde bei Rückgabe mit Kaution verrechnet'
             )
         WHERE order_id = ?
         AND order_item_id = ?
         AND payment_type = 'rental_adjustment'
         AND payment_status IN ('pending', 'open', 'authorized')`,
                [item.order_id, req.params.itemId]
            );
        }

        const calculatedDepositRefundAmount = Math.max(
            deposit - totalOffsetAgainstDeposit,
            0
        );

        const depositDeductionAmount = Math.max(deposit - calculatedDepositRefundAmount, 0);

        const deductionPercent = deposit > 0
            ? (depositDeductionAmount / deposit) * 100
            : 0;

        const finalDepositDecision =
            calculatedDepositRefundAmount >= deposit
                ? 'full_refund'
                : calculatedDepositRefundAmount > 0
                    ? 'partial_refund'
                    : 'no_refund';

        const customerAdditionalDue =
            Math.max(totalOffsetAgainstDeposit - deposit, 0) + lateFee;

        await connection.execute(
            `UPDATE rental_order_items
             SET actual_return_date = ?,
                 adjusted_rental_start = ?,
                 adjusted_rental_end = ?,
                 adjusted_price_per_day = ?,
                 adjusted_rental_total = ?,
                 item_status = ?,
                 return_status = ?,
                 is_damaged = ?,
                 damage_description = ?,
                 is_late = ?,
                 late_description = ?,
                 deposit_decision = ?,
                 deposit_deduction_percent = ?,
                 deposit_deduction_amount = ?,
                 deposit_refund_amount = ?,
                 deposit_deduction_reason = ?,
                 additional_charge_reason = ?,
                 additional_charge_amount = ?,
                 return_notes = ?,
                 returned_at = NOW(),
                 return_processed_by_user_id = ?,
                 return_case_processed_at = NOW()
             WHERE id = ?`,
            [
                actualReturnDate || null,
                adjustedRentalStart || null,
                adjustedRentalEnd || null,
                finalPricePerDay,
                adjustedRentalTotal,
                finalReturnStatus,
                finalReturnStatus,
                isDamaged ? 1 : 0,
                isDamaged ? 'Beschädigt' : null,
                isLate ? 1 : 0,
                isLate ? 'Verspätet' : null,
                finalDepositDecision,
                deductionPercent,
                depositDeductionAmount,
                calculatedDepositRefundAmount,
                isDamaged ? 'Reparaturkosten mit Kaution verrechnet' : null,
                additionalChargeReason || null,
                normalizedAdditionalChargeAmount,
                returnNotes || null,
                processedByUserId,
                req.params.itemId
            ]
        );

        const [remainingOpenItems] = await connection.execute(
            `SELECT COUNT(*) AS count
             FROM rental_order_items
             WHERE order_id = ?
             AND COALESCE(item_status, 'active') IN ('active', 'picked_up')`,
            [item.order_id]
        );

        const [openBlockingPaymentsBeforeOrderClose] = await connection.execute(
            `SELECT id
     FROM rental_order_payments
     WHERE order_id = ?
     AND order_item_id = ?
     AND payment_type IN ('rental_adjustment', 'return_additional_charge')
     AND payment_status IN ('pending', 'open', 'authorized')
     LIMIT 1`,
            [item.order_id, req.params.itemId]
        );

        const hasBlockingPaymentForReturnCase =
            openBlockingPaymentsBeforeOrderClose.length > 0 ||
            customerAdditionalDue > 0;

        if (remainingOpenItems[0].count === 0) {
            const [returnStatusRows] = await connection.execute(
                `SELECT return_status AS returnStatus
         FROM rental_order_items
         WHERE order_id = ?
         AND item_status LIKE 'returned_%'`,
                [item.order_id]
            );

            const itemReturnStatuses = returnStatusRows.map(row => row.returnStatus);

            let finalOrderReturnStatus = 'returned_ok';

            if (itemReturnStatuses.includes('returned_late_damaged')) {
                finalOrderReturnStatus = 'returned_late_damaged';
            } else if (itemReturnStatuses.includes('returned_damaged')) {
                finalOrderReturnStatus = 'returned_damaged';
            } else if (itemReturnStatuses.includes('returned_late')) {
                finalOrderReturnStatus = 'returned_late';
            }

            await connection.execute(
                `UPDATE rental_orders
         SET status = 'returned',
             return_status = ?,
             returned_at = NOW(),
             return_case_status = CASE
    WHEN ? THEN 'payment_pending'
    ELSE 'closed'
END
         WHERE id = ?`,
                [
                    finalOrderReturnStatus,
                    hasBlockingPaymentForReturnCase,
                    item.order_id
                ]
            );
        } else {
            await connection.execute(
                `UPDATE rental_orders
         SET return_case_status = 'partial'
         WHERE id = ?`,
                [item.order_id]
            );
        }

        const initialPaymentMethod = item.payment_method || null;

        const [openBlockingPayments] = await connection.execute(
            `SELECT id
     FROM rental_order_payments
     WHERE order_id = ?
     AND order_item_id = ?
     AND payment_type IN ('rental_adjustment', 'return_additional_charge')
     AND payment_status IN ('pending', 'open', 'authorized')
     LIMIT 1`,
            [item.order_id, req.params.itemId]
        );

        const hasCurrentReturnAdditionalCharge = customerAdditionalDue > 0;
        const canRefundDepositNow =
            openBlockingPayments.length === 0 &&
            !hasCurrentReturnAdditionalCharge;

        if (
            canRefundDepositNow &&
            calculatedDepositRefundAmount > 0 &&
            ['full_refund', 'partial_refund'].includes(finalDepositDecision)
        ) {

            const [existingRefunds] = await connection.execute(
                `SELECT id
     FROM rental_order_payments
     WHERE order_item_id = ?
     AND payment_type = 'deposit_refund'
     AND payment_status = 'paid'
     LIMIT 1`,
                [req.params.itemId]
            );

            if (existingRefunds.length > 0) {
                throw new Error(
                    'Für diesen Artikel wurde die Kaution bereits erstattet.'
                );
            }

            if (initialPaymentMethod === 'online') {
                const [payments] = await connection.execute(
                    `SELECT mollie_payment_id
         FROM rental_order_payments
         WHERE order_id = ?
         AND payment_type IN ('initial_payment', 'rental', 'deposit')
         AND payment_status = 'paid'
         AND mollie_payment_id IS NOT NULL
         ORDER BY id ASC
         LIMIT 1`,
                    [item.order_id]
                );

                if (payments.length > 0) {
                    const originalPaymentId = payments[0].mollie_payment_id;

                    try {
                        const refund = await createMollieRefundForPayment({
                            paymentId: originalPaymentId,
                            amount: calculatedDepositRefundAmount,
                            description: `Kautionsrückerstattung ${item.order_no} - ${item.title} (#${req.params.itemId})`,
                            metadata: {
                                orderId: String(item.order_id),
                                itemId: String(req.params.itemId),
                                type: 'deposit_refund'
                            }
                        });

                        await connection.execute(
                            `INSERT INTO rental_order_payments
                 (
                    order_id,
                    order_item_id,
                    payment_type,
                    payment_method,
                    payment_status,
                    amount,
                    mollie_payment_id,
                    mollie_refund_id,
                    note,
                    paid_at
                 )
                 VALUES (?, ?, 'deposit_refund', 'online', 'paid', ?, ?, ?, ?, NOW())`,
                            [
                                item.order_id,
                                req.params.itemId,
                                -Math.abs(calculatedDepositRefundAmount),
                                originalPaymentId,
                                refund.id,
                                'Kaution automatisch per Mollie erstattet'
                            ]
                        );
                    } catch (refundError) {
                        console.error('Mollie-Refund fehlgeschlagen:', refundError);

                        await connection.execute(
                            `INSERT INTO rental_order_payments
                 (
                    order_id,
                    order_item_id,
                    payment_type,
                    payment_method,
                    payment_status,
                    amount,
                    note
                 )
                 VALUES (?, ?, 'deposit_refund', 'online', 'failed', ?, ?)`,
                            [
                                item.order_id,
                                req.params.itemId,
                                -Math.abs(calculatedDepositRefundAmount),
                                `Refund fehlgeschlagen: ${refundError.message}`
                            ]
                        );
                    }
                }
            } else if (initialPaymentMethod === 'cash') {
                await connection.execute(
                    `INSERT INTO rental_order_payments
         (
            order_id,
            order_item_id,
            payment_type,
            payment_method,
            payment_status,
            amount,
            note,
            paid_at
         )
         VALUES (?, ?, 'deposit_refund', 'cash', 'pending', ?, ?, NULL)`,
                    [
                        item.order_id,
                        req.params.itemId,
                        -Math.abs(calculatedDepositRefundAmount),
                        'Kaution zur Barauszahlung vorgemerkt'
                    ]
                );
            }
        }

        const [existingOpenReturnCharges] = await connection.execute(
            `SELECT id
     FROM rental_order_payments
     WHERE order_id = ?
     AND order_item_id = ?
     AND payment_type = 'return_additional_charge'
     AND payment_status IN ('pending', 'open')
     LIMIT 1`,
            [item.order_id, req.params.itemId]
        );

        if (
            customerAdditionalDue > 0 &&
            existingOpenReturnCharges.length === 0 &&
            initialPaymentMethod === 'cash'
        ) {
            await connection.execute(
                `INSERT INTO rental_order_payments
         (
            order_id,
            order_item_id,
            payment_type,
            payment_method,
            payment_status,
            amount,
            note
         )
         VALUES (?, ?, 'return_additional_charge', 'cash', 'pending', ?, ?)`,
                [
                    item.order_id,
                    req.params.itemId,
                    customerAdditionalDue,
                    'Rückgabe-Nachzahlung vor Ort zu zahlen'
                ]
            );
        } else if (
            customerAdditionalDue > 0 &&
            existingOpenReturnCharges.length === 0
        ) {
            try {
                const payment = await createMolliePaymentForOrder({
                    id: item.order_id,
                    orderNo: item.order_no,
                    totalAmount: customerAdditionalDue,
                    description: `Nachzahlung Rückgabe ${item.order_no} - ${item.title} (#${req.params.itemId})`,
                    type: 'return_additional_charge',
                    redirectUrl: `${process.env.BASE_URL.replace(/\/$/, '')}/index.html?payment=return_charge&orderId=${encodeURIComponent(item.order_id)}&paymentType=return_additional_charge&itemId=${encodeURIComponent(req.params.itemId)}`,
                    itemId: req.params.itemId
                });

                const checkoutUrl = getMollieCheckoutUrl(payment);

                await connection.execute(
                    `INSERT INTO rental_order_payments
             (
                order_id,
                order_item_id,
                payment_type,
                payment_method,
                payment_status,
                amount,
                mollie_payment_id
             )
             VALUES (?, ?, 'return_additional_charge', 'online', 'pending', ?, ?)`,
                    [
                        item.order_id,
                        req.params.itemId,
                        customerAdditionalDue,
                        payment.id
                    ]
                );

                if (checkoutUrl) {
                    await sendReturnAdditionalChargeEmail(
                        {
                            order_no: item.order_no,
                            customer_email: item.customer_email
                        },
                        item,
                        checkoutUrl,
                        customerAdditionalDue,
                        additionalChargeReason
                    );
                }
            } catch (mailError) {
                console.error(
                    'Rückgabe gespeichert, aber Nachzahlungs-Mail fehlgeschlagen:',
                    mailError
                );
            }
        }

        res.json({
            message: 'Rückgabe der Bestellposition wurde gespeichert.',
            adjustedRentalTotal
        });

    } catch (error) {
        console.error('Fehler bei Positionsrückgabe:', error);
        res.status(500).json({ error: 'Positionsrückgabe konnte nicht gespeichert werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.delete('/admin/return-images/:id', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(
            `SELECT image_path
             FROM rental_order_return_images
             WHERE id = ?
             LIMIT 1`,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Foto nicht gefunden.' });
        }

        const imagePath = path.join(__dirname, 'public', rows[0].image_path);

        await connection.execute(
            `DELETE FROM rental_order_return_images WHERE id = ?`,
            [req.params.id]
        );

        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }

        res.json({ message: 'Rückgabefoto wurde gelöscht.' });
    } catch (error) {
        console.error('Fehler beim Löschen des Rückgabefotos:', error);
        res.status(500).json({ error: 'Rückgabefoto konnte nicht gelöscht werden.' });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.post('/password-reset-request', loginLimiter, async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).send('E-Mail erforderlich.');
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(
            'SELECT id FROM users WHERE username = ? LIMIT 1',
            [email.toLowerCase()]
        );

        if (rows.length === 0) {
            // Wichtig: Keine Info leaken
            return res.status(200).send('Wenn die E-Mail existiert, wurde ein Link versendet.');
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 1000 * 60 * 30); // 30 min

        await connection.execute(
            `UPDATE users
             SET reset_token = ?, reset_token_expires = ?
             WHERE username = ?`,
            [token, expires, email.toLowerCase()]
        );

        const baseUrl = process.env.BASE_URL;

        if (!baseUrl) {
            throw new Error('BASE_URL fehlt in der .env');
        }

        const resetUrl = `${baseUrl.replace(/\/$/, '')}/login.html?resetToken=${token}`;

        try {
            await sendPasswordResetEmail(email.toLowerCase(), resetUrl);
        } catch (mailError) {
            console.error('Fehler beim Versand der Passwort-Reset-Mail:', mailError);
            return res.status(500).send('Reset-Link konnte nicht versendet werden.');
        }

        return res.status(200).send('Wenn die E-Mail existiert, wurde ein Link versendet.');

    } catch (err) {
        console.error(err);
        return res.status(500).send('Fehler beim Anfordern des Reset-Links.');
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/password-reset', async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
        return res.status(400).send('Ungültige Anfrage.');
    }

    const passwordPolicyRegex = /^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

    if (!passwordPolicyRegex.test(password)) {
        return res.status(400).send('Das Passwort muss mindestens 8 Zeichen, eine Zahl und ein Sonderzeichen enthalten.');
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(
            `SELECT id, reset_token_expires
             FROM users
             WHERE reset_token = ?
             LIMIT 1`,
            [token]
        );

        if (rows.length === 0) {
            return res.status(400).send('Ungültiger oder abgelaufener Token.');
        }

        if (new Date(rows[0].reset_token_expires) < new Date()) {
            return res.status(400).send('Token abgelaufen.');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await connection.execute(
            `UPDATE users
             SET password = ?, reset_token = NULL, reset_token_expires = NULL
             WHERE id = ?`,
            [hashedPassword, rows[0].id]
        );

        return res.status(200).send('Passwort erfolgreich geändert.');
    } catch (err) {
        console.error(err);
        return res.status(500).send('Fehler beim Zurücksetzen.');
    } finally {
        if (connection) await connection.end();
    }
});

app.get('/opening-hours/status', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const now = new Date();
        const weekday = now.getDay();
        const currentTime = now.toTimeString().slice(0, 8);

        const [rows] = await connection.execute(
            `SELECT is_open, open_time, close_time
             FROM opening_hours
             WHERE weekday = ?
             LIMIT 1`,
            [weekday]
        );

        if (rows.length === 0 || rows[0].is_open !== 1) {
            return res.json({
                isOpen: false,
                label: 'Geschlossen'
            });
        }

        const hours = rows[0];

        const isCurrentlyOpen =
            currentTime >= hours.open_time &&
            currentTime <= hours.close_time;

        return res.json({
            isOpen: isCurrentlyOpen,
            label: isCurrentlyOpen ? 'Geöffnet' : 'Geschlossen',
            openTime: hours.open_time?.slice(0, 5),
            closeTime: hours.close_time?.slice(0, 5)
        });

    } catch (error) {
        console.error('Fehler beim Laden des Öffnungsstatus:', error);
        res.status(500).json({
            isOpen: false,
            label: 'Unbekannt'
        });
    } finally {
        if (connection) await connection.end();
    }
});

app.get('/admin/opening-hours', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(
            `SELECT weekday, is_open, 
                    TIME_FORMAT(open_time, '%H:%i') AS open_time,
                    TIME_FORMAT(close_time, '%H:%i') AS close_time
             FROM opening_hours
             ORDER BY weekday ASC`
        );

        res.json(rows);
    } catch (error) {
        console.error('Fehler beim Laden der Öffnungszeiten:', error);
        res.status(500).json({ error: 'Öffnungszeiten konnten nicht geladen werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.put('/admin/opening-hours', checkAdmin, async (req, res) => {
    const { openingHours } = req.body;

    if (!Array.isArray(openingHours)) {
        return res.status(400).json({ error: 'Ungültige Öffnungszeiten.' });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        for (const day of openingHours) {
            const weekday = Number(day.weekday);
            const isOpen = day.is_open ? 1 : 0;
            const openTime = isOpen ? day.open_time : null;
            const closeTime = isOpen ? day.close_time : null;

            if (weekday < 0 || weekday > 6) {
                return res.status(400).json({ error: 'Ungültiger Wochentag.' });
            }

            if (isOpen && (!openTime || !closeTime || openTime >= closeTime)) {
                return res.status(400).json({
                    error: 'Bei geöffneten Tagen müssen gültige Öffnungs- und Schließzeiten angegeben werden.'
                });
            }

            await connection.execute(
                `INSERT INTO opening_hours (weekday, is_open, open_time, close_time)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    is_open = VALUES(is_open),
                    open_time = VALUES(open_time),
                    close_time = VALUES(close_time)`,
                [weekday, isOpen, openTime, closeTime]
            );
        }

        res.json({ message: 'Öffnungszeiten wurden gespeichert.' });
    } catch (error) {
        console.error('Fehler beim Speichern der Öffnungszeiten:', error);
        res.status(500).json({ error: 'Öffnungszeiten konnten nicht gespeichert werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/orders/:id/mollie-checkout', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [orders] = await connection.execute(
            `SELECT
                id,
                order_no AS orderNo,
                total_amount AS totalAmount,
                status
             FROM rental_orders
             WHERE id = ?
             LIMIT 1`,
            [req.params.id]
        );

        if (orders.length === 0) {
            return res.status(404).json({
                error: 'Bestellung nicht gefunden.'
            });
        }

        const order = orders[0];

        if (!['reserved', 'pending_payment'].includes(order.status)) {
            return res.status(400).json({
                error: 'Für diese Bestellung kann kein Checkout mehr erstellt werden.'
            });
        }

        const payment = await createMolliePaymentForOrder(order);

        const checkoutUrl = payment.getCheckoutUrl();

        await connection.execute(
            `UPDATE rental_orders
 SET mollie_payment_id = ?,
     mollie_checkout_url = ?,
     mollie_payment_status = ?,
     payment_method = 'online',
     payment_status = 'pending'
 WHERE id = ?`,
            [
                payment.id,
                checkoutUrl,
                payment.status || 'open',
                order.id
            ]
        );

        return res.json({
            success: true,
            checkoutUrl
        });

    } catch (error) {
        console.error('Fehler beim Erstellen des Mollie-Checkouts:', error);

        return res.status(500).json({
            error: 'Checkout konnte nicht erstellt werden.'
        });

    } finally {
        if (connection) await connection.end();
    }
});

app.get('/orders/:id/payment-status', async (req, res) => {
    let connection;
    const paymentType = req.query.paymentType || null;
    const itemId = req.query.itemId || null;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [orders] = await connection.execute(
            `SELECT id, cart_id, order_no AS orderNo, status, payment_status, mollie_payment_id, mollie_payment_status,
       order_confirmation_sent_at, confirmation_json, customer_email, customer_first_name,
       customer_last_name, customer_company, customer_phone, customer_address,
       customer_zip, customer_city, signature_data_url
             FROM rental_orders
             WHERE id = ?
             LIMIT 1`,
            [req.params.id]
        );

        if (orders.length === 0) {
            return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
        }

        if (paymentType) {
            const [paymentRows] = await connection.execute(
                `SELECT
            rop.mollie_payment_id,
            rop.payment_status,
            rop.payment_type,
            ro.order_no AS orderNo
         FROM rental_order_payments rop
         JOIN rental_orders ro ON ro.id = rop.order_id
         WHERE rop.order_id = ?
        AND rop.payment_type = ?
        AND (? IS NULL OR rop.order_item_id = ?)
        ORDER BY rop.id DESC
        LIMIT 1`,
                [req.params.id, paymentType, itemId, itemId]
            );

            if (paymentRows.length === 0 || !paymentRows[0].mollie_payment_id) {
                return res.status(404).json({
                    error: 'Zahlung nicht gefunden.'
                });
            }

            const molliePayment = await getMolliePayment(paymentRows[0].mollie_payment_id);

            const mappedPaymentStatus =
                molliePayment.status === 'paid'
                    ? 'paid'
                    : molliePayment.status === 'failed'
                        ? 'failed'
                        : molliePayment.status === 'canceled'
                            ? 'cancelled'
                            : molliePayment.status === 'expired'
                                ? 'expired'
                                : molliePayment.status === 'authorized'
                                    ? 'authorized'
                                    : 'pending';

            await connection.execute(
                `UPDATE rental_order_payments
         SET payment_status = ?,
             paid_at = CASE
                WHEN ? = 'paid' THEN COALESCE(paid_at, NOW())
                ELSE paid_at
             END
         WHERE mollie_payment_id = ?`,
                [
                    mappedPaymentStatus,
                    mappedPaymentStatus,
                    molliePayment.id
                ]
            );

            if (paymentType === 'return_additional_charge' && mappedPaymentStatus === 'paid') {
                await connection.execute(
                    `UPDATE rental_orders
             SET return_case_status = 'closed'
             WHERE id = ?
             AND return_case_status = 'payment_pending'`,
                    [req.params.id]
                );
            }

            return res.json({
                id: req.params.id,
                orderNo: paymentRows[0].orderNo,
                payment_status: mappedPaymentStatus,
                payment_type: paymentType,
                mollie_payment_status: molliePayment.status,
                mollie_payment_method: molliePayment.method || null
            });
        }

        const order = orders[0];

        if (!order.mollie_payment_id) {
            return res.json(order);
        }

        const payment = await getMolliePayment(order.mollie_payment_id);

        let newOrderStatus = order.status;

        if (payment.status === 'paid') {
            newOrderStatus = 'confirmed';

            if (order.cart_id) {
                await connection.execute(
                    `DELETE FROM rental_carts
             WHERE id = ?`,
                    [order.cart_id]
                );

                delete req.session.cartKey;
            }
        } else if (payment.status === 'canceled') {
            newOrderStatus = 'cancelled';
        } else if (payment.status === 'expired') {
            newOrderStatus = 'expired';
        } else if (payment.status === 'failed') {
            newOrderStatus = 'payment_failed';
        }

        const publicPaymentStatus =
            payment.status === 'paid'
                ? 'paid'
                : payment.status === 'failed'
                    ? 'failed'
                    : payment.status === 'canceled'
                        ? 'cancelled'
                        : payment.status === 'expired'
                            ? 'expired'
                            : payment.status === 'authorized'
                                ? 'authorized'
                                : 'pending';

        await connection.execute(
            `UPDATE rental_orders
             SET mollie_payment_status = ?,
                 mollie_payment_method = ?,
                 payment_status = ?,
                 status = ?,
                 paid_at = CASE
                    WHEN ? = 'paid' THEN NOW()
                    ELSE paid_at
                 END
             WHERE id = ?`,
            [
                payment.status,
                payment.method || null,
                publicPaymentStatus,
                newOrderStatus,
                payment.status,
                order.id
            ]
        );

        await connection.execute(
            `UPDATE rental_order_payments
     SET payment_status = ?,
         paid_at = CASE
            WHEN ? = 'paid' THEN COALESCE(paid_at, NOW())
            ELSE paid_at
         END
     WHERE order_id = ?
     AND mollie_payment_id = ?
     AND payment_type IN ('initial_payment', 'rental', 'deposit')`,
            [
                publicPaymentStatus,
                publicPaymentStatus,
                order.id,
                payment.id
            ]
        );

        return res.json({
            ...order,
            status: newOrderStatus,
            payment_status: publicPaymentStatus,
            mollie_payment_status: payment.status,
            mollie_payment_method: payment.method || null
        });

    } catch (error) {
        console.error('Fehler beim Laden des Zahlungsstatus:', error);
        return res.status(500).json({ error: 'Zahlungsstatus konnte nicht geladen werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/admin/order-payments/manual', checkAdmin, async (req, res) => {
    const {
        orderId,
        orderItemId,
        paymentType,
        amount,
        note
    } = req.body;

    if (!orderId || !paymentType || !amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'Ungültige Zahlungsdaten.' });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const recordedByUserId = await getUserIdByEmail(connection, req.session.user);

        const [orders] = await connection.execute(
            `SELECT id, order_no, customer_email, payment_method, status
             FROM rental_orders
             WHERE id = ?
             LIMIT 1`,
            [orderId]
        );

        if (orders.length === 0) {
            return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
        }
        const order = orders[0];

        if (['cancelled', 'expired'].includes(String(order.status || '').toLowerCase())) {
            return res.status(409).json({
                error: 'Für stornierte oder abgelaufene Bestellungen dürfen keine Zahlungen mehr angenommen werden.'
            });
        }

        const initialPaymentMethod = order.payment_method;

        if (paymentType === 'initial_payment' && initialPaymentMethod !== 'cash') {
            return res.status(409).json({
                error: 'Die Initialzahlung darf nur bei Barzahlungs-Bestellungen manuell erfasst werden.'
            });
        }

        if (
            ['rental_adjustment', 'return_additional_charge'].includes(paymentType) &&
            initialPaymentMethod !== 'cash'
        ) {
            return res.status(409).json({
                error: 'Barzahlung ist für diese Bestellung nicht erlaubt, da die Bestellung nicht bar bezahlt wurde.'
            });
        }

        if (paymentType === 'initial_payment') {
            if (orderItemId) {
                return res.status(400).json({
                    error: 'Die Initialzahlung wird auf Bestellungsebene erfasst, nicht auf Artikelebene.'
                });
            }

            const [openInitialPayments] = await connection.execute(
                `SELECT id, payment_type, amount
         FROM rental_order_payments
         WHERE order_id = ?
         AND order_item_id IS NULL
         AND payment_type IN ('rental', 'deposit')
         AND payment_method = 'cash'
         AND payment_status IN ('pending', 'open')`,
                [orderId]
            );

            if (openInitialPayments.length === 0) {
                return res.status(409).json({
                    error: 'Für diese Bestellung ist keine offene Bar-Initialzahlung vorhanden.'
                });
            }

            const expectedAmount = openInitialPayments.reduce(
                (sum, payment) => sum + Number(payment.amount || 0),
                0
            );

            if (Number(amount).toFixed(2) !== Number(expectedAmount).toFixed(2)) {
                return res.status(400).json({
                    error: `Der Barzahlungsbetrag muss exakt ${expectedAmount.toFixed(2)} € betragen.`
                });
            }

            await connection.execute(
                `UPDATE rental_order_payments
         SET payment_status = 'paid',
             paid_at = NOW(),
             recorded_by_user_id = ?,
             note = COALESCE(?, note)
         WHERE order_id = ?
         AND order_item_id IS NULL
         AND payment_type IN ('rental', 'deposit')
         AND payment_method = 'cash'
         AND payment_status IN ('pending', 'open')`,
                [
                    recordedByUserId,
                    note || 'Miete und Kaution bar bei Abholung kassiert',
                    orderId
                ]
            );

            await connection.execute(
                `INSERT INTO rental_order_payments
         (
            order_id,
            order_item_id,
            payment_type,
            payment_method,
            payment_status,
            amount,
            paid_at,
            recorded_by_user_id,
            note
         )
         VALUES (?, NULL, 'initial_payment', 'cash', 'paid', ?, NOW(), ?, ?)`,
                [
                    orderId,
                    Number(amount),
                    recordedByUserId,
                    note || 'Gesamtzahlung aus Miete und Kaution bar kassiert'
                ]
            );

            await connection.execute(
                `UPDATE rental_orders
         SET payment_method = 'cash',
             payment_status = 'paid',
             paid_at = NOW()
         WHERE id = ?`,
                [orderId]
            );

            await sendPaymentReceiptEmail(order, {
                amount: Number(amount),
                payment_type: 'initial_payment',
                payment_method: 'cash',
                note: note || 'Miete und Kaution bar bei Abholung kassiert'
            });

            return res.json({
                message: 'Barzahlung für Miete und Kaution wurde erfasst und Quittung versendet.'
            });
        }

        if (
            ['rental_adjustment', 'return_additional_charge'].includes(paymentType) &&
            orderItemId
        ) {
            const [alreadyPaidOnlinePayments] = await connection.execute(
                `SELECT id
         FROM rental_order_payments
         WHERE order_id = ?
         AND order_item_id = ?
         AND payment_type = ?
         AND payment_method = 'online'
         AND payment_status = 'paid'
         LIMIT 1`,
                [
                    orderId,
                    orderItemId,
                    paymentType
                ]
            );

            if (alreadyPaidOnlinePayments.length > 0) {
                return res.status(409).json({
                    error: 'Diese Nachzahlung wurde bereits online bezahlt und darf nicht mehr bar verbucht werden.'
                });
            }
        }

        if (['rental_adjustment', 'return_additional_charge'].includes(paymentType) && orderItemId) {
            const [openPayments] = await connection.execute(
                `SELECT id
         FROM rental_order_payments
         WHERE order_id = ?
         AND order_item_id = ?
         AND payment_type = ?
         AND payment_status IN ('pending', 'open')
         ORDER BY id DESC
         LIMIT 1`,
                [orderId, orderItemId, paymentType]
            );

            if (openPayments.length === 0) {
                return res.status(409).json({
                    error: 'Für diese Nachzahlung ist kein offener Zahlungsdatensatz vorhanden.'
                });
            }
        }

        if (['rental_adjustment', 'return_additional_charge'].includes(paymentType) && orderItemId) {
            await connection.execute(
                `UPDATE rental_order_payments
         SET payment_status = 'paid',
             payment_method = 'cash',
             amount = ?,
             paid_at = NOW(),
             recorded_by_user_id = ?,
             note = COALESCE(?, note)
         WHERE order_id = ?
         AND order_item_id = ?
         AND payment_type = ?
         AND payment_status IN ('pending', 'open')
         ORDER BY id DESC
         LIMIT 1`,
                [
                    Number(amount),
                    recordedByUserId,
                    note || null,
                    orderId,
                    orderItemId,
                    paymentType
                ]
            );

            if (paymentType === 'return_additional_charge') {
                await connection.execute(
                    `UPDATE rental_orders
         SET return_case_status = 'closed'
         WHERE id = ?
         AND return_case_status = 'payment_pending'`,
                    [orderId]
                );
            }

        } else {
            await connection.execute(
                `INSERT INTO rental_order_payments
         (order_id, order_item_id, payment_type, payment_method, payment_status, amount, paid_at, recorded_by_user_id, note)
         VALUES (?, ?, ?, 'cash', 'paid', ?, NOW(), ?, ?)`,
                [
                    orderId,
                    orderItemId || null,
                    paymentType,
                    Number(amount),
                    recordedByUserId,
                    note || null
                ]
            );
        }

        if (
            ['rental_adjustment', 'return_additional_charge'].includes(paymentType) &&
            orderItemId
        ) {
            const [pendingOnlinePayments] = await connection.execute(
                `SELECT id, mollie_payment_id
         FROM rental_order_payments
         WHERE order_id = ?
         AND order_item_id = ?
         AND payment_type = ?
         AND payment_method = 'online'
         AND payment_status = 'pending'`,
                [
                    orderId,
                    orderItemId,
                    paymentType
                ]
            );

            for (const pendingPayment of pendingOnlinePayments) {
                if (!pendingPayment.mollie_payment_id) continue;

                try {
                    const molliePayment = await getMolliePayment(pendingPayment.mollie_payment_id);

                    if (!['paid', 'canceled', 'expired', 'failed'].includes(molliePayment.status)) {
                        await cancelMolliePayment(pendingPayment.mollie_payment_id);
                    }
                } catch (error) {
                    console.error(
                        'Mollie-Nachzahlung konnte nicht storniert werden:',
                        pendingPayment.mollie_payment_id,
                        error
                    );
                }
            }

            await connection.execute(
                `UPDATE rental_order_payments
         SET payment_status = 'cancelled',
             note = CONCAT(
                COALESCE(note, ''),
                CASE WHEN note IS NULL OR note = '' THEN '' ELSE ' | ' END,
                'Online-Nachzahlung durch Barzahlung ersetzt'
             )
         WHERE order_id = ?
         AND order_item_id = ?
         AND payment_type = ?
         AND payment_method = 'online'
         AND payment_status = 'pending'`,
                [
                    orderId,
                    orderItemId,
                    paymentType
                ]
            );

            await refundEligibleDepositsAfterPaymentsSettled(connection, orderId);
        }

        if (paymentType === 'rental') {
            await connection.execute(
                `UPDATE rental_orders
                 SET payment_method = 'cash',
                     payment_status = 'paid',
                     paid_at = NOW()
                 WHERE id = ?`,
                [orderId]
            );
        }

        await sendPaymentReceiptEmail(orders[0], {
            amount: Number(amount),
            payment_type: paymentType,
            payment_method: 'cash',
            note
        });

        res.json({ message: 'Barzahlung wurde erfasst und Quittung versendet.' });

    } catch (error) {
        console.error('Fehler beim Erfassen der Barzahlung:', error);
        res.status(500).json({ error: 'Zahlung konnte nicht erfasst werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/admin/order-payments/manual-refund', checkAdmin, async (req, res) => {
    const {
        orderId,
        orderItemId,
        paymentType,
        amount,
        note
    } = req.body;

    if (!orderId || !paymentType || !amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'Ungültige Rückerstattungsdaten.' });
    }

    if (!['deposit_refund', 'order_cancellation_refund'].includes(paymentType)) {
        return res.status(400).json({
            error: 'Diese Zahlungsart ist keine Bar-Rückerstattung.'
        });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const recordedByUserId = await getUserIdByEmail(connection, req.session.user);

        const [orders] = await connection.execute(
            `SELECT id, order_no, customer_email, payment_method
             FROM rental_orders
             WHERE id = ?
             LIMIT 1`,
            [orderId]
        );

        if (orders.length === 0) {
            return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
        }

        const [alreadyRefunded] = await connection.execute(
            `SELECT id
             FROM rental_order_payments
             WHERE order_id = ?
             AND (? IS NULL OR order_item_id = ?)
             AND payment_type = ?
             AND payment_method = 'cash'
             AND payment_status = 'paid'
             LIMIT 1`,
            [
                orderId,
                orderItemId || null,
                orderItemId || null,
                paymentType
            ]
        );

        if (alreadyRefunded.length > 0) {
            return res.status(409).json({
                error: 'Diese Bar-Rückerstattung wurde bereits erfasst.'
            });
        }

        const [openRefunds] = await connection.execute(
            `SELECT id
     FROM rental_order_payments
     WHERE order_id = ?
     AND (? IS NULL OR order_item_id = ?)
     AND payment_type = ?
     AND payment_method = 'cash'
     AND payment_status IN ('pending', 'open')
     ORDER BY id DESC
     LIMIT 1`,
            [
                orderId,
                orderItemId || null,
                orderItemId || null,
                paymentType
            ]
        );

        if (openRefunds.length > 0) {
            await connection.execute(
                `UPDATE rental_order_payments
         SET payment_status = 'paid',
             amount = ?,
             paid_at = NOW(),
             recorded_by_user_id = ?,
             note = COALESCE(?, note)
         WHERE id = ?`,
                [
                    -Math.abs(Number(amount)),
                    recordedByUserId,
                    note || null,
                    openRefunds[0].id
                ]
            );

            await sendPaymentReceiptEmail(orders[0], {
                amount: -Math.abs(Number(amount)),
                payment_type: paymentType,
                payment_method: 'cash',
                note: note || 'Kaution bar an Kunden ausgezahlt'
            });

            return res.json({ message: 'Bar-Rückerstattung wurde erfasst.' });
        }

        await connection.execute(
            `INSERT INTO rental_order_payments
             (
                order_id,
                order_item_id,
                payment_type,
                payment_method,
                payment_status,
                amount,
                paid_at,
                recorded_by_user_id,
                note
             )
             VALUES (?, ?, ?, 'cash', 'paid', ?, NOW(), ?, ?)`,
            [
                orderId,
                orderItemId || null,
                paymentType,
                -Math.abs(Number(amount)),
                recordedByUserId,
                note || null
            ]
        );

        await sendPaymentReceiptEmail(orders[0], {
            amount: -Math.abs(Number(amount)),
            payment_type: paymentType,
            payment_method: 'cash',
            note: note || 'Kaution bar an Kunden ausgezahlt'
        });

        res.json({ message: 'Bar-Rückerstattung wurde erfasst.' });

    } catch (error) {
        console.error('Fehler beim Erfassen der Bar-Rückerstattung:', error);
        res.status(500).json({ error: 'Rückerstattung konnte nicht erfasst werden.' });
    } finally {
        if (connection) await connection.end();
    }
});


async function refundEligibleDepositsAfterPaymentsSettled(connection, orderId) {
    const [items] = await connection.execute(
        `SELECT
            roi.id,
            roi.order_id,
            roi.deposit_refund_amount,
            p.title,
            ro.order_no,
            ro.customer_email,
            ro.payment_method
         FROM rental_order_items roi
         JOIN rental_orders ro ON ro.id = roi.order_id
         JOIN rental_products p ON p.id = roi.product_id
         WHERE roi.order_id = ?
         AND roi.item_status LIKE 'returned_%'
         AND COALESCE(roi.deposit_refund_amount, 0) > 0`,
        [orderId]
    );

    for (const item of items) {
        const [openPayments] = await connection.execute(
            `SELECT id
             FROM rental_order_payments
             WHERE order_id = ?
             AND order_item_id = ?
             AND payment_type IN ('rental_adjustment', 'return_additional_charge')
             AND payment_status IN ('pending', 'open', 'authorized')
             LIMIT 1`,
            [orderId, item.id]
        );

        if (openPayments.length > 0) {
            continue;
        }

        const [existingRefunds] = await connection.execute(
            `SELECT id
             FROM rental_order_payments
             WHERE order_id = ?
             AND order_item_id = ?
             AND payment_type = 'deposit_refund'
             AND payment_status IN ('pending', 'open', 'paid')
             LIMIT 1`,
            [orderId, item.id]
        );

        if (existingRefunds.length > 0) {
            continue;
        }

        const refundAmount = Number(item.deposit_refund_amount || 0);

        if (refundAmount <= 0) {
            continue;
        }

        if (item.payment_method === 'online') {
            const [payments] = await connection.execute(
                `SELECT mollie_payment_id
                 FROM rental_order_payments
                 WHERE order_id = ?
                 AND payment_type IN ('initial_payment', 'rental', 'deposit')
                 AND payment_status = 'paid'
                 AND mollie_payment_id IS NOT NULL
                 ORDER BY id ASC
                 LIMIT 1`,
                [orderId]
            );

            if (payments.length === 0) {
                continue;
            }

            const originalPaymentId = payments[0].mollie_payment_id;

            const refund = await createMollieRefundForPayment({
                paymentId: originalPaymentId,
                amount: refundAmount,
                description: `Kautionsrückerstattung ${item.order_no} - ${item.title} (#${item.id})`,
                metadata: {
                    orderId: String(orderId),
                    itemId: String(item.id),
                    type: 'deposit_refund'
                }
            });

            await connection.execute(
                `INSERT INTO rental_order_payments
                 (
                    order_id,
                    order_item_id,
                    payment_type,
                    payment_method,
                    payment_status,
                    amount,
                    mollie_payment_id,
                    mollie_refund_id,
                    note,
                    paid_at
                 )
                 VALUES (?, ?, 'deposit_refund', 'online', 'paid', ?, ?, ?, ?, NOW())`,
                [
                    orderId,
                    item.id,
                    -Math.abs(refundAmount),
                    originalPaymentId,
                    refund.id,
                    'Kaution automatisch nach Zahlung aller Ausstände erstattet'
                ]
            );
        } else if (item.payment_method === 'cash') {
            await connection.execute(
                `INSERT INTO rental_order_payments
                 (
                    order_id,
                    order_item_id,
                    payment_type,
                    payment_method,
                    payment_status,
                    amount,
                    note,
                    paid_at
                 )
                 VALUES (?, ?, 'deposit_refund', 'cash', 'pending', ?, ?, NULL)`,
                [
                    orderId,
                    item.id,
                    -Math.abs(refundAmount),
                    'Kaution zur Barauszahlung vorgemerkt nach Zahlung aller Ausstände'
                ]
            );
        }
    }
}

app.post('/webhooks/mollie', async (req, res) => {
    let connection;

    try {
        const paymentId = req.body.id;

        if (!paymentId) {
            return res.sendStatus(200);
        }

        const payment = await getMolliePayment(paymentId);

        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const mappedPaymentStatus =
            payment.status === 'paid'
                ? 'paid'
                : payment.status === 'failed'
                    ? 'failed'
                    : payment.status === 'canceled'
                        ? 'cancelled'
                        : payment.status === 'expired'
                            ? 'expired'
                            : payment.status === 'charged_back'
                                ? 'charged_back'
                                : payment.status === 'authorized'
                                    ? 'authorized'
                                    : 'pending';


        try {
            await connection.execute(
                `INSERT INTO mollie_webhook_events
                 (mollie_payment_id, mollie_status)
                 VALUES (?, ?)`,
                [payment.id, payment.status]
            );
        } catch (duplicateEventError) {
            await connection.rollback();
            return res.sendStatus(200);
        }

        const [cashPaidRows] = await connection.execute(
            `SELECT cashPaid.id
     FROM rental_order_payments onlinePayment
     JOIN rental_order_payments cashPaid
       ON cashPaid.order_id = onlinePayment.order_id
      AND cashPaid.order_item_id = onlinePayment.order_item_id
      AND cashPaid.payment_type = onlinePayment.payment_type
     WHERE onlinePayment.mollie_payment_id = ?
     AND onlinePayment.payment_type IN ('rental_adjustment', 'return_additional_charge')
     AND cashPaid.payment_method = 'cash'
     AND cashPaid.payment_status = 'paid'
     LIMIT 1`,
            [payment.id]
        );

        if (cashPaidRows.length > 0) {
            await connection.execute(
                `UPDATE rental_order_payments
         SET payment_status = 'cancelled',
             note = CONCAT(COALESCE(note, ''), ' | Online-Link nach Barzahlung ignoriert')
         WHERE mollie_payment_id = ?
         AND payment_status = 'pending'`,
                [payment.id]
            );

            await connection.commit();
            return res.sendStatus(200);
        }

        await connection.execute(
            `UPDATE rental_order_payments
             SET payment_status = ?,
                 paid_at = CASE
                    WHEN ? = 'paid' THEN COALESCE(paid_at, NOW())
                    ELSE paid_at
                 END
             WHERE mollie_payment_id = ?`,
            [
                mappedPaymentStatus,
                mappedPaymentStatus,
                payment.id
            ]
        );

        const [paymentContextRows] = await connection.execute(
            `SELECT order_id, order_item_id, payment_type
     FROM rental_order_payments
     WHERE mollie_payment_id = ?
     ORDER BY id DESC
     LIMIT 1`,
            [payment.id]
        );

        const paymentContext = paymentContextRows[0] || null;

        if (
            paymentContext &&
            mappedPaymentStatus === 'paid' &&
            paymentContext.payment_type === 'return_additional_charge'
        ) {
            await connection.execute(
                `UPDATE rental_orders
         SET return_case_status = 'closed'
         WHERE id = ?
         AND return_case_status = 'payment_pending'`,
                [paymentContext.order_id]
            );
        }

        if (paymentContext && mappedPaymentStatus === 'paid') {
            await refundEligibleDepositsAfterPaymentsSettled(
                connection,
                paymentContext.order_id
            );
        }

        if (mappedPaymentStatus === 'charged_back') {
            await connection.execute(
                `UPDATE rental_orders ro
         JOIN rental_order_payments rop ON rop.order_id = ro.id
         SET ro.payment_status = 'charged_back',
             ro.return_case_status = 'payment_dispute'
         WHERE rop.mollie_payment_id = ?`,
                [payment.id]
            );

            await connection.execute(
                `INSERT INTO rental_order_payments
         (
            order_id,
            order_item_id,
            payment_type,
            payment_method,
            payment_status,
            amount,
            mollie_payment_id,
            note
         )
         SELECT
            order_id,
            order_item_id,
            'chargeback',
            payment_method,
            'charged_back',
            -ABS(amount),
            mollie_payment_id,
            'Chargeback über Mollie erkannt'
         FROM rental_order_payments
         WHERE mollie_payment_id = ?
         AND payment_status = 'charged_back'
         LIMIT 1`,
                [payment.id]
            );
        }

        const [orders] = await connection.execute(
            `SELECT id, status, order_confirmation_sent_at
             FROM rental_orders
             WHERE mollie_payment_id = ?
             LIMIT 1
             FOR UPDATE`,
            [payment.id]
        );

        if (orders.length === 0) {
            await connection.commit();
            return res.sendStatus(200);
        }

        const order = orders[0];

        let newOrderStatus = order.status;

        if (payment.status === 'paid') {
            newOrderStatus = 'confirmed';
        } else if (payment.status === 'canceled') {
            newOrderStatus = 'cancelled';
        } else if (payment.status === 'expired') {
            newOrderStatus = 'expired';
        } else if (payment.status === 'failed') {
            newOrderStatus = 'payment_failed';
        } else if (payment.status === 'charged_back') {
            newOrderStatus = 'payment_dispute';
        }

        await connection.execute(
            `UPDATE rental_orders
             SET mollie_payment_status = ?,
                 mollie_payment_method = ?,
                 payment_status = ?,
                 status = ?,
                 paid_at = CASE
                    WHEN ? = 'paid' THEN COALESCE(paid_at, NOW())
                    ELSE paid_at
                 END
             WHERE id = ?`,
            [
                payment.status,
                payment.method || null,
                mappedPaymentStatus,
                newOrderStatus,
                mappedPaymentStatus,
                order.id
            ]
        );

        let shouldSendConfirmation = false;

        if (
            mappedPaymentStatus === 'paid' &&
            !order.order_confirmation_sent_at
        ) {
            shouldSendConfirmation = true;

            await connection.execute(
                `UPDATE rental_orders
                 SET order_confirmation_sent_at = NOW()
                 WHERE id = ?
                 AND order_confirmation_sent_at IS NULL`,
                [order.id]
            );
        }

        await connection.commit();

        if (shouldSendConfirmation) {
            const mailConnection = await mysql.createConnection(dbConfig);

            try {
                const [paidOrders] = await mailConnection.execute(
                    `SELECT confirmation_json, customer_email, customer_first_name, customer_last_name,
                            customer_company, customer_phone, customer_address, customer_zip,
                            customer_city, signature_data_url
                     FROM rental_orders
                     WHERE id = ?
                     LIMIT 1`,
                    [order.id]
                );

                if (paidOrders.length > 0) {
                    const paidOrder = paidOrders[0];

                    const orderSummary =
                        typeof paidOrder.confirmation_json === 'string'
                            ? JSON.parse(paidOrder.confirmation_json || '{}')
                            : (paidOrder.confirmation_json || {});

                    const recipients = [
                        paidOrder.customer_email,
                        'orders@segnitzbau.de'
                    ]
                        .filter(Boolean)
                        .map(e => e.trim().toLowerCase());

                    const uniqueRecipients = [...new Set(recipients)];

                    await sendOrderEmail(
                        uniqueRecipients,
                        {
                            ...orderSummary,
                            id: order.id
                        },
                        {
                            firstName: paidOrder.customer_first_name,
                            lastName: paidOrder.customer_last_name,
                            company: paidOrder.customer_company,
                            email: paidOrder.customer_email,
                            phone: paidOrder.customer_phone,
                            address: paidOrder.customer_address,
                            zip: paidOrder.customer_zip,
                            city: paidOrder.customer_city
                        },
                        paidOrder.signature_data_url,
                        'Erfolgreich online gezahlt'
                    );
                }
            } finally {
                await mailConnection.end();
            }
        }

        return res.sendStatus(200);

    } catch (error) {
        console.error('Mollie Webhook Fehler:', error);

        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Mollie Webhook Rollback Fehler:', rollbackError);
            }
        }

        return res.sendStatus(500);

    } finally {
        if (connection) await connection.end();
    }
});

cleanupOnStartup();

setInterval(async () => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);
    } catch (error) {
        console.error(`${new Date().toISOString()} - Fehler beim periodischen Datenbank-Cleanup:`, error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}, 60 * 1000);

app.listen(3000, () => {
    console.log("*********** Segnitz Rental System ***********");
    console.log("Server läuft auf Port 3000");
});
