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
    sendPaymentReceiptEmail
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
    getMollieCheckoutUrl
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

app.post('/my-orders/:id/cancel', async (req, res) => {
    let connection;

    if (!req.session.user) {
        return res.status(401).json({
            error: 'Bitte einloggen.'
        });
    }

    try {
        const orderId = req.params.id;
        const userEmail = req.session.user;

        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [orders] = await connection.execute(
            `SELECT ro.id, ro.status, ro.customer_email, MIN(roi.rental_start) AS firstRentalStart
             FROM rental_orders ro
             JOIN rental_order_items roi ON roi.order_id = ro.id
             WHERE ro.id = ?
             AND ro.customer_email = ?
             GROUP BY ro.id
             LIMIT 1`,
            [orderId, userEmail]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: 'Bestellung nicht gefunden.'
            });
        }

        const order = orders[0];

        if (!['reserved', 'confirmed'].includes(order.status) || order.status === 'picked_up') {
            await connection.rollback();
            return res.status(400).json({
                error: 'Diese Bestellung kann nicht mehr storniert werden.'
            });
        }

        if (order.status === 'picked_up') {
            await connection.rollback();
            return res.status(400).json({
                error: 'Diese Bestellung wurde bereits abgeholt und kann nicht mehr storniert werden.'
            });
        }

        if (order.firstRentalStart && new Date(order.firstRentalStart) <= new Date(new Date().toISOString().slice(0, 10))) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Diese Bestellung kann am Tag des Mietbeginns nicht mehr vom Kunden storniert werden.'
            });
        }

        const cancelledByName = req.session.user;
        const cancelReason = 'Bestellung durch Benutzer storniert';

        await connection.execute(
            `UPDATE rental_orders
     SET status = 'cancelled',
         return_case_status = 'closed',
         cancel_reason = ?,
         cancelled_by_name = ?,
         cancelled_at = NOW()
     WHERE id = ?`,
            [
                cancelReason,
                cancelledByName,
                orderId
            ]
        );

        await connection.execute(
            `UPDATE rental_order_items
     SET item_status = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = ?,
         cancelled_by_name = ?
     WHERE order_id = ?
     AND COALESCE(item_status, 'active') = 'active'`,
            [
                cancelReason,
                cancelledByName,
                orderId
            ]
        );

        await connection.commit();

        return res.json({
            success: true,
            message: 'Bestellung wurde storniert.'
        });

    } catch (error) {
        console.error('Fehler beim Stornieren der Bestellung:', error);

        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback fehlgeschlagen:', rollbackError);
            }
        }

        return res.status(500).json({
            error: 'Bestellung konnte nicht storniert werden.'
        });

    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.post('/my-orders/:orderId/items/:itemId/cancel', async (req, res) => {
    let connection;

    if (!req.session.user) {
        return res.status(401).json({
            error: 'Bitte einloggen.'
        });
    }

    try {
        const { orderId, itemId } = req.params;
        const userEmail = req.session.user;

        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [items] = await connection.execute(
            `SELECT 
                roi.id,
                roi.order_id,
                roi.item_status,
                roi.rental_start,
                ro.status AS order_status,
                ro.customer_email
             FROM rental_order_items roi
             JOIN rental_orders ro ON ro.id = roi.order_id
             WHERE roi.id = ?
             AND roi.order_id = ?
             AND ro.customer_email = ?
             LIMIT 1`,
            [itemId, orderId, userEmail]
        );

        if (items.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: 'Artikel nicht gefunden.'
            });
        }

        const item = items[0];

        if (!['reserved', 'confirmed'].includes(item.order_status)) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Artikel dieser Bestellung können nicht mehr storniert werden.'
            });
        }

        if (item.item_status !== 'active') {
            await connection.rollback();
            return res.status(400).json({
                error: 'Dieser Artikel kann nicht mehr storniert werden.'
            });
        }

        if (item.rental_start && new Date(item.rental_start) <= new Date(new Date().toISOString().slice(0, 10))) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Dieser Artikel kann am Tag des Mietbeginns nicht mehr vom Kunden storniert werden.'
            });
        }

        await connection.execute(
            `UPDATE rental_order_items
     SET item_status = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = 'Artikel durch Benutzer storniert',
         cancelled_by_name = ?
     WHERE id = ?`,
            [req.session.user, itemId]
        );

        const [activeItems] = await connection.execute(
            `SELECT COUNT(*) AS count
             FROM rental_order_items
             WHERE order_id = ?
             AND COALESCE(item_status, 'active') IN ('active', 'picked_up')`,
            [orderId]
        );

        if (activeItems[0].count === 0) {
            await connection.execute(
                `UPDATE rental_orders
                 SET status = 'cancelled',
                     return_case_status = 'closed',
                     cancel_reason = 'Alle Artikel durch Benutzer storniert',
                     cancelled_by_name = ?,
                     cancelled_at = NOW()
                 WHERE id = ?`,
                [req.session.user, orderId]
            );
        } else {
            await connection.execute(
                `UPDATE rental_orders
                 SET return_case_status = 'partial'
                 WHERE id = ?`,
                [orderId]
            );
        }

        await connection.commit();

        return res.json({
            success: true,
            message: 'Artikel wurde storniert.'
        });

    } catch (error) {
        console.error('Fehler beim Stornieren des Artikels:', error);

        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback fehlgeschlagen:', rollbackError);
            }
        }

        return res.status(500).json({
            error: 'Artikel konnte nicht storniert werden.'
        });

    } finally {
        if (connection) await connection.end();
    }
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

