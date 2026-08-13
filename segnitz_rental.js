const express = require("express");
const app = express();
const path = require("path");
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const {
    assertSecurityEnvironment,
    createHelmetOptions,
    createSessionCookieOptions
} = require('./config/security');

assertSecurityEnvironment();
app.use(helmet(createHelmetOptions()));
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
const { getSafeImageExtension, imageFileFilter } = require('./utils/uploads');
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
const {
    checkProductAvailability,
    lockRentalProducts
} = require('./utils/availability');

const {
    createMolliePaymentForOrder,
    getMolliePayment,
    createMollieRefundForPayment,
    listMollieRefundsForPayment,
    getMollieCheckoutUrl,
    cancelMolliePayment
} = require('./services/mollieService');

const {
    calculateReturnSettlement, deriveAggregateReturnStatus,
    deriveOrderStatusFromInitialPayment, deriveReturnCaseStatus,
    isDuplicateKeyError,
    isOpenPaymentStatus,
    isStrictIsoDate,
    mapMolliePaymentStatus,
    mapMollieRefundStatus,
    roundMoney
} = require('./services/paymentStateService');


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

const returnImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public', 'img', 'returns'));
    },
    filename: (req, file, cb) => {
        const extension = getSafeImageExtension(file.mimetype);

        if (!extension) {
            return cb(new Error('Ungültiger Bildtyp.'));
        }

        return cb(
            null,
            `return_item_${req.params.itemId}_${Date.now()}_${crypto.randomUUID()}${extension}`
        );
    }
});

const uploadReturnImages = multer({
    storage: returnImageStorage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 10,
        fields: 20,
        parts: 30
    },
    fileFilter: imageFileFilter
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
    cookie: createSessionCookieOptions()
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

const adminReturnMutationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Zu viele Rückgabeaktionen. Bitte versuche es in einigen Minuten erneut.'
    }
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
    if (!Array.isArray(formData)) return null;

    for (const step of formData) {
        const signatureElement = Array.isArray(step?.elements)
            ? step.elements.find(element => element.name === 'Signature')
            : null;

        if (signatureElement && signatureElement.value) {
            return signatureElement.value;
        }
    }

    return null;
}

function isFormCheckboxChecked(formData, fieldName) {
    if (!Array.isArray(formData)) return false;

    const element = formData
        .flatMap(step => Array.isArray(step?.elements) ? step.elements : [])
        .find(field => field?.name === fieldName);
    const normalizedValue = String(element?.value || '').toLowerCase();

    return element?.checked === true || ['on', 'true', '1'].includes(normalizedValue);
}

app.post('/data', async (req, res) => {
    let connection;

    try {
        const formData = req.body.form;

        if (!Array.isArray(formData)) {
            return res.status(400).json({ error: 'Formulardaten fehlen oder sind ungültig.' });
        }

        if (!['cash', 'online'].includes(req.body.paymentMethod)) {
            return res.status(400).json({ error: 'Ungültige Zahlungsmethode.' });
        }

        const paymentMethod = req.body.paymentMethod;

        const submittedEmail =
            getFormValue(formData, 'CustomerEmail') ||
            getFormValue(formData, 'email');

        const email = String(req.session.user || submittedEmail || '').trim().toLowerCase();

        const firstName = String(getFormValue(formData, 'FirstName') || '').trim();
        const lastName = String(getFormValue(formData, 'LastName') || '').trim();
        const company = String(getFormValue(formData, 'CustomerCompany') || '').trim();
        const phone = String(getFormValue(formData, 'CustomerPhone') || '').trim();
        const address = String(getFormValue(formData, 'CustomerAddress') || '').trim();
        const zip = String(getFormValue(formData, 'CustomerZip') || '').trim();
        const city = String(getFormValue(formData, 'CustomerCity') || '').trim();
        const signatureDataUrl = getSignatureDataUrl(formData);

        if (
            !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            !firstName || !lastName || !phone || !address || !zip || !city ||
            !/^[0-9]+$/.test(phone) ||
            !/^[0-9]+$/.test(zip) ||
            !/^[a-zA-Z0-9äöüÄÖÜß\s]+$/.test(address)
        ) {
            return res.status(400).json({
                error: 'Bitte füllen Sie alle Pflichtfelder mit gültigen Kundendaten aus.'
            });
        }

        if (!isFormCheckboxChecked(formData, 'agbs') || !isFormCheckboxChecked(formData, 'dsgvo')) {
            return res.status(400).json({
                error: 'AGB und Datenschutzerklärung müssen bestätigt werden.'
            });
        }

        if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(String(signatureDataUrl || ''))) {
            return res.status(400).json({ error: 'Eine gültige Unterschrift ist erforderlich.' });
        }

        if (
            req.session.user &&
            submittedEmail &&
            String(submittedEmail).trim().toLowerCase() !== String(req.session.user).toLowerCase()
        ) {
            return res.status(403).json({
                error: 'Die Bestellung muss mit der E-Mail-Adresse des angemeldeten Kontos angelegt werden.'
            });
        }

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

        const lockedProducts = await lockRentalProducts(
            connection,
            cartItems.map(item => item.productId)
        );
        const today = new Date().toLocaleDateString('sv-SE');

        if (lockedProducts.some(product => Number(product.is_active) !== 1)) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Mindestens ein Produkt im Warenkorb ist nicht mehr aktiv.'
            });
        }

        for (const item of cartItems) {
            if (
                !isStrictIsoDate(item.rentalStart) ||
                !isStrictIsoDate(item.rentalEnd) ||
                item.rentalStart < today ||
                item.rentalEnd < item.rentalStart
            ) {
                await connection.rollback();
                return res.status(400).json({
                    error: `Der Mietzeitraum für "${item.title}" ist nicht mehr gültig.`
                });
            }

            const available = await checkProductAvailability(
                connection,
                item.productId,
                item.rentalStart,
                item.rentalEnd,
                null,
                true
            );

            if (!available) {
                await connection.rollback();
                return res.status(409).json({
                    error: `Das Produkt "${item.title}" ist im gewählten Zeitraum nicht mehr verfügbar.`
                });
            }
        }

        const orderNo = await generateOrderNo(connection);
        const initialOrderStatus = paymentMethod === 'cash' ? 'confirmed' : 'reserved';
        const orderSummary = buildOrderSummary(orderNo, cartItems, initialOrderStatus);

        const [orderResult] = await connection.execute(
            `INSERT INTO rental_orders
            (order_no, cart_id, user_id, customer_email, customer_first_name, customer_last_name,
            customer_company, customer_phone, customer_address, customer_zip, customer_city, signature_data_url, status, reserved_until, confirmation_json, total_amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                CASE WHEN ? = 'reserved' THEN DATE_ADD(NOW(), INTERVAL 15 MINUTE) ELSE NULL END,
                ?, ?)`,
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
                initialOrderStatus,
                initialOrderStatus,
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

        console.log('Payment-Methode Backend:', paymentMethod);

        if (paymentMethod === 'online') {

            const payment = await createMolliePaymentForOrder({
                id: orderId,
                orderNo,
                totalAmount: orderSummary.totals.grandTotalBeforeDepositReturn,
                type: 'order_payment',
                idempotencyKey: `initial-order-payment-${orderId}`
            });
            const checkoutUrl = getMollieCheckoutUrl(payment);

            if (!checkoutUrl) {
                throw new Error('Mollie Checkout-URL fehlt.');
            }

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
    mollie_payment_id = ?,
    mollie_checkout_url = ?,
    mollie_payment_status = ?
WHERE id = ?`,
                [
                    payment.id,
                    checkoutUrl,
                    payment.status || 'open',
                    orderId
                ]
            );

            await connection.execute(
                `UPDATE rental_carts
                 SET status = 'converted', updated_at = NOW()
                 WHERE id = ?`,
                [cartId]
            );

            await connection.commit();

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
         payment_status = 'pending',
         status = 'confirmed',
         reserved_until = NULL
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

        await connection.execute(
            `DELETE FROM rental_carts
             WHERE id = ?`,
            [cartId]
        );

        await connection.commit();

        const customerOrderEmail = email;

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

        delete req.session.cartKey;

        return res.status(200).json({
            message: 'Bestellung bestätigt. Miete und Kaution sind bei Abholung bar zu zahlen.',
            orderId,
            orderNo,
            reservedUntil: null,
            amountDue: orderSummary.totals.grandTotalBeforeDepositReturn,
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

function parsePositiveInt(value, fallback, max = 100) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number) || number < 1) return fallback;
    return Math.min(number, max);
}

function addOrderListFilters({ where, params, query, year, month, status, returnStatus, paymentStatus, customerEmail }) {
    if (customerEmail) {
        where.push('ro.customer_email = ?');
        params.push(customerEmail);
    }

    if (year) {
        where.push('YEAR(ro.created_at) = ?');
        params.push(year);
    }

    if (month) {
        where.push('MONTH(ro.created_at) = ?');
        params.push(Number(month));
    }

    if (status) {
        where.push('ro.status = ?');
        params.push(status);
    }

    if (returnStatus) {
        where.push('ro.return_status = ?');
        params.push(returnStatus);
    }

    if (paymentStatus) {
        where.push('ro.payment_status = ?');
        params.push(paymentStatus);
    }

    if (query) {
        where.push(`(
            ro.order_no LIKE ?
            OR ro.customer_email LIKE ?
            OR ro.customer_company LIKE ?
            OR ro.customer_first_name LIKE ?
            OR ro.customer_last_name LIKE ?
            OR ro.customer_phone LIKE ?
            OR ro.customer_city LIKE ?
            OR ro.status LIKE ?
            OR ro.payment_status LIKE ?
            OR ro.payment_method LIKE ?
            OR ro.return_status LIKE ?
        )`);

        const like = `%${query}%`;
        params.push(like, like, like, like, like, like, like, like, like, like, like);
    }
}

app.get('/my-orders', async (req, res) => {
    let connection;

    if (!req.session.user) {
        return res.status(401).json({ error: 'Nicht angemeldet.' });
    }

    try {
        connection = await mysql.createConnection(dbConfig);

        const page = parsePositiveInt(req.query.page, 1, 100000);
        const limit = parsePositiveInt(req.query.limit, 10, 100);
        const offset = (page - 1) * limit;

        const where = [];
        const params = [];

        addOrderListFilters({
            where,
            params,
            customerEmail: req.session.user,
            year: String(req.query.year || '').trim(),
            month: String(req.query.month || '').trim(),
            status: String(req.query.status || '').trim(),
            returnStatus: String(req.query.returnStatus || '').trim(),
            paymentStatus: String(req.query.paymentStatus || '').trim()
        });

        const whereSql = `WHERE ${where.join(' AND ')}`;

        const [countRows] = await connection.execute(
            `SELECT COUNT(*) AS total
             FROM rental_orders ro
             ${whereSql}`,
            params
        );

        const total = Number(countRows[0]?.total || 0);

        // mysql2 bindet JavaScript-Zahlen im Prepared-Statement-Protokoll als DOUBLE.
        // MySQL 8.4 akzeptiert diesen Typ nicht für LIMIT/OFFSET; query() escaped
        // weiterhin alle Werte, setzt die validierten Ganzzahlen aber als SQL-Zahlen ein.
        const [orders] = await connection.query(
            `SELECT
                ro.id,
                ro.order_no,
                ro.customer_email,
                ro.customer_first_name,
                ro.customer_last_name,
                ro.status,
                ro.payment_method,
                ro.payment_status,
                ro.return_status,
                ro.return_case_status,
                DATE_FORMAT(ro.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                DATE_FORMAT(ro.reserved_until, '%Y-%m-%d %H:%i:%s') AS reserved_until,
                DATE_FORMAT(ro.returned_at, '%Y-%m-%d %H:%i:%s') AS returned_at,
                ro.cancel_reason AS cancelReason,
                ro.cancelled_by_name AS cancelledByName,
                DATE_FORMAT(ro.cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelledAt
             FROM rental_orders ro
             ${whereSql}
             ORDER BY ro.id DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const orderIds = orders.map(order => order.id);
        let itemsByOrderId = {};

        if (orderIds.length > 0) {
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

            itemsByOrderId = items.reduce((map, item) => {
                const orderId = Number(item.orderId);
                if (!map[orderId]) map[orderId] = [];
                map[orderId].push(item);
                return map;
            }, {});
        }

        const [filterRows] = await connection.execute(
            `SELECT
                YEAR(created_at) AS year,
                LPAD(MONTH(created_at), 2, '0') AS month,
                status,
                return_status AS returnStatus,
                payment_status AS paymentStatus
             FROM rental_orders
             WHERE customer_email = ?
             ORDER BY created_at DESC`,
            [req.session.user]
        );

        res.json({
            items: orders.map(order => ({
                ...order,
                items: itemsByOrderId[Number(order.id)] || []
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(Math.ceil(total / limit), 1)
            },
            filterOptions: {
                years: [...new Set(filterRows.map(row => String(row.year)).filter(Boolean))],
                months: [...new Set(filterRows.map(row => row.month).filter(Boolean))],
                statuses: [...new Set(filterRows.map(row => row.status).filter(Boolean))],
                returnStatuses: [...new Set(filterRows.map(row => row.returnStatus).filter(Boolean))],
                paymentStatuses: [...new Set(filterRows.map(row => row.paymentStatus).filter(Boolean))]
            }
        });
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
                return_case_status,
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
                DATE_FORMAT(roi.picked_up_at, '%Y-%m-%d %H:%i:%s') AS pickedUpAt,
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

        const [payments] = await connection.execute(
            `SELECT
                id,
                order_item_id AS orderItemId,
                payment_type AS paymentType,
                payment_method AS paymentMethod,
                payment_status AS paymentStatus,
                amount,
                checkout_url AS checkoutUrl,
                note,
                SHA2(CONCAT(
                    payment_type,
                    '|',
                    COALESCE(CAST(order_item_id AS CHAR), 'order'),
                    '|',
                    COALESCE(mollie_payment_id, payment_method)
                ), 256) AS refundGroupKey,
                DATE_FORMAT(paid_at, '%Y-%m-%d %H:%i:%s') AS paidAt,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
             FROM rental_order_payments
             WHERE order_id = ?
             ORDER BY created_at DESC, id DESC`,
            [req.params.id]
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
            returnImages: images,
            payments
        });
    } catch (error) {
        console.error('Fehler beim Laden der Kundenbestellung:', error);
        res.status(500).json({ error: 'Bestellung konnte nicht geladen werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

async function syncMollieRefundsForPayment(connection, paymentId) {
    const refunds = await listMollieRefundsForPayment(paymentId);
    const refundList =
        refunds?._embedded?.refunds ||
        refunds?._embedded?.payment_refunds ||
        (Array.isArray(refunds) ? refunds : []);

    for (const refund of refundList) {
        if (!refund?.id) continue;

        const status = mapMollieRefundStatus(refund.status);
        await connection.execute(
            `UPDATE rental_order_payments
             SET payment_status = ?,
                 paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, NOW()) ELSE NULL END
             WHERE mollie_refund_id = ?`,
            [status, status, refund.id]
        );
    }
}

async function refreshCancelledOrderPaymentStatus(connection, orderId) {
    const [rows] = await connection.execute(
        `SELECT
            COUNT(*) AS refundCount,
            SUM(effectiveStatus = 'paid') AS paidCount,
            SUM(effectiveStatus = 'pending') AS pendingCount,
            SUM(effectiveStatus = 'failed') AS failedCount
         FROM (
            SELECT
                order_item_id,
                mollie_payment_id,
                CASE
                    WHEN SUM(payment_status IN ('pending', 'open', 'authorized')) > 0 THEN 'pending'
                    WHEN SUM(payment_status = 'paid') > 0 THEN 'paid'
                    ELSE 'failed'
                END AS effectiveStatus
            FROM rental_order_payments
            WHERE order_id = ?
            AND payment_type = 'order_cancellation_refund'
            GROUP BY order_item_id, mollie_payment_id
         ) refundTargets`,
        [orderId]
    );

    const summary = rows[0] || {};
    let paymentStatus = 'cancelled';

    if (Number(summary.pendingCount || 0) > 0) paymentStatus = 'refund_pending';
    else if (Number(summary.refundCount || 0) > 0 && Number(summary.refundCount) === Number(summary.paidCount || 0)) {
        paymentStatus = 'refunded';
    } else if (Number(summary.failedCount || 0) > 0) paymentStatus = 'refund_failed';

    await connection.execute(
        `UPDATE rental_orders
         SET payment_status = ?
         WHERE id = ? AND status IN ('cancelled', 'expired')`,
        [paymentStatus, orderId]
    );

    return paymentStatus;
}

async function refreshReturnCaseStatus(connection, orderId) {
    const [orderRows] = await connection.execute(
        `SELECT status, payment_status
         FROM rental_orders
         WHERE id = ?
         LIMIT 1`,
        [orderId]
    );
    if (orderRows.length === 0) return null;

    const [paymentRows] = await connection.execute(
        `SELECT
            SUM(payment_status IN ('pending', 'open', 'authorized')) AS pendingCount,
            SUM(payment_status IN ('failed', 'cancelled', 'expired')) AS failedCount
         FROM rental_order_payments
         WHERE order_id = ?
         AND payment_type IN ('rental_adjustment', 'return_additional_charge')
         AND payment_status IN (
            'pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'
         )`,
        [orderId]
    );
    const [refundRows] = await connection.execute(
        `SELECT
            SUM(refund.payment_status IN ('pending', 'open', 'authorized')) AS pendingCount,
            SUM(refund.payment_status IN ('failed', 'cancelled', 'expired')) AS failedCount
         FROM rental_order_payments refund
         WHERE refund.order_id = ?
         AND refund.payment_type IN (
            'deposit_refund',
            'order_cancellation_refund',
            'duplicate_payment_refund'
         )
         AND NOT EXISTS (
            SELECT 1
            FROM rental_order_payments newerRefund
            WHERE newerRefund.order_id = refund.order_id
            AND newerRefund.payment_type = refund.payment_type
            AND newerRefund.order_item_id <=> refund.order_item_id
            AND newerRefund.payment_method = refund.payment_method
            AND newerRefund.mollie_payment_id <=> refund.mollie_payment_id
            AND newerRefund.id > refund.id
         )`,
        [orderId]
    );
    const [uncreatedRefundRows] = await connection.execute(
        `SELECT COUNT(*) AS missingCount
         FROM rental_order_items item
         WHERE item.order_id = ?
         AND item.item_status LIKE 'returned_%'
         AND COALESCE(item.deposit_refund_amount, 0) > 0
         AND NOT EXISTS (
            SELECT 1
            FROM rental_order_payments refund
            WHERE refund.order_id = item.order_id
            AND refund.order_item_id = item.id
            AND refund.payment_type = 'deposit_refund'
         )`,
        [orderId]
    );
    const [itemRows] = await connection.execute(
        `SELECT
            SUM(COALESCE(item_status, 'active') = 'picked_up') AS pickedUpCount,
            SUM(COALESCE(item_status, 'active') LIKE 'returned_%') AS returnedCount
         FROM rental_order_items
         WHERE order_id = ?`,
        [orderId]
    );

    const returnCaseStatus = deriveReturnCaseStatus({
        orderStatus: orderRows[0].status,
        orderPaymentStatus: orderRows[0].payment_status,
        pickedUpCount: Number(itemRows[0]?.pickedUpCount || 0),
        returnedCount: Number(itemRows[0]?.returnedCount || 0),
        pendingPaymentCount: Number(paymentRows[0]?.pendingCount || 0),
        failedPaymentCount: Number(paymentRows[0]?.failedCount || 0),
        pendingRefundCount:
            Number(refundRows[0]?.pendingCount || 0) +
            Number(uncreatedRefundRows[0]?.missingCount || 0),
        failedRefundCount: Number(refundRows[0]?.failedCount || 0)
    });

    await connection.execute(
        `UPDATE rental_orders SET return_case_status = ? WHERE id = ?`,
        [returnCaseStatus, orderId]
    );

    return returnCaseStatus;
}

async function cancelOpenMolliePayments(
    connection,
    orderId,
    {
        orderItemId = null,
        reason = 'Offene Mollie-Zahlung beendet'
    } = {}
) {
    const itemScopeSql = orderItemId === null ? '' : ' AND order_item_id = ?';
    const itemScopeParams = orderItemId === null ? [] : [orderItemId];
    const [paymentRows] = await connection.execute(
        `SELECT DISTINCT mollie_payment_id
         FROM rental_order_payments
         WHERE order_id = ?
         ${itemScopeSql}
         AND payment_method = 'online'
         AND payment_status IN ('pending', 'open', 'authorized')
         AND mollie_payment_id IS NOT NULL`,
        [orderId, ...itemScopeParams]
    );

    for (const row of paymentRows) {
        const payment = await getMolliePayment(row.mollie_payment_id);
        const mappedStatus = mapMolliePaymentStatus(payment.status);

        if (mappedStatus === 'pending' || mappedStatus === 'authorized') {
            await cancelMolliePayment(row.mollie_payment_id);
            await connection.execute(
                `UPDATE rental_order_payments
                 SET payment_status = 'cancelled',
                     note = CONCAT(COALESCE(note, ''),
                        CASE WHEN note IS NULL OR note = '' THEN '' ELSE ' | ' END,
                        ?)
                 WHERE mollie_payment_id = ?
                 AND payment_status IN ('pending', 'open', 'authorized')`,
                [reason, row.mollie_payment_id]
            );
        } else {
            await connection.execute(
                `UPDATE rental_order_payments
                 SET payment_status = ?,
                     paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END
                 WHERE mollie_payment_id = ?`,
                [mappedStatus, mappedStatus, row.mollie_payment_id]
            );
        }
    }

    await connection.execute(
        `UPDATE rental_order_payments
         SET payment_status = 'cancelled',
             note = CONCAT(COALESCE(note, ''),
                CASE WHEN note IS NULL OR note = '' THEN '' ELSE ' | ' END,
                ?)
         WHERE order_id = ?
         ${itemScopeSql}
         AND payment_type IN ('rental_adjustment', 'return_additional_charge')
         AND payment_status IN ('pending', 'open', 'authorized', 'failed', 'expired')`,
        [reason, orderId, ...itemScopeParams]
    );
}

async function createOnlineCancellationRefund(connection, {
    order,
    itemId = null,
    paymentId,
    requestedAmount,
    note
}) {
    const [existingForTarget] = await connection.execute(
        `SELECT id
         FROM rental_order_payments
         WHERE order_id = ?
         AND order_item_id <=> ?
         AND payment_type = 'order_cancellation_refund'
         AND mollie_payment_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [order.id, itemId, paymentId]
    );

    if (existingForTarget.length > 0) return null;

    const [sourceRows] = await connection.execute(
        `SELECT COALESCE(SUM(amount), 0) AS paidAmount
         FROM rental_order_payments
         WHERE order_id = ?
         AND mollie_payment_id = ?
         AND payment_status = 'paid'
         AND payment_type IN ('initial_payment', 'rental_adjustment')`,
        [order.id, paymentId]
    );
    const [refundRows] = await connection.execute(
        `SELECT COALESCE(SUM(ABS(amount)), 0) AS refundedAmount
         FROM rental_order_payments
         WHERE order_id = ?
         AND mollie_payment_id = ?
         AND payment_type IN (
            'deposit_refund',
            'order_cancellation_refund',
            'duplicate_payment_refund'
         )
         AND payment_status NOT IN ('failed', 'cancelled')`,
        [order.id, paymentId]
    );

    const remainingAmount = Math.max(
        roundMoney(Number(sourceRows[0]?.paidAmount || 0) - Number(refundRows[0]?.refundedAmount || 0)),
        0
    );
    const refundAmount = Math.min(roundMoney(requestedAmount), remainingAmount);

    if (refundAmount <= 0) return null;

    const targetKey = itemId ? `item-${itemId}` : 'order';
    const refund = await createMollieRefundForPayment({
        paymentId,
        amount: refundAmount,
        description: itemId
            ? `Artikel-Storno ${order.order_no} (#${itemId})`
            : `Storno Rückerstattung Bestellung ${order.order_no}`,
        metadata: {
            orderId: String(order.id),
            itemId: itemId ? String(itemId) : null,
            type: 'order_cancellation_refund'
        },
        idempotencyKey: `cancellation-refund-${order.id}-${targetKey}-${paymentId}`
    });
    const refundStatus = mapMollieRefundStatus(refund.status);

    await connection.execute(
        `INSERT INTO rental_order_payments
         (order_id, order_item_id, payment_type, payment_method, payment_status,
          amount, mollie_payment_id, mollie_refund_id, note, paid_at)
         VALUES (?, ?, 'order_cancellation_refund', 'online', ?, ?, ?, ?, ?,
            CASE WHEN ? = 'paid' THEN NOW() ELSE NULL END)`,
        [
            order.id,
            itemId,
            refundStatus,
            -Math.abs(refundAmount),
            paymentId,
            refund.id,
            note,
            refundStatus
        ]
    );

    return refund;
}

async function createCancellationRefunds(connection, order, item = null) {
    const itemId = item?.id || null;
    let baseRefundAmount = 0;

    if (item) {
        baseRefundAmount = roundMoney(
            calculateRentalDays(item.rental_start, item.rental_end) * Number(item.price_per_day || 0) +
            Number(item.deposit || 0)
        );
    }

    const [paidSources] = await connection.execute(
        item
            ? `SELECT payment_method, mollie_payment_id, payment_type, amount
               FROM rental_order_payments
               WHERE order_id = ?
               AND payment_status = 'paid'
               AND (
                    (payment_type = 'initial_payment' AND order_item_id IS NULL)
                    OR (payment_type = 'rental_adjustment' AND order_item_id = ?)
               )
               ORDER BY id ASC`
            : `SELECT payment_method, mollie_payment_id, payment_type, amount
               FROM rental_order_payments
               WHERE order_id = ?
               AND payment_status = 'paid'
               AND payment_type IN ('initial_payment', 'rental_adjustment')
               ORDER BY id ASC`,
        item ? [order.id, item.id] : [order.id]
    );

    if (paidSources.length === 0) return;

    const cashSources = paidSources.filter(source =>
        String(source.payment_method || '').toLowerCase() === 'cash'
    );
    const cashInitialWasPaid = cashSources.some(source => source.payment_type === 'initial_payment');
    const cashExtensionAmount = cashSources
        .filter(source => source.payment_type === 'rental_adjustment')
        .reduce((sum, source) => sum + Number(source.amount || 0), 0);
    const requestedCashRefund = item
        ? roundMoney((cashInitialWasPaid ? baseRefundAmount : 0) + cashExtensionAmount)
        : roundMoney(cashSources.reduce((sum, source) => sum + Number(source.amount || 0), 0));

    if (requestedCashRefund > 0) {
        const [cashCapacityRows] = await connection.execute(
            `SELECT
                COALESCE((
                    SELECT SUM(amount)
                    FROM rental_order_payments
                    WHERE order_id = ?
                    AND payment_method = 'cash'
                    AND payment_status = 'paid'
                    AND payment_type IN ('initial_payment', 'rental_adjustment')
                ), 0) AS paidAmount,
                COALESCE((
                    SELECT SUM(ABS(amount))
                    FROM rental_order_payments
                    WHERE order_id = ?
                    AND payment_method = 'cash'
                    AND payment_type = 'order_cancellation_refund'
                    AND payment_status NOT IN ('failed', 'cancelled')
                ), 0) AS refundedAmount`,
            [order.id, order.id]
        );
        const remainingCashCapacity = Math.max(
            roundMoney(
                Number(cashCapacityRows[0]?.paidAmount || 0) -
                Number(cashCapacityRows[0]?.refundedAmount || 0)
            ),
            0
        );
        const cashRefundAmount = Math.min(requestedCashRefund, remainingCashCapacity);

        const [existing] = await connection.execute(
            `SELECT id FROM rental_order_payments
             WHERE order_id = ? AND order_item_id <=> ?
             AND payment_type = 'order_cancellation_refund'
             AND payment_method = 'cash'
             AND payment_status NOT IN ('failed', 'cancelled')
             LIMIT 1`,
            [order.id, itemId]
        );

        if (cashRefundAmount > 0 && existing.length === 0) {
            await connection.execute(
                `INSERT INTO rental_order_payments
                 (order_id, order_item_id, payment_type, payment_method, payment_status, amount, note)
                 VALUES (?, ?, 'order_cancellation_refund', 'cash', 'pending', ?, ?)`,
                [
                    order.id,
                    itemId,
                    -Math.abs(cashRefundAmount),
                    item ? 'Barauszahlung wegen Artikel-Storno vorgemerkt' : 'Barauszahlung wegen vollständigem Storno vorgemerkt'
                ]
            );
        }
    }

    for (const source of paidSources) {
        if (
            String(source.payment_method || '').toLowerCase() === 'cash' ||
            !source.mollie_payment_id
        ) {
            continue;
        }

        const requestedAmount = item && source.payment_type === 'initial_payment'
            ? baseRefundAmount
            : Number(source.amount || 0);

        await createOnlineCancellationRefund(connection, {
            order,
            itemId,
            paymentId: source.mollie_payment_id,
            requestedAmount,
            note: item
                ? 'Anteilig erstattet wegen Artikel-Storno vor Abholung'
                : 'Komplette Rückerstattung wegen Stornierung vor Abholung'
        });
    }
}

async function refundDuplicateOnlinePayment(
    connection,
    paymentContext,
    note = 'Onlinezahlung ging nach bereits verbuchter Barzahlung ein und wurde automatisch erstattet'
) {
    const [existingRows] = await connection.execute(
        `SELECT id, payment_status FROM rental_order_payments
         WHERE order_id = ?
         AND order_item_id <=> ?
         AND payment_type = 'duplicate_payment_refund'
         AND mollie_payment_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [paymentContext.order_id, paymentContext.order_item_id, paymentContext.mollie_payment_id]
    );
    if (existingRows.length > 0) return existingRows[0].payment_status;

    const amount = Number(paymentContext.amount || 0);
    if (amount <= 0) return null;

    const refund = await createMollieRefundForPayment({
        paymentId: paymentContext.mollie_payment_id,
        amount,
        description: `Rückerstattung Doppelzahlung ${paymentContext.order_no}`,
        metadata: {
            orderId: String(paymentContext.order_id),
            itemId: paymentContext.order_item_id ? String(paymentContext.order_item_id) : null,
            type: 'duplicate_payment_refund'
        },
        idempotencyKey: `duplicate-payment-refund-${paymentContext.mollie_payment_id}`
    });
    const refundStatus = mapMollieRefundStatus(refund.status);

    await connection.execute(
        `INSERT INTO rental_order_payments
         (order_id, order_item_id, payment_type, payment_method, payment_status,
          amount, mollie_payment_id, mollie_refund_id, note, paid_at)
         VALUES (?, ?, 'duplicate_payment_refund', 'online', ?, ?, ?, ?, ?,
            CASE WHEN ? = 'paid' THEN NOW() ELSE NULL END)`,
        [
            paymentContext.order_id,
            paymentContext.order_item_id,
            refundStatus,
            -Math.abs(amount),
            paymentContext.mollie_payment_id,
            refund.id,
            note,
            refundStatus
        ]
    );

    return refundStatus;
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

        const page = parsePositiveInt(req.query.page, 1, 100000);
        const limit = parsePositiveInt(req.query.limit, 10, 100);
        const offset = (page - 1) * limit;

        const where = [];
        const params = [];

        addOrderListFilters({
            where,
            params,
            query: String(req.query.query || '').trim(),
            year: String(req.query.year || '').trim(),
            month: String(req.query.month || '').trim(),
            status: String(req.query.status || '').trim(),
            returnStatus: String(req.query.returnStatus || '').trim(),
            paymentStatus: String(req.query.paymentStatus || '').trim()
        });

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [countRows] = await connection.execute(
            `SELECT COUNT(*) AS total
             FROM rental_orders ro
             ${whereSql}`,
            params
        );

        const total = Number(countRows[0]?.total || 0);

        // Siehe Kundenlistenabfrage: query() formatiert die bereits validierten
        // Pagination-Zahlen kompatibel zu MySQL 8.4 und escaped die Filterwerte.
        const [orders] = await connection.query(
            `SELECT
                ro.id,
                ro.order_no,
                ro.customer_email,
                ro.customer_first_name,
                ro.customer_last_name,
                ro.customer_company,
                ro.customer_phone,
                ro.customer_address,
                ro.customer_zip,
                ro.customer_city,
                ro.status,
                ro.payment_method,
                ro.payment_status,
                ro.return_status,
                ro.return_case_status,
                DATE_FORMAT(ro.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                DATE_FORMAT(ro.reserved_until, '%Y-%m-%d %H:%i:%s') AS reserved_until,
                DATE_FORMAT(ro.returned_at, '%Y-%m-%d %H:%i:%s') AS returned_at,
                ro.cancel_reason AS cancelReason,
                ro.cancelled_by_name AS cancelledByName,
                DATE_FORMAT(ro.cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelledAt
             FROM rental_orders ro
             ${whereSql}
             ORDER BY ro.id DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const orderIds = orders.map(order => order.id);
        let itemsByOrderId = {};

        if (orderIds.length > 0) {
            const placeholders = orderIds.map(() => '?').join(',');

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
                 WHERE roi.order_id IN (${placeholders})
                 ORDER BY roi.id ASC`,
                orderIds
            );

            itemsByOrderId = items.reduce((map, item) => {
                const orderId = Number(item.orderId);
                if (!map[orderId]) map[orderId] = [];
                map[orderId].push(item);
                return map;
            }, {});
        }

        const [filterRows] = await connection.execute(
            `SELECT
                YEAR(created_at) AS year,
                LPAD(MONTH(created_at), 2, '0') AS month,
                status,
                return_status AS returnStatus,
                payment_status AS paymentStatus
             FROM rental_orders
             ORDER BY created_at DESC`
        );

        res.json({
            items: orders.map(order => ({
                ...order,
                items: itemsByOrderId[Number(order.id)] || []
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(Math.ceil(total / limit), 1)
            },
            filterOptions: {
                years: [...new Set(filterRows.map(row => String(row.year)).filter(Boolean))],
                months: [...new Set(filterRows.map(row => row.month).filter(Boolean))],
                statuses: [...new Set(filterRows.map(row => row.status).filter(Boolean))],
                returnStatuses: [...new Set(filterRows.map(row => row.returnStatus).filter(Boolean))],
                paymentStatuses: [...new Set(filterRows.map(row => row.paymentStatus).filter(Boolean))]
            }
        });
    } catch (error) {
        console.error('Fehler beim Laden der Bestellungen:', error);
        res.status(500).json({ error: 'Bestellungen konnten nicht geladen werden.' });
    } finally {
        if (connection) await connection.end();
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
                DATE_FORMAT(roi.picked_up_at, '%Y-%m-%d %H:%i:%s') AS pickedUpAt,
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
        checkout_url AS checkoutUrl,
        DATE_FORMAT(paid_at, '%Y-%m-%d %H:%i:%s') AS paidAt,
        note,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
        mollie_customer_id AS mollieCustomerId,
        mollie_mandate_id AS mollieMandateId,
        sequence_type AS sequenceType
     FROM rental_order_payments
     WHERE order_id = ?
     ORDER BY created_at DESC, id DESC`,
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
             LIMIT 1
             FOR UPDATE`,
            [req.params.itemId]
        );

        if (items.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Artikel nicht gefunden.' });
        }

        const item = items[0];

        if (String(item.payment_status || '').toLowerCase() !== 'paid') {
            await connection.rollback();
            return res.status(409).json({
                error: 'Der Artikel kann erst abgeholt werden, wenn Miete und Kaution vollständig bezahlt wurden.'
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
             LIMIT 1
             FOR UPDATE`,
            [req.params.id]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
        }

        const order = orders[0];

        if (String(order.payment_status || '').toLowerCase() !== 'paid') {
            await connection.rollback();
            return res.status(409).json({
                error: 'Die Bestellung kann erst abgeholt werden, wenn Miete und Kaution vollständig bezahlt wurden.'
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
        const cancelReason = String(req.body?.reason || '').trim().slice(0, 1000) || null;
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [orders] = await connection.execute(
            `SELECT id, cart_id, status, order_no, customer_email, payment_method, payment_status
             FROM rental_orders
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
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

        await cancelOpenMolliePayments(connection, order.id, {
            reason: 'Offene Nachzahlung wegen vollständiger Stornierung beendet'
        });

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
             AND picked_up_at IS NULL`,
            [
                req.session.user,
                req.params.id
            ]
        );

        await createCancellationRefunds(connection, order);
        await refreshCancelledOrderPaymentStatus(connection, order.id);

        if (order.cart_id) {
            await connection.execute('DELETE FROM rental_carts WHERE id = ?', [order.cart_id]);
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

app.put('/admin/order-items/:itemId/cancel', checkAdmin, adminReturnMutationLimiter, async (req, res) => {
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
    ro.payment_status,
    ro.cart_id,
    roi.picked_up_at,
    p.title,
    ro.order_no,
    ro.customer_email
FROM rental_order_items roi
JOIN rental_orders ro ON ro.id = roi.order_id
JOIN rental_products p ON p.id = roi.product_id
WHERE roi.id = ?
LIMIT 1
FOR UPDATE`,
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

        if (String(item.item_status || 'active') !== 'active') {
            await connection.rollback();
            return res.status(409).json({
                error: 'Nur aktive Artikel können storniert werden.'
            });
        }

        if (
            String(item.payment_method || '').toLowerCase() === 'online' &&
            String(item.payment_status || '').toLowerCase() !== 'paid'
        ) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Eine einzelne Position kann erst nach erfolgreicher Online-Gesamtzahlung storniert werden. Bitte stattdessen die gesamte unbezahlte Bestellung stornieren.'
            });
        }

        const cancelledByUserId = await getUserIdByEmail(connection, req.session.user);

        await cancelOpenMolliePayments(connection, item.order_id, {
            orderItemId: item.id,
            reason: 'Offene Nachzahlung wegen Artikel-Storno beendet'
        });

        const cancelledBaseRentalAmount = roundMoney(
            calculateRentalDays(item.rental_start, item.rental_end) *
            Number(item.price_per_day || 0)
        );
        const cancelledBaseAmount = roundMoney(
            cancelledBaseRentalAmount + Number(item.deposit || 0)
        );

        await connection.execute(
            `UPDATE rental_orders
             SET total_amount = GREATEST(COALESCE(total_amount, 0) - ?, 0)
             WHERE id = ?`,
            [cancelledBaseAmount, item.order_id]
        );

        if (
            String(item.payment_method || '').toLowerCase() === 'cash' &&
            String(item.payment_status || '').toLowerCase() !== 'paid'
        ) {
            await connection.execute(
                `UPDATE rental_order_payments
                 SET amount = GREATEST(amount - ?, 0),
                     note = CONCAT(COALESCE(note, ''),
                        CASE WHEN note IS NULL OR note = '' THEN '' ELSE ' | ' END,
                        'Betrag nach Artikel-Storno angepasst')
                 WHERE order_id = ?
                 AND order_item_id IS NULL
                 AND payment_type = 'rental'
                 AND payment_method = 'cash'
                 AND payment_status IN ('pending', 'open')`,
                [cancelledBaseRentalAmount, item.order_id]
            );
            await connection.execute(
                `UPDATE rental_order_payments
                 SET amount = GREATEST(amount - ?, 0),
                     note = CONCAT(COALESCE(note, ''),
                        CASE WHEN note IS NULL OR note = '' THEN '' ELSE ' | ' END,
                        'Betrag nach Artikel-Storno angepasst')
                 WHERE order_id = ?
                 AND order_item_id IS NULL
                 AND payment_type = 'deposit'
                 AND payment_method = 'cash'
                 AND payment_status IN ('pending', 'open')`,
                [Number(item.deposit || 0), item.order_id]
            );
            await connection.execute(
                `UPDATE rental_order_payments
                 SET payment_status = 'cancelled'
                 WHERE order_id = ?
                 AND order_item_id IS NULL
                 AND payment_type IN ('rental', 'deposit')
                 AND payment_method = 'cash'
                 AND payment_status IN ('pending', 'open')
                 AND amount = 0`,
                [item.order_id]
            );
        }

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
        await createCancellationRefunds(
            connection,
            {
                id: item.order_id,
                order_no: item.order_no,
                payment_method: item.payment_method
            },
            item
        );

        const [itemStateRows] = await connection.execute(
            `SELECT
                SUM(COALESCE(item_status, 'active') = 'active') AS activeCount,
                SUM(COALESCE(item_status, 'active') = 'picked_up') AS pickedUpCount,
                SUM(COALESCE(item_status, 'active') LIKE 'returned_%') AS returnedCount
             FROM rental_order_items
             WHERE order_id = ?`,
            [item.order_id]
        );

        const itemStates = itemStateRows[0] || {};

        if (
            Number(itemStates.activeCount || 0) === 0 &&
            Number(itemStates.pickedUpCount || 0) === 0 &&
            Number(itemStates.returnedCount || 0) === 0
        ) {
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
            await refreshCancelledOrderPaymentStatus(connection, item.order_id);

            if (item.cart_id) {
                await connection.execute('DELETE FROM rental_carts WHERE id = ?', [item.cart_id]);
            }
        } else if (
            Number(itemStates.activeCount || 0) === 0 &&
            Number(itemStates.pickedUpCount || 0) === 0 &&
            Number(itemStates.returnedCount || 0) > 0
        ) {
            const [returnedItems] = await connection.execute(
                `SELECT return_status, return_processed_by_user_id
                 FROM rental_order_items
                 WHERE order_id = ?
                 AND item_status LIKE 'returned_%'`,
                [item.order_id]
            );
            const finalOrderReturnStatus = deriveAggregateReturnStatus(
                returnedItems.map(returnedItem => returnedItem.return_status)
            ) || 'returned_ok';
            const returnProcessedByUserId = returnedItems.find(
                returnedItem => returnedItem.return_processed_by_user_id
            )?.return_processed_by_user_id || null;

            await connection.execute(
                `UPDATE rental_orders
                 SET status = 'returned',
                     return_status = ?,
                     returned_at = COALESCE(returned_at, NOW()),
                     return_processed_by_user_id = COALESCE(
                        return_processed_by_user_id,
                        ?
                     )
                 WHERE id = ?`,
                [
                    finalOrderReturnStatus,
                    returnProcessedByUserId,
                    item.order_id
                ]
            );
            await refreshReturnCaseStatus(connection, item.order_id);
        } else if (Number(itemStates.pickedUpCount || 0) > 0) {
            await connection.execute(
                `UPDATE rental_orders
                 SET status = 'picked_up', return_case_status = 'partial'
                 WHERE id = ?`,
                [item.order_id]
            );
        } else if (Number(itemStates.returnedCount || 0) > 0) {
            await connection.execute(
                `UPDATE rental_orders
                 SET return_case_status = 'partial'
                 WHERE id = ?`,
                [item.order_id]
            );
        } else {
            await connection.execute(
                `UPDATE rental_orders
                 SET return_case_status = NULL
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

async function removeUploadedFiles(files = []) {
    await Promise.allSettled(
        files
            .map(file => file?.path)
            .filter(Boolean)
            .map(filePath => fsp.unlink(filePath))
    );
}

app.post('/admin/order-items/:itemId/return-images', checkAdmin, uploadReturnImages.array('images', 10), async (req, res) => {
    let connection;
    let committed = false;
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    try {
        if (uploadedFiles.length === 0) {
            return res.status(400).json({ error: 'Es wurden keine Rückgabefotos übermittelt.' });
        }

        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [items] = await connection.execute(
            `SELECT id, order_id, item_status
             FROM rental_order_items
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [req.params.itemId]
        );

        if (items.length === 0) {
            await connection.rollback();
            await removeUploadedFiles(uploadedFiles);
            return res.status(404).json({ error: 'Bestellposition nicht gefunden.' });
        }

        const item = items[0];

        if (
            item.item_status !== 'picked_up' &&
            !String(item.item_status || '').startsWith('returned_')
        ) {
            await connection.rollback();
            await removeUploadedFiles(uploadedFiles);
            return res.status(409).json({
                error: 'Rückgabefotos sind erst nach der Abholung zulässig.'
            });
        }

        const uploadedByUserId = await getUserIdByEmail(connection, req.session.user);

        for (const file of uploadedFiles) {
            const imagePath = `img/returns/${file.filename}`;

            await connection.execute(
                `INSERT INTO rental_order_return_images
                 (order_id, order_item_id, image_path, uploaded_by_user_id)
                 VALUES (?, ?, ?, ?)`,
                [item.order_id, item.id, imagePath, uploadedByUserId]
            );
        }

        await connection.commit();
        committed = true;

        res.json({ message: 'Rückgabefotos für den Artikel wurden hochgeladen.' });

    } catch (error) {
        if (connection && !committed) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback der Rückgabefotos fehlgeschlagen:', rollbackError);
            }
        }

        if (!committed) await removeUploadedFiles(uploadedFiles);
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
                DATE_FORMAT(roi.adjusted_rental_start, '%Y-%m-%d') AS adjustedRentalStart,
                DATE_FORMAT(roi.adjusted_rental_end, '%Y-%m-%d') AS adjustedRentalEnd,
                DATE_FORMAT(roi.actual_return_date, '%Y-%m-%d') AS actualReturnDate,
                roi.adjusted_price_per_day AS adjustedPricePerDay,
                roi.price_per_day AS pricePerDay,
                roi.return_status AS returnStatus,
                roi.is_damaged AS isDamaged,
                roi.is_late AS isLate,
                roi.damage_description AS damageDescription,
                roi.late_description AS lateDescription,
                roi.deposit,
                roi.deposit_decision AS depositDecision,
                roi.deposit_refund_amount AS depositRefundAmount,
                roi.deposit_deduction_amount AS depositDeductionAmount,
                roi.deposit_deduction_reason AS depositDeductionReason,
                roi.additional_charge_reason AS additionalChargeReason,
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
             AND payment_type IN (
                'rental_adjustment', 'deposit_refund', 'return_additional_charge'
             )
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
            adjustedPricePerDay
        } = req.body;

        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [itemReferences] = await connection.execute(
            `SELECT order_id, product_id
             FROM rental_order_items
             WHERE id = ?
             LIMIT 1`,
            [req.params.itemId]
        );

        if (itemReferences.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Bestellposition nicht gefunden.' });
        }

        await connection.execute(
            `SELECT id
             FROM rental_orders
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [itemReferences[0].order_id]
        );
        await lockRentalProducts(connection, [itemReferences[0].product_id]);

        const [items] = await connection.execute(
            `SELECT 
    roi.id,
    roi.order_id,
    roi.product_id,
    roi.price_per_day,
    DATE_FORMAT(roi.rental_start, '%Y-%m-%d') AS rental_start,
    DATE_FORMAT(roi.rental_end, '%Y-%m-%d') AS rental_end,
    DATE_FORMAT(roi.adjusted_rental_start, '%Y-%m-%d') AS adjusted_rental_start,
    DATE_FORMAT(roi.adjusted_rental_end, '%Y-%m-%d') AS adjusted_rental_end,
    roi.adjusted_price_per_day,
    roi.adjusted_rental_total,
    roi.item_status,
    p.title,
    ro.order_no,
ro.customer_email,
ro.payment_method,
ro.payment_status,
ro.mollie_customer_id,
ro.mollie_mandate_id
FROM rental_order_items roi
JOIN rental_orders ro ON ro.id = roi.order_id
JOIN rental_products p ON p.id = roi.product_id
WHERE roi.id = ?
LIMIT 1
FOR UPDATE`,
            [req.params.itemId]
        );

        if (items.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Bestellposition nicht gefunden.' });
        }

        const item = items[0];
        if (!['active', 'picked_up'].includes(String(item.item_status || 'active'))) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Nur aktive Artikel können geändert werden.'
            });
        }

        if (String(item.payment_status || '').toLowerCase() !== 'paid') {
            await connection.rollback();
            return res.status(409).json({
                error: 'Eine Mietverlängerung ist erst nach vollständiger Bezahlung der ursprünglichen Miete möglich.'
            });
        }

        const currentStart = item.adjusted_rental_start || item.rental_start;
        const currentEnd = item.adjusted_rental_end || item.rental_end;

        const finalStart = adjustedRentalStart || currentStart;
        const finalEnd = adjustedRentalEnd || currentEnd;
        const currentPricePerDay = Number(
            item.adjusted_price_per_day || item.price_per_day || 0
        );
        const submittedPricePerDay = adjustedPricePerDay === null || adjustedPricePerDay === undefined || adjustedPricePerDay === ''
            ? currentPricePerDay
            : Number(adjustedPricePerDay);
        const finalPricePerDay = currentPricePerDay;

        if (!isStrictIsoDate(String(finalStart).slice(0, 10)) || !isStrictIsoDate(String(finalEnd).slice(0, 10))) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Der angepasste Mietzeitraum enthält ein ungültiges Datum.'
            });
        }

        if (!Number.isFinite(finalPricePerDay) || finalPricePerDay <= 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Der Tagespreis muss größer als 0 sein.' });
        }

        if (String(finalStart).slice(0, 10) !== String(currentStart).slice(0, 10)) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Der Mietbeginn darf bei einer Verlängerung nicht verändert werden.'
            });
        }

        if (
            !Number.isFinite(submittedPricePerDay) ||
            Math.abs(submittedPricePerDay - currentPricePerDay) > 0.001
        ) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Der vereinbarte Tagespreis darf bei einer Verlängerung nicht verändert werden.'
            });
        }

        if (String(finalEnd).slice(0, 10) < String(finalStart).slice(0, 10)) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Das angepasste Mietende darf nicht vor dem angepassten Mietbeginn liegen.'
            });
        }

        if (String(finalEnd).slice(0, 10) <= String(currentEnd).slice(0, 10)) {
            await connection.rollback();
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
            req.params.itemId,
            true
        );

        if (!available) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Das Produkt ist im gewählten Zeitraum nicht verfügbar.'
            });
        }

        const extensionStartDate = new Date(currentEnd);
        extensionStartDate.setUTCDate(extensionStartDate.getUTCDate() + 1);

        const extensionStart = extensionStartDate.toISOString().slice(0, 10);

        const extensionDays = calculateRentalDays(extensionStart, finalEnd);

        const amountDue = roundMoney(Math.max(extensionDays * finalPricePerDay, 0));
        if (amountDue > 0) {
            const [existingOpenRentalAdjustments] = await connection.execute(
                `SELECT id
         FROM rental_order_payments
         WHERE order_id = ?
         AND order_item_id = ?
         AND payment_type = 'rental_adjustment'
         AND payment_status IN (
            'pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'
         )
         LIMIT 1`,
                [item.order_id, req.params.itemId]
            );

            if (existingOpenRentalAdjustments.length > 0) {
                await connection.rollback();
                return res.status(409).json({
                    error: 'Es existiert bereits eine offene Mietzeitraum-Nachzahlung für diesen Artikel. Bitte diese zuerst begleichen oder stornieren.'
                });
            }
        }

        await connection.execute(
            `UPDATE rental_order_items
             SET adjusted_rental_start = ?,
                 adjusted_rental_end = ?,
                 adjusted_price_per_day = ?,
                 adjusted_rental_total = ?
             WHERE id = ?`,
            [
                String(finalStart).slice(0, 10),
                String(finalEnd).slice(0, 10),
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
                idempotencyKey: `rental-adjustment-${item.order_id}-${req.params.itemId}-${String(finalEnd).slice(0, 10)}-${amountDue.toFixed(2)}`,
                redirectUrl: `${baseUrl}/index.html?payment=extension&orderId=${encodeURIComponent(item.order_id)}&paymentType=rental_adjustment&itemId=${encodeURIComponent(req.params.itemId)}`
            });

            paymentUrl = getMollieCheckoutUrl(payment);

            if (!paymentUrl) {
                throw new Error('Mollie Checkout-URL für die Verlängerung fehlt.');
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
            mollie_payment_id,
            checkout_url
         )
         VALUES (?, ?, 'rental_adjustment', 'online', 'pending', ?, ?, ?)`,
                [
                    item.order_id,
                    req.params.itemId,
                    amountDue,
                    payment.id,
                    paymentUrl
                ]
            );
        }

        await connection.commit();

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
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback der Mietverlängerung fehlgeschlagen:', rollbackError);
            }
        }
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

app.put('/admin/order-items/:itemId/return', checkAdmin, adminReturnMutationLimiter, async (req, res) => {
    let connection;

    try {
        const {
            actualReturnDate,
            additionalChargePaymentMethod,
            adjustedRentalStart,
            adjustedRentalEnd,
            adjustedPricePerDay,
            isDamaged,
            damageDescription,
            lateDescription,
            depositDeductionReason,
            additionalChargeReason,
            additionalChargeAmount,
            returnNotes
        } = req.body;

        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const processedByUserId = await getUserIdByEmail(connection, req.session.user);

        const [items] = await connection.execute(
            `SELECT 
    roi.id,
    roi.order_id,
    roi.price_per_day,
    DATE_FORMAT(roi.rental_start, '%Y-%m-%d') AS rental_start,
    DATE_FORMAT(roi.rental_end, '%Y-%m-%d') AS rental_end,
    DATE_FORMAT(roi.adjusted_rental_start, '%Y-%m-%d') AS current_adjusted_rental_start,
    DATE_FORMAT(roi.adjusted_rental_end, '%Y-%m-%d') AS current_adjusted_rental_end,
    roi.adjusted_price_per_day AS current_adjusted_price_per_day,
    DATE_FORMAT(roi.picked_up_at, '%Y-%m-%d') AS picked_up_date,
    roi.deposit,
    roi.item_status,
    p.title,
ro.order_no,
ro.customer_email,
ro.payment_method,
ro.payment_status AS order_payment_status,
ro.mollie_payment_id,
ro.mollie_customer_id,
ro.mollie_mandate_id
FROM rental_order_items roi
JOIN rental_orders ro ON ro.id = roi.order_id
JOIN rental_products p ON p.id = roi.product_id
WHERE roi.id = ?
LIMIT 1
FOR UPDATE`,
            [req.params.itemId]
        );

        if (items.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Bestellposition nicht gefunden.' });
        }

        const item = items[0];

        if (item.item_status !== 'picked_up') {
            await connection.rollback();
            return res.status(409).json({
                error: 'Nur abgeholte Artikel können zurückgegeben werden.'
            });
        }

        const agreedStart = item.current_adjusted_rental_start || item.rental_start;
        const agreedEnd = item.current_adjusted_rental_end || item.rental_end;
        const agreedPricePerDay = Number(
            item.current_adjusted_price_per_day || item.price_per_day || 0
        );
        const submittedStart = adjustedRentalStart || agreedStart;
        const submittedEnd = adjustedRentalEnd || agreedEnd;
        const submittedPricePerDay = adjustedPricePerDay === null || adjustedPricePerDay === undefined || adjustedPricePerDay === ''
            ? agreedPricePerDay
            : Number(adjustedPricePerDay);
        const finalStart = agreedStart;
        const finalEnd = agreedEnd;
        const finalPricePerDay = agreedPricePerDay;

        if (
            !isStrictIsoDate(actualReturnDate) ||
            !isStrictIsoDate(String(finalStart).slice(0, 10)) ||
            !isStrictIsoDate(String(finalEnd).slice(0, 10))
        ) {
            await connection.rollback();
            return res.status(400).json({ error: 'Die Rückgabe enthält ein ungültiges Datum.' });
        }

        if (actualReturnDate < String(item.picked_up_date || finalStart).slice(0, 10)) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Das Rückgabedatum darf nicht vor der Abholung liegen.'
            });
        }

        if (String(finalEnd).slice(0, 10) < String(finalStart).slice(0, 10)) {
            await connection.rollback();
            return res.status(400).json({ error: 'Das Mietende darf nicht vor dem Mietbeginn liegen.' });
        }

        if (!Number.isFinite(finalPricePerDay) || finalPricePerDay <= 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Der Tagespreis muss größer als 0 sein.' });
        }

        if (
            String(submittedStart).slice(0, 10) !== String(agreedStart).slice(0, 10) ||
            String(submittedEnd).slice(0, 10) !== String(agreedEnd).slice(0, 10) ||
            !Number.isFinite(submittedPricePerDay) ||
            Math.abs(submittedPricePerDay - agreedPricePerDay) > 0.001
        ) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Der vereinbarte Mietzeitraum und Tagespreis können bei der Rückgabe nicht verändert werden.'
            });
        }

        const days = calculateRentalDays(finalStart, finalEnd);
        const adjustedRentalTotal = days * finalPricePerDay;
        const deposit = Number(item.deposit || 0);
        const plannedReturnDate = agreedEnd;
        const lateDays = calculateLateDays(actualReturnDate, plannedReturnDate);
        const lateFee = roundMoney(lateDays * finalPricePerDay);
        const normalizedIsDamaged = isDamaged === true || Number(isDamaged) === 1;
        const normalizedIsLate = lateDays > 0;

        const normalizedAdditionalChargeAmount =
            additionalChargeAmount === null || additionalChargeAmount === undefined || additionalChargeAmount === ''
                ? 0
                : Number(additionalChargeAmount);

        if (!Number.isFinite(normalizedAdditionalChargeAmount) || normalizedAdditionalChargeAmount < 0) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Zusätzlicher Betrag ist ungültig.'
            });
        }

        const normalizedDamageDescription = String(damageDescription || '').trim();
        const normalizedAdditionalChargeReason = String(additionalChargeReason || '').trim();
        const normalizedAdditionalChargePaymentMethod = String(
            additionalChargePaymentMethod || 'online'
        ).trim().toLowerCase();

        if (normalizedIsDamaged && !normalizedDamageDescription) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Für einen beschädigten Artikel ist eine Schadensbeschreibung erforderlich.'
            });
        }

        if (normalizedAdditionalChargeAmount > 0 && !normalizedAdditionalChargeReason) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Für eine Zusatzforderung ist eine Begründung erforderlich.'
            });
        }

        if (!['cash', 'online'].includes(normalizedAdditionalChargePaymentMethod)) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Die Zahlungsart der Zusatzforderung ist ungültig.'
            });
        }

        const finalReturnStatus =
            normalizedIsDamaged && normalizedIsLate
                ? 'returned_late_damaged'
                : normalizedIsDamaged
                    ? 'returned_damaged'
                    : normalizedIsLate
                        ? 'returned_late'
                        : 'returned_ok';

        const [openAdjustmentRows] = await connection.execute(
            `SELECT id, payment_method, mollie_payment_id, amount
             FROM rental_order_payments
             WHERE order_id = ?
             AND order_item_id = ?
             AND payment_type = 'rental_adjustment'
             AND payment_status IN (
                'pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'
             )`,
            [item.order_id, req.params.itemId]
        );

        let openRentalAdjustmentAmount = 0;

        for (const adjustment of openAdjustmentRows) {
            if (adjustment.payment_method !== 'online' || !adjustment.mollie_payment_id) {
                openRentalAdjustmentAmount += Number(adjustment.amount || 0);
                continue;
            }

            const molliePayment = await getMolliePayment(adjustment.mollie_payment_id);
            const mollieStatus = mapMolliePaymentStatus(molliePayment.status);

            if (isOpenPaymentStatus(mollieStatus)) {
                await cancelMolliePayment(adjustment.mollie_payment_id);
                openRentalAdjustmentAmount += Number(adjustment.amount || 0);
            } else if (mollieStatus !== 'paid') {
                openRentalAdjustmentAmount += Number(adjustment.amount || 0);
            } else {
                await connection.execute(
                    `UPDATE rental_order_payments
                     SET payment_status = ?,
                         paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END
                     WHERE mollie_payment_id = ? AND mollie_refund_id IS NULL`,
                    [mollieStatus, mollieStatus, adjustment.mollie_payment_id]
                );
            }
        }

        openRentalAdjustmentAmount = roundMoney(openRentalAdjustmentAmount);

        if (openRentalAdjustmentAmount > 0) {
            await connection.execute(
                `UPDATE rental_order_payments
         SET payment_status = 'offset',
             note = CONCAT(
                 COALESCE(note, ''),
                 CASE WHEN note IS NULL OR note = '' THEN '' ELSE ' | ' END,
                 'Offene Mietzeitraum-Nachzahlung wurde bei Rückgabe mit Kaution verrechnet'
             )
         WHERE order_id = ?
         AND order_item_id = ?
         AND payment_type = 'rental_adjustment'
         AND payment_status IN (
            'pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'
         )`,
                [item.order_id, req.params.itemId]
            );
        }

        const settlement = calculateReturnSettlement({
            deposit,
            additionalChargeAmount: normalizedAdditionalChargeAmount,
            openRentalAdjustmentAmount,
            lateFee
        });
        const calculatedDepositRefundAmount = settlement.depositRefundAmount;
        const depositDeductionAmount = settlement.depositDeductionAmount;
        const deductionPercent = settlement.depositDeductionPercent;
        const finalDepositDecision = settlement.depositDecision;
        const customerAdditionalDue = settlement.customerAdditionalDue;
        const settlementReasons = [
            String(depositDeductionReason || '').trim(),
            normalizedAdditionalChargeAmount > 0 ? normalizedAdditionalChargeReason : '',
            openRentalAdjustmentAmount > 0 ? `Offene Mietverlängerung: ${openRentalAdjustmentAmount.toFixed(2)} €` : '',
            lateFee > 0 ? `Verspätung (${lateDays} Tag${lateDays === 1 ? '' : 'e'}): ${lateFee.toFixed(2)} €` : ''
        ].filter(Boolean);

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
                String(finalStart).slice(0, 10),
                String(finalEnd).slice(0, 10),
                finalPricePerDay,
                adjustedRentalTotal,
                finalReturnStatus,
                finalReturnStatus,
                normalizedIsDamaged ? 1 : 0,
                normalizedIsDamaged ? normalizedDamageDescription : null,
                normalizedIsLate ? 1 : 0,
                normalizedIsLate ? String(lateDescription || '').trim() || `${lateDays} Tag${lateDays === 1 ? '' : 'e'} verspätet` : null,
                finalDepositDecision,
                deductionPercent,
                depositDeductionAmount,
                calculatedDepositRefundAmount,
                settlementReasons.join(' | ') || null,
                normalizedAdditionalChargeReason || null,
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

            const finalOrderReturnStatus = deriveAggregateReturnStatus(
                returnStatusRows.map(row => row.returnStatus)
            ) || 'returned_ok';

            await connection.execute(
                `UPDATE rental_orders
         SET status = 'returned',
             return_status = ?,
             returned_at = NOW(),
             return_processed_by_user_id = COALESCE(return_processed_by_user_id, ?)
         WHERE id = ?`,
                [
                    finalOrderReturnStatus,
                    processedByUserId,
                    item.order_id
                ]
            );
        } else {
            await connection.execute(
                `UPDATE rental_orders
         SET return_case_status = 'partial',
             return_processed_by_user_id = COALESCE(return_processed_by_user_id, ?)
         WHERE id = ?`,
                [processedByUserId, item.order_id]
            );
        }

        const initialPaymentMethod = item.payment_method || null;

        const [openBlockingPayments] = await connection.execute(
            `SELECT id
     FROM rental_order_payments
     WHERE order_id = ?
     AND order_item_id = ?
     AND payment_type IN ('rental_adjustment', 'return_additional_charge')
     AND payment_status IN (
        'pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'
     )
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
         ORDER BY (mollie_payment_id = ?) DESC,
                  CASE WHEN payment_type = 'initial_payment' THEN 0 ELSE 1 END,
                  id ASC
         LIMIT 1`,
                    [item.order_id, item.mollie_payment_id]
                );

                const originalPaymentId = payments[0]?.mollie_payment_id || (
                    item.order_payment_status === 'paid'
                        ? item.mollie_payment_id
                        : null
                );

                if (!originalPaymentId) {
                    throw new Error(
                        'Für die Kautionsrückerstattung fehlt eine bezahlte Mollie-Ausgangszahlung.'
                    );
                }

                try {
                    const refund = await createMollieRefundForPayment({
                        paymentId: originalPaymentId,
                        amount: calculatedDepositRefundAmount,
                        description: `Kautionsrückerstattung ${item.order_no} - ${item.title} (#${req.params.itemId})`,
                        metadata: {
                            orderId: String(item.order_id),
                            itemId: String(req.params.itemId),
                            type: 'deposit_refund'
                        },
                        idempotencyKey: `deposit-refund-${item.order_id}-${req.params.itemId}`
                    });
                    const refundStatus = mapMollieRefundStatus(refund.status);

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
                 VALUES (?, ?, 'deposit_refund', 'online', ?, ?, ?, ?, ?,
                    CASE WHEN ? = 'paid' THEN NOW() ELSE NULL END)`,
                        [
                            item.order_id,
                            req.params.itemId,
                            refundStatus,
                            -Math.abs(calculatedDepositRefundAmount),
                            originalPaymentId,
                            refund.id,
                            refundStatus === 'paid'
                                ? 'Kaution automatisch per Mollie erstattet'
                                : 'Kautionsrückerstattung bei Mollie beauftragt',
                            refundStatus
                        ]
                    );
                } catch (refundError) {
                    console.error('Mollie-Refund fehlgeschlagen:', refundError);
                    throw refundError;
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
            } else {
                throw new Error(
                    'Für die Kautionsrückerstattung fehlt eine gültige ursprüngliche Zahlungsart.'
                );
            }
        }

        const [existingOpenReturnCharges] = await connection.execute(
            `SELECT id
     FROM rental_order_payments
     WHERE order_id = ?
     AND order_item_id = ?
     AND payment_type = 'return_additional_charge'
     AND payment_status IN ('pending', 'open', 'authorized')
     LIMIT 1`,
            [item.order_id, req.params.itemId]
        );
        let returnChargeEmail = null;

        if (
            customerAdditionalDue > 0 &&
            existingOpenReturnCharges.length === 0 &&
            normalizedAdditionalChargePaymentMethod === 'cash'
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
            const payment = await createMolliePaymentForOrder({
                id: item.order_id,
                orderNo: item.order_no,
                totalAmount: customerAdditionalDue,
                description: `Nachzahlung Rückgabe ${item.order_no} - ${item.title} (#${req.params.itemId})`,
                type: 'return_additional_charge',
                redirectUrl: `${process.env.BASE_URL.replace(/\/$/, '')}/index.html?payment=return_charge&orderId=${encodeURIComponent(item.order_id)}&paymentType=return_additional_charge&itemId=${encodeURIComponent(req.params.itemId)}`,
                itemId: req.params.itemId,
                idempotencyKey: `return-charge-${item.order_id}-${req.params.itemId}-${customerAdditionalDue.toFixed(2)}`
            });

            const checkoutUrl = getMollieCheckoutUrl(payment);

            if (!checkoutUrl) {
                throw new Error('Mollie Checkout-URL für die Rückgabe-Nachzahlung fehlt.');
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
                mollie_payment_id,
                checkout_url
             )
             VALUES (?, ?, 'return_additional_charge', 'online', 'pending', ?, ?, ?)`,
                    [
                        item.order_id,
                        req.params.itemId,
                        customerAdditionalDue,
                        payment.id,
                        checkoutUrl
                ]
            );

            returnChargeEmail = { checkoutUrl };
        }

        await refreshReturnCaseStatus(connection, item.order_id);
        await connection.commit();

        if (returnChargeEmail) {
            try {
                await sendReturnAdditionalChargeEmail(
                    {
                        order_no: item.order_no,
                        customer_email: item.customer_email
                    },
                    item,
                    returnChargeEmail.checkoutUrl,
                    customerAdditionalDue,
                    normalizedAdditionalChargeReason
                );
            } catch (mailError) {
                console.error('Rückgabe gespeichert, aber Nachzahlungs-Mail fehlgeschlagen:', mailError);
            }
        }

        res.json({
            message: 'Rückgabe der Bestellposition wurde gespeichert.',
            adjustedRentalTotal
        });

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback der Positionsrückgabe fehlgeschlagen:', rollbackError);
            }
        }
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
        await connection.beginTransaction();

        const [orders] = await connection.execute(
            `SELECT
                ro.id,
                ro.order_no AS orderNo,
                ro.total_amount AS totalAmount,
                ro.status,
                ro.payment_method AS paymentMethod,
                ro.payment_status AS paymentStatus,
                ro.cart_id AS cartId,
                ro.customer_email AS customerEmail,
                rc.session_id AS cartSessionId,
                rc.user_email AS cartUserEmail
             FROM rental_orders ro
             LEFT JOIN rental_carts rc ON rc.id = ro.cart_id
             WHERE ro.id = ?
             LIMIT 1
             FOR UPDATE`,
            [req.params.id]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: 'Bestellung nicht gefunden.'
            });
        }

        const order = orders[0];

        const isAdmin = req.session.role === 'global_admin';
        const isCustomer = req.session.user &&
            String(req.session.user).toLowerCase() === String(order.customerEmail || '').toLowerCase();
        const isGuestOwner = !req.session.user && req.session.cartKey &&
            req.session.cartKey === order.cartSessionId && !order.cartUserEmail;

        if (!isAdmin && !isCustomer && !isGuestOwner) {
            await connection.rollback();
            return res.status(403).json({ error: 'Kein Zugriff auf diese Bestellung.' });
        }

        if (order.paymentMethod !== 'online') {
            await connection.rollback();
            return res.status(409).json({
                error: 'Für eine Barzahlungs-Bestellung kann kein Online-Checkout erzeugt werden.'
            });
        }

        if (!['reserved', 'pending_payment', 'payment_failed', 'expired'].includes(order.status) || order.paymentStatus === 'paid') {
            await connection.rollback();
            return res.status(400).json({
                error: 'Für diese Bestellung kann kein Checkout mehr erstellt werden.'
            });
        }

        const [items] = await connection.execute(
            `SELECT id, product_id,
                    DATE_FORMAT(rental_start, '%Y-%m-%d') AS rentalStart,
                    DATE_FORMAT(rental_end, '%Y-%m-%d') AS rentalEnd,
                    price_per_day AS pricePerDay,
                    deposit
             FROM rental_order_items
             WHERE order_id = ?
             AND COALESCE(item_status, 'active') IN ('active', 'expired')`,
            [order.id]
        );

        if (items.length === 0) {
            await connection.rollback();
            return res.status(409).json({ error: 'Die Bestellung enthält keine aktive Mietposition.' });
        }

        await lockRentalProducts(
            connection,
            items.map(item => item.product_id)
        );

        await cancelOpenMolliePayments(connection, order.id, {
            reason: 'Offene Zahlung wegen neuem Checkout beendet'
        });

        const [paidInitialPayments] = await connection.execute(
            `SELECT initialPayment.mollie_payment_id
             FROM rental_order_payments initialPayment
             WHERE initialPayment.order_id = ?
             AND initialPayment.payment_type = 'initial_payment'
             AND initialPayment.payment_status = 'paid'
             AND initialPayment.amount > (
                SELECT COALESCE(SUM(ABS(refund.amount)), 0)
                FROM rental_order_payments refund
                WHERE refund.order_id = initialPayment.order_id
                AND refund.mollie_payment_id = initialPayment.mollie_payment_id
                AND refund.payment_type IN (
                    'deposit_refund',
                    'order_cancellation_refund',
                    'duplicate_payment_refund'
                )
                AND refund.payment_status NOT IN ('failed', 'cancelled')
             )
             ORDER BY initialPayment.id DESC
             LIMIT 1`,
            [order.id]
        );

        let allItemsAvailable = true;

        for (const item of items) {
            const available = await checkProductAvailability(
                connection,
                item.product_id,
                item.rentalStart,
                item.rentalEnd,
                item.id,
                true
            );
            if (!available) {
                allItemsAvailable = false;
                break;
            }
        }

        if (!allItemsAvailable && paidInitialPayments.length === 0) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Mindestens ein Produkt ist inzwischen nicht mehr verfügbar.'
            });
        }

        if (!allItemsAvailable && paidInitialPayments.length > 0) {
            await connection.execute(
                `UPDATE rental_orders
                 SET status = 'expired', return_status = 'not_required',
                     return_case_status = 'closed'
                 WHERE id = ?`,
                [order.id]
            );
            await connection.execute(
                `UPDATE rental_order_items
                 SET item_status = 'expired', return_status = 'not_required'
                 WHERE order_id = ?
                 AND COALESCE(item_status, 'active') IN ('active', 'expired')`,
                [order.id]
            );
            await createCancellationRefunds(connection, {
                id: order.id,
                order_no: order.orderNo,
                payment_method: 'online'
            });
            await refreshCancelledOrderPaymentStatus(connection, order.id);
            await connection.commit();

            return res.status(409).json({
                error: 'Die Zahlung ist eingegangen, aber die Mietartikel sind nicht mehr verfügbar. Die automatische Rückerstattung wurde gestartet.'
            });
        }

        if (paidInitialPayments.length > 0) {
            await connection.execute(
                `UPDATE rental_orders
                 SET status = 'confirmed', payment_status = 'paid',
                     mollie_payment_id = ?, paid_at = COALESCE(paid_at, NOW())
                 WHERE id = ?`,
                [paidInitialPayments[0].mollie_payment_id, order.id]
            );
            await connection.execute(
                `UPDATE rental_order_items
                 SET item_status = 'active', return_status = NULL
                 WHERE order_id = ?
                 AND COALESCE(item_status, 'active') = 'expired'`,
                [order.id]
            );
            if (order.cartId) {
                await connection.execute('DELETE FROM rental_carts WHERE id = ?', [order.cartId]);
            }
            await connection.commit();
            return res.json({
                success: true,
                alreadyPaid: true,
                message: 'Die ursprüngliche Online-Zahlung ist bereits eingegangen.'
            });
        }

        const [checkoutAttemptRows] = await connection.execute(
            `SELECT COUNT(DISTINCT mollie_payment_id) AS attemptCount
             FROM rental_order_payments
             WHERE order_id = ?
             AND payment_type = 'initial_payment'
             AND mollie_payment_id IS NOT NULL`,
            [order.id]
        );
        const checkoutAttempt = Number(checkoutAttemptRows[0]?.attemptCount || 0) + 1;

        const payment = await createMolliePaymentForOrder({
            ...order,
            idempotencyKey: `checkout-retry-${order.id}-${checkoutAttempt}`
        });

        const checkoutUrl = getMollieCheckoutUrl(payment);

        if (!checkoutUrl) {
            throw new Error('Mollie Checkout-URL fehlt.');
        }

        const rentalTotal = roundMoney(items.reduce((sum, item) => {
            return sum + calculateRentalDays(item.rentalStart, item.rentalEnd) * Number(item.pricePerDay || 0);
        }, 0));
        const depositTotal = roundMoney(items.reduce((sum, item) => sum + Number(item.deposit || 0), 0));

        await connection.execute(
            `INSERT INTO rental_order_payments
             (order_id, order_item_id, payment_type, payment_method, payment_status, amount, mollie_payment_id, note)
             VALUES
                (?, NULL, 'initial_payment', 'online', 'pending', ?, ?, 'Erneuter Online-Checkout: Gesamtzahlung'),
                (?, NULL, 'rental', 'online', 'pending', ?, ?, 'Erneuter Online-Checkout: Mietanteil'),
                (?, NULL, 'deposit', 'online', 'pending', ?, ?, 'Erneuter Online-Checkout: Kautionsanteil')`,
            [
                order.id, Number(order.totalAmount), payment.id,
                order.id, rentalTotal, payment.id,
                order.id, depositTotal, payment.id
            ]
        );

        await connection.execute(
            `UPDATE rental_orders
 SET mollie_payment_id = ?,
     mollie_checkout_url = ?,
     mollie_payment_status = ?,
     payment_method = 'online',
     payment_status = 'pending',
     status = 'reserved',
     reserved_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE)
 WHERE id = ?`,
            [
                payment.id,
                checkoutUrl,
                payment.status || 'open',
                order.id
            ]
        );

        await connection.execute(
            `UPDATE rental_order_items
             SET item_status = 'active',
                 return_status = NULL
             WHERE order_id = ?
             AND COALESCE(item_status, 'active') = 'expired'`,
            [order.id]
        );

        await connection.commit();

        return res.json({
            success: true,
            checkoutUrl
        });

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback des Mollie-Checkouts fehlgeschlagen:', rollbackError);
            }
        }
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
    const additionalPaymentTypes = ['rental_adjustment', 'return_additional_charge'];

    if (paymentType && !additionalPaymentTypes.includes(paymentType)) {
        return res.status(400).json({ error: 'Ungültige Zahlungsart.' });
    }

    if (paymentType && (!itemId || !Number.isInteger(Number(itemId)) || Number(itemId) < 1)) {
        return res.status(400).json({ error: 'Für diese Zahlung ist eine gültige Bestellposition erforderlich.' });
    }

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [orders] = await connection.execute(
            `SELECT id, cart_id, order_no AS orderNo, order_no, status, payment_method,
                    payment_status, mollie_payment_id, mollie_payment_status
             FROM rental_orders
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [req.params.id]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
        }

        if (paymentType) {
            const [paymentRows] = await connection.execute(
                `SELECT
            rop.id AS paymentRecordId,
            rop.order_id,
            rop.order_item_id,
            rop.amount,
            rop.mollie_payment_id,
            rop.payment_status,
            rop.payment_type,
            rop.note,
            ro.order_no AS orderNo
         FROM rental_order_payments rop
         JOIN rental_orders ro ON ro.id = rop.order_id
        WHERE rop.order_id = ?
        AND rop.payment_type = ?
        AND rop.payment_method = 'online'
        AND (? IS NULL OR rop.order_item_id = ?)
        AND rop.mollie_payment_id IS NOT NULL
        ORDER BY rop.id DESC
        LIMIT 1
        FOR UPDATE`,
                [req.params.id, paymentType, itemId, itemId]
            );

            if (paymentRows.length === 0 || !paymentRows[0].mollie_payment_id) {
                await connection.rollback();
                return res.status(404).json({
                    error: 'Zahlung nicht gefunden.'
                });
            }

            const molliePayment = await getMolliePayment(paymentRows[0].mollie_payment_id);
            const mappedPaymentStatus = mapMolliePaymentStatus(molliePayment.status);
            const wasOffsetAgainstDeposit =
                paymentRows[0].payment_status === 'offset' ||
                String(paymentRows[0].note || '').includes('Kaution verrechnet');

            if (wasOffsetAgainstDeposit) {
                let duplicateRefundStatus = null;

                if (mappedPaymentStatus === 'paid') {
                    await connection.execute(
                        `UPDATE rental_order_payments
                         SET payment_status = 'paid', paid_at = COALESCE(paid_at, NOW())
                         WHERE mollie_payment_id = ? AND mollie_refund_id IS NULL`,
                        [molliePayment.id]
                    );
                    duplicateRefundStatus = await refundDuplicateOnlinePayment(
                        connection,
                        {
                            ...paymentRows[0],
                            order_no: paymentRows[0].orderNo
                        },
                        'Onlinezahlung ging nach Verrechnung mit der Kaution ein und wurde automatisch erstattet'
                    );
                    await syncMollieRefundsForPayment(connection, molliePayment.id);
                } else {
                    if (isOpenPaymentStatus(mappedPaymentStatus)) {
                        await cancelMolliePayment(molliePayment.id);
                    }

                    await connection.execute(
                        `UPDATE rental_order_payments
                         SET payment_status = 'offset'
                         WHERE mollie_payment_id = ?
                         AND mollie_refund_id IS NULL`,
                        [molliePayment.id]
                    );
                }

                if (!duplicateRefundStatus) {
                    const [refundRows] = await connection.execute(
                        `SELECT payment_status
                         FROM rental_order_payments
                         WHERE mollie_payment_id = ?
                         AND payment_type = 'duplicate_payment_refund'
                         ORDER BY id DESC
                         LIMIT 1`,
                        [molliePayment.id]
                    );
                    duplicateRefundStatus = refundRows[0]?.payment_status || null;
                }

                await refreshReturnCaseStatus(connection, req.params.id);
                await connection.commit();

                return res.json({
                    id: req.params.id,
                    orderNo: paymentRows[0].orderNo,
                    payment_status: 'paid',
                    payment_type: paymentType,
                    payment_method: 'deposit_offset',
                    settled_by_offset: true,
                    mollie_payment_status: molliePayment.status,
                    duplicate_refund_status: duplicateRefundStatus
                });
            }

            const [cashPaidRows] = await connection.execute(
                `SELECT id
                 FROM rental_order_payments
                 WHERE order_id = ?
                 AND order_item_id <=> ?
                 AND payment_type = ?
                 AND payment_method = 'cash'
                 AND payment_status = 'paid'
                 AND id > ?
                 LIMIT 1
                 FOR UPDATE`,
                [
                    paymentRows[0].order_id,
                    paymentRows[0].order_item_id,
                    paymentRows[0].payment_type,
                    paymentRows[0].paymentRecordId
                ]
            );

            if (cashPaidRows.length > 0) {
                let duplicateRefundStatus = null;

                if (mappedPaymentStatus === 'paid') {
                    await connection.execute(
                        `UPDATE rental_order_payments
                         SET payment_status = 'paid', paid_at = COALESCE(paid_at, NOW())
                         WHERE mollie_payment_id = ? AND mollie_refund_id IS NULL`,
                        [molliePayment.id]
                    );

                    duplicateRefundStatus = await refundDuplicateOnlinePayment(
                        connection,
                        {
                            ...paymentRows[0],
                            order_no: paymentRows[0].orderNo
                        }
                    );
                    await syncMollieRefundsForPayment(connection, molliePayment.id);

                    if (!duplicateRefundStatus) {
                        const [refundRows] = await connection.execute(
                            `SELECT payment_status
                             FROM rental_order_payments
                             WHERE mollie_payment_id = ?
                             AND payment_type = 'duplicate_payment_refund'
                             ORDER BY id DESC
                             LIMIT 1`,
                            [molliePayment.id]
                        );
                        duplicateRefundStatus = refundRows[0]?.payment_status || null;
                    }
                } else {
                    if (isOpenPaymentStatus(mappedPaymentStatus)) {
                        await cancelMolliePayment(molliePayment.id);
                    }

                    await connection.execute(
                        `UPDATE rental_order_payments
                         SET payment_status = 'replaced',
                             note = CONCAT(
                                COALESCE(note, ''),
                                CASE WHEN note IS NULL OR note = '' THEN '' ELSE ' | ' END,
                                'Online-Link nach Barzahlung geschlossen'
                             )
                         WHERE mollie_payment_id = ?
                         AND mollie_refund_id IS NULL`,
                        [molliePayment.id]
                    );
                }

                await refundEligibleDepositsAfterPaymentsSettled(connection, req.params.id);
                await refreshReturnCaseStatus(connection, req.params.id);
                await connection.commit();

                return res.json({
                    id: req.params.id,
                    orderNo: paymentRows[0].orderNo,
                    payment_status: 'paid',
                    payment_type: paymentType,
                    payment_method: 'cash',
                    settled_by_cash: true,
                    mollie_payment_status: molliePayment.status,
                    duplicate_refund_status: duplicateRefundStatus
                });
            }

            await connection.execute(
                `UPDATE rental_order_payments
         SET payment_status = ?,
             paid_at = CASE
                WHEN ? = 'paid' THEN COALESCE(paid_at, NOW())
                ELSE paid_at
             END
         WHERE mollie_payment_id = ?
         AND mollie_refund_id IS NULL`,
                [
                    mappedPaymentStatus,
                    mappedPaymentStatus,
                    molliePayment.id
                ]
            );

            await syncMollieRefundsForPayment(connection, molliePayment.id);

            if (mappedPaymentStatus === 'paid') {
                await refundEligibleDepositsAfterPaymentsSettled(connection, req.params.id);
            }

            await refreshReturnCaseStatus(connection, req.params.id);
            await connection.commit();

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
            await connection.rollback();
            return res.json({
                id: order.id,
                orderNo: order.orderNo,
                status: order.status,
                payment_status: order.payment_status,
                mollie_payment_status: null,
                mollie_payment_method: null
            });
        }

        const payment = await getMolliePayment(order.mollie_payment_id);
        const publicPaymentStatus = mapMolliePaymentStatus(payment.status);

        const [lockedOrders] = await connection.execute(
            `SELECT id, cart_id, order_no, status, payment_method, payment_status
             FROM rental_orders
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [order.id]
        );
        const lockedOrder = lockedOrders[0];
        const newOrderStatus = deriveOrderStatusFromInitialPayment(lockedOrder.status, payment.status);
        const mayFollowInitialPayment = ['reserved', 'pending_payment', 'payment_failed'].includes(
            String(lockedOrder.status || '').toLowerCase()
        );
        let effectivePaymentStatus = publicPaymentStatus;
        let ledgerPaymentStatus = publicPaymentStatus;

        if (!mayFollowInitialPayment && publicPaymentStatus !== 'charged_back') {
            effectivePaymentStatus = lockedOrder.payment_status;
        }

        if (
            ['cancelled', 'expired'].includes(String(lockedOrder.status || '').toLowerCase()) &&
            isOpenPaymentStatus(publicPaymentStatus)
        ) {
            await cancelMolliePayment(payment.id);
            ledgerPaymentStatus = 'cancelled';
        }

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
                effectivePaymentStatus,
                newOrderStatus,
                publicPaymentStatus,
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
                ledgerPaymentStatus,
                ledgerPaymentStatus,
                order.id,
                payment.id
            ]
        );

        await syncMollieRefundsForPayment(connection, payment.id);

        if (
            publicPaymentStatus === 'paid' &&
            ['cancelled', 'expired'].includes(String(lockedOrder.status || '').toLowerCase())
        ) {
            await createCancellationRefunds(connection, {
                id: lockedOrder.id,
                order_no: lockedOrder.order_no,
                payment_method: lockedOrder.payment_method
            });
            effectivePaymentStatus = await refreshCancelledOrderPaymentStatus(connection, lockedOrder.id);
        }

        if (publicPaymentStatus === 'paid' && newOrderStatus === 'confirmed' && lockedOrder.cart_id) {
            await connection.execute('DELETE FROM rental_carts WHERE id = ?', [lockedOrder.cart_id]);
            delete req.session.cartKey;
        }

        await connection.commit();

        return res.json({
            id: order.id,
            orderNo: order.orderNo,
            status: newOrderStatus,
            payment_status: effectivePaymentStatus,
            mollie_payment_status: payment.status,
            mollie_payment_method: payment.method || null
        });

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback beim Synchronisieren des Zahlungsstatus fehlgeschlagen:', rollbackError);
            }
        }
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

    if (!['initial_payment', 'rental_adjustment', 'return_additional_charge'].includes(paymentType)) {
        return res.status(400).json({ error: 'Diese Zahlungsart kann nicht manuell kassiert werden.' });
    }

    if (paymentType !== 'initial_payment' && !orderItemId) {
        return res.status(400).json({ error: 'Für eine Nachzahlung ist die Bestellposition erforderlich.' });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const recordedByUserId = await getUserIdByEmail(connection, req.session.user);

        const [orders] = await connection.execute(
            `SELECT id, order_no, customer_email, payment_method, status
             FROM rental_orders
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
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
         AND payment_status IN ('pending', 'open')
         FOR UPDATE`,
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

            await connection.commit();

            try {
                await sendPaymentReceiptEmail(order, {
                    amount: Number(amount),
                    payment_type: 'initial_payment',
                    payment_method: 'cash',
                    note: note || 'Miete und Kaution bar bei Abholung kassiert'
                });
            } catch (mailError) {
                console.error('Barzahlung gespeichert, aber Quittungsversand fehlgeschlagen:', mailError);
            }

            return res.json({
                message: 'Barzahlung für Miete und Kaution wurde erfasst.'
            });
        }

        let openAdditionalPayment = null;

        if (['rental_adjustment', 'return_additional_charge'].includes(paymentType) && orderItemId) {
            const [openPayments] = await connection.execute(
                `SELECT id, amount, payment_method, mollie_payment_id
         FROM rental_order_payments
         WHERE order_id = ?
         AND order_item_id = ?
         AND payment_type = ?
         AND payment_status IN ('pending', 'open', 'authorized', 'failed', 'cancelled', 'expired')
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
                [orderId, orderItemId, paymentType]
            );

            if (openPayments.length === 0) {
                return res.status(409).json({
                    error: 'Für diese Nachzahlung ist kein offener Zahlungsdatensatz vorhanden.'
                });
            }

            openAdditionalPayment = openPayments[0];
            const expectedAmount = Number(openAdditionalPayment.amount || 0);

            if (Number(amount).toFixed(2) !== expectedAmount.toFixed(2)) {
                return res.status(400).json({
                    error: `Der Barzahlungsbetrag muss exakt ${expectedAmount.toFixed(2)} € betragen.`
                });
            }

            if (openAdditionalPayment.payment_method === 'online' && openAdditionalPayment.mollie_payment_id) {
                const molliePayment = await getMolliePayment(openAdditionalPayment.mollie_payment_id);
                const mollieStatus = mapMolliePaymentStatus(molliePayment.status);

                if (mollieStatus === 'paid') {
                    await connection.execute(
                        `UPDATE rental_order_payments
                         SET payment_status = 'paid', paid_at = COALESCE(paid_at, NOW())
                         WHERE mollie_payment_id = ? AND mollie_refund_id IS NULL`,
                        [openAdditionalPayment.mollie_payment_id]
                    );
                    await refundEligibleDepositsAfterPaymentsSettled(connection, orderId);
                    await refreshReturnCaseStatus(connection, orderId);
                    await connection.commit();
                    return res.status(409).json({
                        error: 'Diese Nachzahlung ist inzwischen online bezahlt worden und darf nicht zusätzlich bar verbucht werden.'
                    });
                }

                if (isOpenPaymentStatus(mollieStatus)) {
                    await cancelMolliePayment(openAdditionalPayment.mollie_payment_id);
                }
            }
        }

        if (['rental_adjustment', 'return_additional_charge'].includes(paymentType) && orderItemId) {
            if (openAdditionalPayment.payment_method === 'cash') {
                await connection.execute(
                    `UPDATE rental_order_payments
                     SET payment_status = 'paid', paid_at = NOW(),
                         recorded_by_user_id = ?, note = COALESCE(?, note)
                     WHERE id = ?`,
                    [recordedByUserId, note || null, openAdditionalPayment.id]
                );
            } else {
                await connection.execute(
                    `UPDATE rental_order_payments
                     SET payment_status = 'replaced',
                         note = CONCAT(COALESCE(note, ''),
                            CASE WHEN note IS NULL OR note = '' THEN '' ELSE ' | ' END,
                            'Online-Nachzahlung durch Barzahlung ersetzt')
                     WHERE id = ?`,
                    [openAdditionalPayment.id]
                );
                await connection.execute(
                    `INSERT INTO rental_order_payments
                     (order_id, order_item_id, payment_type, payment_method, payment_status,
                      amount, paid_at, recorded_by_user_id, note)
                     VALUES (?, ?, ?, 'cash', 'paid', ?, NOW(), ?, ?)`,
                    [
                        orderId,
                        orderItemId,
                        paymentType,
                        Number(amount),
                        recordedByUserId,
                        note || 'Online-Nachzahlung bar vor Ort beglichen'
                    ]
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
            await refundEligibleDepositsAfterPaymentsSettled(connection, orderId);
            await refreshReturnCaseStatus(connection, orderId);
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

        await connection.commit();

        try {
            await sendPaymentReceiptEmail(orders[0], {
                amount: Number(amount),
                payment_type: paymentType,
                payment_method: 'cash',
                note
            });
        } catch (mailError) {
            console.error('Barzahlung gespeichert, aber Quittungsversand fehlgeschlagen:', mailError);
        }

        res.json({ message: 'Barzahlung wurde erfasst.' });

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback der manuellen Zahlung fehlgeschlagen:', rollbackError);
            }
        }
        console.error('Fehler beim Erfassen der Barzahlung:', error);
        res.status(500).json({ error: 'Zahlung konnte nicht erfasst werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/admin/order-payments/:id/retry-refund', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [refundRows] = await connection.execute(
            `SELECT
                rop.id,
                rop.order_id,
                rop.order_item_id,
                rop.payment_type,
                rop.payment_method,
                rop.payment_status,
                rop.amount,
                rop.mollie_payment_id,
                ro.order_no
             FROM rental_order_payments rop
             JOIN rental_orders ro ON ro.id = rop.order_id
             WHERE rop.id = ?
             LIMIT 1
             FOR UPDATE`,
            [req.params.id]
        );

        if (refundRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Rückerstattung wurde nicht gefunden.' });
        }

        const failedRefund = refundRows[0];
        const retryableTypes = [
            'deposit_refund',
            'order_cancellation_refund',
            'duplicate_payment_refund'
        ];

        if (
            !retryableTypes.includes(failedRefund.payment_type) ||
            failedRefund.payment_method !== 'online' ||
            !['failed', 'cancelled'].includes(failedRefund.payment_status) ||
            !failedRefund.mollie_payment_id
        ) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Nur fehlgeschlagene Online-Rückerstattungen können erneut gestartet werden.'
            });
        }

        const [sourceRows] = await connection.execute(
            `SELECT amount
             FROM rental_order_payments
             WHERE order_id = ?
             AND mollie_payment_id = ?
             AND payment_status = 'paid'
             AND payment_type IN ('initial_payment', 'rental_adjustment', 'return_additional_charge')
             FOR UPDATE`,
            [failedRefund.order_id, failedRefund.mollie_payment_id]
        );
        const [settledRefundRows] = await connection.execute(
            `SELECT amount
             FROM rental_order_payments
             WHERE order_id = ?
             AND mollie_payment_id = ?
             AND payment_type IN ('deposit_refund', 'order_cancellation_refund', 'duplicate_payment_refund')
             AND payment_status NOT IN ('failed', 'cancelled')
             FOR UPDATE`,
            [failedRefund.order_id, failedRefund.mollie_payment_id]
        );

        const remainingAmount = roundMoney(
            sourceRows.reduce((sum, row) => sum + Number(row.amount || 0), 0) -
            settledRefundRows.reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0)
        );
        const retryAmount = Math.min(
            Math.abs(roundMoney(failedRefund.amount)),
            Math.max(remainingAmount, 0)
        );

        if (retryAmount <= 0) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Für diese Zahlung ist kein erstattungsfähiger Restbetrag mehr vorhanden.'
            });
        }

        const refund = await createMollieRefundForPayment({
            paymentId: failedRefund.mollie_payment_id,
            amount: retryAmount,
            description: `Erneuter Erstattungsversuch ${failedRefund.order_no}`,
            metadata: {
                orderId: String(failedRefund.order_id),
                itemId: failedRefund.order_item_id ? String(failedRefund.order_item_id) : null,
                type: failedRefund.payment_type,
                retryOfPaymentRecordId: String(failedRefund.id)
            },
            idempotencyKey: `retry-refund-${failedRefund.id}`
        });
        const refundStatus = mapMollieRefundStatus(refund.status);

        const [existingRetryRows] = await connection.execute(
            `SELECT id, payment_status
             FROM rental_order_payments
             WHERE mollie_refund_id = ?
             LIMIT 1
             FOR UPDATE`,
            [refund.id]
        );

        if (existingRetryRows.length === 0) {
            await connection.execute(
                `INSERT INTO rental_order_payments
                 (order_id, order_item_id, payment_type, payment_method, payment_status,
                  amount, mollie_payment_id, mollie_refund_id, note, paid_at)
                 VALUES (?, ?, ?, 'online', ?, ?, ?, ?, ?,
                    CASE WHEN ? = 'paid' THEN NOW() ELSE NULL END)`,
                [
                    failedRefund.order_id,
                    failedRefund.order_item_id,
                    failedRefund.payment_type,
                    refundStatus,
                    -Math.abs(retryAmount),
                    failedRefund.mollie_payment_id,
                    refund.id,
                    `Erneuter Erstattungsversuch für Zahlungsdatensatz #${failedRefund.id}`,
                    refundStatus
                ]
            );
        }

        await syncMollieRefundsForPayment(connection, failedRefund.mollie_payment_id);

        if (failedRefund.payment_type === 'order_cancellation_refund') {
            await refreshCancelledOrderPaymentStatus(connection, failedRefund.order_id);
        }

        await refreshReturnCaseStatus(connection, failedRefund.order_id);

        await connection.commit();

        return res.json({
            message: refundStatus === 'paid'
                ? 'Rückerstattung wurde erfolgreich ausgeführt.'
                : refundStatus === 'pending'
                    ? 'Rückerstattung wurde erneut bei Mollie beauftragt.'
                    : 'Der erneute Erstattungsversuch ist fehlgeschlagen.',
            paymentStatus: refundStatus
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback des Erstattungs-Retry fehlgeschlagen:', rollbackError);
            }
        }
        console.error('Fehler beim erneuten Starten der Rückerstattung:', error);
        return res.status(500).json({ error: 'Rückerstattung konnte nicht erneut gestartet werden.' });
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
        await connection.beginTransaction();

        const recordedByUserId = await getUserIdByEmail(connection, req.session.user);

        const [orders] = await connection.execute(
            `SELECT id, order_no, customer_email, payment_method
             FROM rental_orders
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [orderId]
        );

        if (orders.length === 0) {
            return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
        }

        const [alreadyRefunded] = await connection.execute(
            `SELECT id
             FROM rental_order_payments
             WHERE order_id = ?
             AND order_item_id <=> ?
             AND payment_type = ?
             AND payment_method = 'cash'
             AND payment_status = 'paid'
             LIMIT 1
             FOR UPDATE`,
            [
                orderId,
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
            `SELECT id, amount
     FROM rental_order_payments
     WHERE order_id = ?
     AND order_item_id <=> ?
     AND payment_type = ?
     AND payment_method = 'cash'
     AND payment_status IN ('pending', 'open')
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
            [
                orderId,
                orderItemId || null,
                paymentType
            ]
        );

        if (openRefunds.length > 0) {
            const expectedAmount = Math.abs(Number(openRefunds[0].amount || 0));

            if (Number(amount).toFixed(2) !== expectedAmount.toFixed(2)) {
                await connection.rollback();
                return res.status(400).json({
                    error: `Der Auszahlungsbetrag muss exakt ${expectedAmount.toFixed(2)} € betragen.`
                });
            }

            await connection.execute(
                `UPDATE rental_order_payments
         SET payment_status = 'paid',
             paid_at = NOW(),
             recorded_by_user_id = ?,
             note = COALESCE(?, note)
         WHERE id = ?`,
                [
                    recordedByUserId,
                    note || null,
                    openRefunds[0].id
                ]
            );

            if (paymentType === 'order_cancellation_refund') {
                await refreshCancelledOrderPaymentStatus(connection, orderId);
            }

            await refreshReturnCaseStatus(connection, orderId);

            await connection.commit();

            try {
                await sendPaymentReceiptEmail(orders[0], {
                    amount: -Math.abs(Number(amount)),
                    payment_type: paymentType,
                    payment_method: 'cash',
                    note: note || 'Betrag bar an Kunden ausgezahlt'
                });
            } catch (mailError) {
                console.error('Bar-Rückerstattung gespeichert, aber Belegversand fehlgeschlagen:', mailError);
            }

            return res.json({ message: 'Bar-Rückerstattung wurde erfasst.' });
        }

        await connection.rollback();
        return res.status(409).json({
            error: 'Für diese Bestellung ist keine offene Bar-Rückerstattung vorgemerkt.'
        });

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback der manuellen Rückerstattung fehlgeschlagen:', rollbackError);
            }
        }
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
            ro.payment_method,
            ro.payment_status AS order_payment_status,
            ro.mollie_payment_id AS order_mollie_payment_id
         FROM rental_order_items roi
         JOIN rental_orders ro ON ro.id = roi.order_id
         JOIN rental_products p ON p.id = roi.product_id
         WHERE roi.order_id = ?
         AND roi.item_status LIKE 'returned_%'
         AND COALESCE(roi.deposit_refund_amount, 0) > 0
         FOR UPDATE`,
        [orderId]
    );

    for (const item of items) {
        const [openPayments] = await connection.execute(
            `SELECT id
             FROM rental_order_payments
             WHERE order_id = ?
             AND order_item_id = ?
             AND payment_type IN ('rental_adjustment', 'return_additional_charge')
             AND payment_status IN (
                'pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'
             )
             LIMIT 1
             FOR UPDATE`,
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
             LIMIT 1
             FOR UPDATE`,
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
                 ORDER BY (mollie_payment_id = ?) DESC,
                          CASE WHEN payment_type = 'initial_payment' THEN 0 ELSE 1 END,
                          id ASC
                 LIMIT 1`,
                [orderId, item.order_mollie_payment_id]
            );

            const originalPaymentId = payments[0]?.mollie_payment_id || (
                item.order_payment_status === 'paid'
                    ? item.order_mollie_payment_id
                    : null
            );

            if (!originalPaymentId) {
                throw new Error(
                    `Für die Kautionsrückerstattung von Position #${item.id} fehlt eine bezahlte Mollie-Ausgangszahlung.`
                );
            }

            const refund = await createMollieRefundForPayment({
                paymentId: originalPaymentId,
                amount: refundAmount,
                description: `Kautionsrückerstattung ${item.order_no} - ${item.title} (#${item.id})`,
                metadata: {
                    orderId: String(orderId),
                    itemId: String(item.id),
                    type: 'deposit_refund'
                },
                idempotencyKey: `deposit-refund-${orderId}-${item.id}`
            });
            const refundStatus = mapMollieRefundStatus(refund.status);

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
                 VALUES (?, ?, 'deposit_refund', 'online', ?, ?, ?, ?, ?,
                    CASE WHEN ? = 'paid' THEN NOW() ELSE NULL END)`,
                [
                    orderId,
                    item.id,
                    refundStatus,
                    -Math.abs(refundAmount),
                    originalPaymentId,
                    refund.id,
                    refundStatus === 'paid'
                        ? 'Kaution automatisch nach Zahlung aller Ausstände erstattet'
                        : 'Kautionsrückerstattung nach Zahlung aller Ausstände bei Mollie beauftragt',
                    refundStatus
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
        } else {
            throw new Error(
                `Für die Kautionsrückerstattung von Position #${item.id} fehlt eine gültige ursprüngliche Zahlungsart.`
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

        const mappedPaymentStatus = mapMolliePaymentStatus(payment.status);
        await syncMollieRefundsForPayment(connection, payment.id);

        let isDuplicateEvent = false;
        try {
            await connection.execute(
                `INSERT INTO mollie_webhook_events
                 (mollie_payment_id, mollie_status)
                 VALUES (?, ?)`,
                [payment.id, payment.status]
            );
        } catch (duplicateEventError) {
            if (!isDuplicateKeyError(duplicateEventError)) {
                throw duplicateEventError;
            }
            isDuplicateEvent = true;
        }

        const [cashPaidRows] = await connection.execute(
            `SELECT cashPaid.id,
                    onlinePayment.order_id,
                    onlinePayment.order_item_id,
                    onlinePayment.amount,
                    onlinePayment.mollie_payment_id,
                    ro.order_no
     FROM rental_order_payments onlinePayment
     JOIN rental_order_payments cashPaid
       ON cashPaid.order_id = onlinePayment.order_id
      AND cashPaid.order_item_id = onlinePayment.order_item_id
      AND cashPaid.payment_type = onlinePayment.payment_type
     JOIN rental_orders ro ON ro.id = onlinePayment.order_id
     WHERE onlinePayment.mollie_payment_id = ?
     AND onlinePayment.payment_type IN ('rental_adjustment', 'return_additional_charge')
     AND cashPaid.payment_method = 'cash'
     AND cashPaid.payment_status = 'paid'
     AND cashPaid.id > onlinePayment.id
     LIMIT 1`,
            [payment.id]
        );

        if (cashPaidRows.length > 0) {
            if (mappedPaymentStatus === 'paid') {
                await connection.execute(
                    `UPDATE rental_order_payments
                     SET payment_status = 'paid', paid_at = COALESCE(paid_at, NOW())
                     WHERE mollie_payment_id = ? AND mollie_refund_id IS NULL`,
                    [payment.id]
                );
                await refundDuplicateOnlinePayment(connection, cashPaidRows[0]);
                await refundEligibleDepositsAfterPaymentsSettled(
                    connection,
                    cashPaidRows[0].order_id
                );
                await refreshReturnCaseStatus(connection, cashPaidRows[0].order_id);
                await connection.commit();
                return res.sendStatus(200);
            }

            await connection.execute(
                `UPDATE rental_order_payments
         SET payment_status = 'replaced',
             note = CONCAT(COALESCE(note, ''), ' | Online-Link nach Barzahlung ignoriert')
         WHERE mollie_payment_id = ?
         AND payment_status IN (
            'pending', 'open', 'authorized', 'failed', 'cancelled', 'expired'
         )`,
                [payment.id]
            );

            await connection.commit();
            return res.sendStatus(200);
        }

        const [paymentContextRows] = await connection.execute(
            `SELECT
                rop.order_id,
                rop.order_item_id,
                rop.payment_type,
                rop.payment_status,
                rop.amount,
                rop.mollie_payment_id,
                ro.order_no,
                ro.status AS order_status,
                ro.payment_method AS order_payment_method,
                roi.item_status,
                DATE_FORMAT(roi.rental_start, '%Y-%m-%d') AS rental_start,
                DATE_FORMAT(roi.rental_end, '%Y-%m-%d') AS rental_end,
                roi.price_per_day,
                roi.deposit
             FROM rental_order_payments rop
             JOIN rental_orders ro ON ro.id = rop.order_id
             LEFT JOIN rental_order_items roi ON roi.id = rop.order_item_id
             WHERE rop.mollie_payment_id = ?
             AND rop.mollie_refund_id IS NULL
             ORDER BY CASE WHEN rop.payment_type = 'initial_payment' THEN 0 ELSE 1 END,
                      rop.id DESC
             LIMIT 1
             FOR UPDATE`,
            [payment.id]
        );

        const paymentContext = paymentContextRows[0] || null;
        const isAdditionalPayment = ['rental_adjustment', 'return_additional_charge'].includes(
            paymentContext?.payment_type
        );
        const wasAlreadySettled = ['offset', 'replaced'].includes(
            String(paymentContext?.payment_status || '').toLowerCase()
        );
        const additionalPaymentWasCancelled = isAdditionalPayment && (
            ['cancelled', 'expired'].includes(String(paymentContext?.order_status || '').toLowerCase()) ||
            ['cancelled', 'expired'].includes(String(paymentContext?.item_status || '').toLowerCase())
        );

        if (isAdditionalPayment && wasAlreadySettled) {
            if (mappedPaymentStatus === 'paid') {
                await connection.execute(
                    `UPDATE rental_order_payments
                     SET payment_status = 'paid', paid_at = COALESCE(paid_at, NOW())
                     WHERE mollie_payment_id = ? AND mollie_refund_id IS NULL`,
                    [payment.id]
                );
                await refundDuplicateOnlinePayment(
                    connection,
                    paymentContext,
                    paymentContext.payment_status === 'offset'
                        ? 'Onlinezahlung ging nach Verrechnung mit der Kaution ein und wurde automatisch erstattet'
                        : 'Onlinezahlung ging nach anderweitiger Begleichung ein und wurde automatisch erstattet'
                );
                await syncMollieRefundsForPayment(connection, payment.id);
            } else if (isOpenPaymentStatus(mappedPaymentStatus)) {
                await cancelMolliePayment(payment.id);
            }

            await connection.execute(
                `UPDATE rental_order_payments
                 SET payment_status = ?
                 WHERE mollie_payment_id = ?
                 AND mollie_refund_id IS NULL
                 AND payment_status != 'paid'`,
                [paymentContext.payment_status, payment.id]
            );
            await refreshReturnCaseStatus(connection, paymentContext.order_id);
            await connection.commit();
            return res.sendStatus(200);
        }

        if (additionalPaymentWasCancelled) {
            if (mappedPaymentStatus === 'paid') {
                await connection.execute(
                    `UPDATE rental_order_payments
                     SET payment_status = 'paid', paid_at = COALESCE(paid_at, NOW())
                     WHERE mollie_payment_id = ? AND mollie_refund_id IS NULL`,
                    [payment.id]
                );

                const cancellationOrder = {
                    id: paymentContext.order_id,
                    order_no: paymentContext.order_no,
                    payment_method: paymentContext.order_payment_method
                };
                const cancelledItem = String(paymentContext.item_status || '').toLowerCase() === 'cancelled'
                    ? {
                        id: paymentContext.order_item_id,
                        rental_start: paymentContext.rental_start,
                        rental_end: paymentContext.rental_end,
                        price_per_day: paymentContext.price_per_day,
                        deposit: paymentContext.deposit
                    }
                    : null;

                await createCancellationRefunds(
                    connection,
                    cancellationOrder,
                    cancelledItem
                );

                if (['cancelled', 'expired'].includes(String(paymentContext.order_status || '').toLowerCase())) {
                    await refreshCancelledOrderPaymentStatus(connection, paymentContext.order_id);
                }
            } else if (isOpenPaymentStatus(mappedPaymentStatus)) {
                await cancelMolliePayment(payment.id);
                await connection.execute(
                    `UPDATE rental_order_payments
                     SET payment_status = 'cancelled'
                     WHERE mollie_payment_id = ? AND mollie_refund_id IS NULL`,
                    [payment.id]
                );
            }

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
             WHERE mollie_payment_id = ?
             AND mollie_refund_id IS NULL`,
            [
                mappedPaymentStatus,
                mappedPaymentStatus,
                payment.id
            ]
        );

        if (paymentContext && mappedPaymentStatus === 'paid') {
            await refundEligibleDepositsAfterPaymentsSettled(
                connection,
                paymentContext.order_id
            );
        }

        if (paymentContext) {
            await refreshReturnCaseStatus(connection, paymentContext.order_id);
        }

        if (mappedPaymentStatus === 'charged_back' && !isDuplicateEvent) {
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

        const initialPaymentOrderId = paymentContext?.payment_type === 'initial_payment'
            ? paymentContext.order_id
            : null;
        const [orders] = await connection.execute(
            `SELECT id, order_no, status, payment_method, payment_status, cart_id,
                    mollie_payment_id, order_confirmation_sent_at
             FROM rental_orders
             WHERE ((? IS NOT NULL AND id = ?) OR mollie_payment_id = ?)
             LIMIT 1
             FOR UPDATE`,
            [initialPaymentOrderId, initialPaymentOrderId, payment.id]
        );

        if (orders.length === 0) {
            await connection.commit();
            return res.sendStatus(200);
        }

        const order = orders[0];

        const isDuplicateInitialPayment =
            mappedPaymentStatus === 'paid' &&
            paymentContext?.payment_type === 'initial_payment' &&
            String(order.payment_status || '').toLowerCase() === 'paid' &&
            order.mollie_payment_id &&
            order.mollie_payment_id !== payment.id;

        if (isDuplicateInitialPayment) {
            await refundDuplicateOnlinePayment(
                connection,
                {
                    ...paymentContext,
                    order_no: order.order_no
                },
                'Zusätzliche Initialzahlung nach bereits bezahlter Bestellung wurde automatisch erstattet'
            );
            await connection.commit();
            return res.sendStatus(200);
        }

        const newOrderStatus = deriveOrderStatusFromInitialPayment(order.status, payment.status);
        const mayFollowInitialPayment = ['reserved', 'pending_payment', 'payment_failed'].includes(
            String(order.status || '').toLowerCase()
        );
        let effectivePaymentStatus = mayFollowInitialPayment || mappedPaymentStatus === 'charged_back'
            ? mappedPaymentStatus
            : order.payment_status;

        if (
            mappedPaymentStatus === 'paid' &&
            paymentContext?.payment_type === 'initial_payment' &&
            mayFollowInitialPayment
        ) {
            await cancelOpenMolliePayments(connection, order.id, {
                reason: 'Andere offene Zahlung nach erfolgreicher Initialzahlung beendet'
            });
        }

        if (
            ['cancelled', 'expired'].includes(String(order.status || '').toLowerCase()) &&
            isOpenPaymentStatus(mappedPaymentStatus) &&
            paymentContext?.payment_type === 'initial_payment'
        ) {
            await cancelMolliePayment(payment.id);
            await connection.execute(
                `UPDATE rental_order_payments
                 SET payment_status = 'cancelled'
                 WHERE mollie_payment_id = ? AND mollie_refund_id IS NULL`,
                [payment.id]
            );
        }

        await connection.execute(
            `UPDATE rental_orders
             SET mollie_payment_status = ?,
                 mollie_payment_method = ?,
                 payment_status = ?,
                 status = ?,
                 mollie_payment_id = CASE
                    WHEN ? = 'paid' AND ? = 'initial_payment' AND ? = 'confirmed' THEN ?
                    ELSE mollie_payment_id
                 END,
                 paid_at = CASE
                    WHEN ? = 'paid' THEN COALESCE(paid_at, NOW())
                    ELSE paid_at
                 END
             WHERE id = ?`,
            [
                payment.status,
                payment.method || null,
                effectivePaymentStatus,
                newOrderStatus,
                mappedPaymentStatus,
                paymentContext?.payment_type || null,
                newOrderStatus,
                payment.id,
                mappedPaymentStatus,
                order.id
            ]
        );

        if (
            mappedPaymentStatus === 'paid' &&
            ['cancelled', 'expired'].includes(String(order.status || '').toLowerCase())
        ) {
            await createCancellationRefunds(connection, order);
            effectivePaymentStatus = await refreshCancelledOrderPaymentStatus(connection, order.id);
        }

        if (mappedPaymentStatus === 'paid' && newOrderStatus === 'confirmed' && order.cart_id) {
            await connection.execute(
                `DELETE FROM rental_carts
                 WHERE id = ?`,
                [order.cart_id]
            );
        }

        let shouldSendConfirmation = false;

        if (
            mappedPaymentStatus === 'paid' &&
            newOrderStatus === 'confirmed' &&
            !order.order_confirmation_sent_at
        ) {
            shouldSendConfirmation = true;
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

                    await mailConnection.execute(
                        `UPDATE rental_orders
                         SET order_confirmation_sent_at = NOW()
                         WHERE id = ? AND order_confirmation_sent_at IS NULL`,
                        [order.id]
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

if (process.env.DISABLE_PERIODIC_CLEANUP !== '1') {
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
    }, Number(process.env.CLEANUP_INTERVAL_MS || 60 * 1000));
}

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
    console.log("*********** Segnitz Rental System ***********");
    console.log(`Server läuft auf Port ${port}`);
});