app.put('/admin/orders/:id/pick-up', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [orders] = await connection.execute(
            `SELECT id, status, order_no, customer_email
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
        const { cancelReason } = req.body;

        if (!cancelReason || !cancelReason.trim()) {
            return res.status(400).json({
                error: 'Ein Stornogrund ist erforderlich.'
            });
        }

        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [orders] = await connection.execute(
            `SELECT id, status, order_no, customer_email
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

        if (['cancelled', 'returned', 'expired', 'picked_up'].includes(order.status)) {
            return res.status(409).json({
                error: 'Diese Bestellung kann nicht storniert werden.'
            });
        }

        const cancelledByUserId = await getUserIdByEmail(connection, req.session.user);

        await connection.execute(
            `UPDATE rental_orders
            SET status = CASE
        WHEN EXISTS (
            SELECT 1
            FROM rental_order_items
            WHERE order_id = ?
            AND COALESCE(item_status, 'active') = 'active'
            AND rental_start <= CURDATE()
        )
        THEN status
        ELSE 'cancelled'
    END,
    return_case_status = CASE
        WHEN EXISTS (
            SELECT 1
            FROM rental_order_items
            WHERE order_id = ?
            AND COALESCE(item_status, 'active') = 'active'
            AND rental_start <= CURDATE()
        )
        THEN 'open'
        ELSE 'closed'
    END,
             cancel_reason = ?,
             cancelled_by_user_id = ?,
             cancelled_by_name = ?,
             cancelled_at = NOW()
             WHERE id = ?`,
            [
                req.params.id,
                req.params.id,
                cancelReason.trim(),
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
     AND rental_start > CURDATE()`,
            [
                req.session.user,
                req.params.id
            ]
        );

        await connection.commit();

        try {
            await sendOrderCancelledEmail(order, cancelReason.trim());
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
            `SELECT id, order_id
             FROM rental_order_items
             WHERE id = ?
             LIMIT 1`,
            [req.params.itemId]
        );

        if (items.length === 0) {
            return res.status(404).json({
                error: 'Bestellposition nicht gefunden.'
            });
        }

        res.json({
            message: 'Abschlussmail wurde versendet.'
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
    roi.item_status,
    p.title,
    ro.order_no,
ro.customer_email,
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

        const finalStart = adjustedRentalStart || item.rental_start;
        const finalEnd = adjustedRentalEnd || item.rental_end;
        const finalPricePerDay = Number(adjustedPricePerDay || item.price_per_day || 0);

        if (new Date(finalEnd) < new Date(finalStart)) {
            return res.status(400).json({
                error: 'Das angepasste Mietende darf nicht vor dem angepassten Mietbeginn liegen.'
            });
        }

        if (new Date(finalEnd) <= new Date(item.rental_end)) {
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

        const originalDays = calculateRentalDays(item.rental_start, item.rental_end);
        const originalTotal = originalDays * Number(item.price_per_day || 0);
        const amountDue = Math.max(adjustedRentalTotal - originalTotal, 0);

        let paymentUrl = null;

        if (amountDue > 0) {
            const payment = await createMolliePaymentForOrder({
                id: item.order_id,
                orderNo: item.order_no,
                totalAmount: amountDue,
                description: `Nachzahlung Mietzeitraum ${item.order_no}`,
                type: 'rental_adjustment',
                itemId: req.params.itemId,
                redirectUrl: `${process.env.BASE_URL.replace(/\/$/, '')}/index.html?payment=extension&orderId=${encodeURIComponent(item.order_id)}`
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
        VALUES
        (?, ?, 'rental_adjustment', 'online', 'pending', ?, ?)`,
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

        const calculatedDepositRefundAmount = isDamaged
            ? Math.max(deposit - normalizedAdditionalChargeAmount, 0)
            : deposit;

        const depositDeductionAmount = Math.max(deposit - calculatedDepositRefundAmount, 0);

        const deductionPercent = deposit > 0
            ? (depositDeductionAmount / deposit) * 100
            : 0;

        const finalDepositDecision = calculatedDepositRefundAmount > 0
            ? 'full_refund'
            : 'no_refund';

        const customerAdditionalDue = isDamaged
            ? Math.max(normalizedAdditionalChargeAmount - deposit, 0)
            : 0;

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
    WHEN ? > 0 THEN 'payment_pending'
    ELSE 'closed'
END
         WHERE id = ?`,
                [
                    finalOrderReturnStatus,
                    customerAdditionalDue || 0,
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

        if (
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

                const originalPaymentId =
                    payments[0].mollie_payment_id;

                try {

                    const refund =
                        await createMollieRefundForPayment({
                            paymentId: originalPaymentId,
                            amount: calculatedDepositRefundAmount,
                            description:
                                `Kautionsrückerstattung ${item.order_no}`,

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
VALUES (?, ?, 'deposit_refund', 'online',
        'paid', ?, ?, ?, ?, NOW())`,
                        [
                            item.order_id,
                            req.params.itemId,
                            -Math.abs(calculatedDepositRefundAmount),
                            originalPaymentId,
                            refund.id,
                            'Kaution automatisch erstattet'
                        ]
                    );

                } catch (refundError) {

                    console.error(
                        'Mollie-Refund fehlgeschlagen:',
                        refundError
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
                    note
                )
                VALUES (?, ?, 'deposit_refund',
                        'online', 'failed', ?, ?)`,
                        [
                            item.order_id,
                            req.params.itemId,
                            -Math.abs(calculatedDepositRefundAmount),
                            `Refund fehlgeschlagen: ${refundError.message}`
                        ]
                    );
                }
            }
        }

        if (customerAdditionalDue > 0) {

            try {

                const payment = await createMolliePaymentForOrder({
                    id: item.order_id,
                    orderNo: item.order_no,
                    totalAmount: customerAdditionalDue,
                    description: `Nachzahlung Rückgabe ${item.order_no}`,
                    type: 'return_additional_charge',
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
            `SELECT id, order_no, customer_email
             FROM rental_orders
             WHERE id = ?
             LIMIT 1`,
            [orderId]
        );

        if (orders.length === 0) {
            return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
        }

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

        if (mappedPaymentStatus === 'paid') {
            const [additionalChargeRows] = await connection.execute(
                `SELECT order_id
         FROM rental_order_payments
         WHERE mollie_payment_id = ?
         AND payment_type = 'return_additional_charge'
         AND payment_status = 'paid'
         LIMIT 1`,
                [payment.id]
            );

            if (additionalChargeRows.length > 0) {
                await connection.execute(
                    `UPDATE rental_orders
             SET return_case_status = 'closed'
             WHERE id = ?
             AND return_case_status = 'payment_pending'`,
                    [additionalChargeRows[0].order_id]
                );
            }
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
