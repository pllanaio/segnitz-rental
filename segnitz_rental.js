const express = require("express");
const app = express();
const path = require("path");
const bcrypt = require('bcrypt');
require('dotenv').config();
app.use(express.json({
    limit: '1mb'
}));
app.use(express.urlencoded({
    limit: '1mb',
    extended: true
}));
const session = require('express-session');
const fsp = require("fs").promises;
const fs = require('fs');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const {
    PDFDocument,
    PDFTextField,
    PDFCheckBox
} = require('pdf-lib');
const crypto = require('crypto');
const dbConfig = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PW,
    database: process.env.DB_NAME
};
const multer = require('multer');

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

function getCartSessionKey(req) {
    if (!req.session.cartKey) {
        req.session.cartKey = crypto.randomUUID();
    }

    return req.session.cartKey;
}

async function getOrCreateActiveCart(connection, req) {
    const userEmail = req.session.user || null;

    if (userEmail) {
        const [existingUserCart] = await connection.execute(
            `SELECT id
             FROM rental_carts
             WHERE status = 'active'
             AND user_email = ?
             ORDER BY updated_at DESC, id DESC
             LIMIT 1`,
            [userEmail]
        );

        if (existingUserCart.length > 0) {
            return existingUserCart[0].id;
        }

        const sessionKey = getCartSessionKey(req);

        const [guestCart] = await connection.execute(
            `SELECT id
             FROM rental_carts
             WHERE status = 'active'
             AND session_id = ?
             AND user_email IS NULL
             ORDER BY updated_at DESC, id DESC
             LIMIT 1`,
            [sessionKey]
        );

        if (guestCart.length > 0) {
            await connection.execute(
                `UPDATE rental_carts
                 SET user_email = ?, updated_at = NOW()
                 WHERE id = ?`,
                [userEmail, guestCart[0].id]
            );

            return guestCart[0].id;
        }

        const [result] = await connection.execute(
            `INSERT INTO rental_carts (session_id, user_email, status)
             VALUES (?, ?, 'active')`,
            [sessionKey, userEmail]
        );

        return result.insertId;
    }

    const sessionKey = getCartSessionKey(req);

    const [existingGuestCart] = await connection.execute(
        `SELECT id
         FROM rental_carts
         WHERE status = 'active'
         AND session_id = ?
         AND user_email IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [sessionKey]
    );

    if (existingGuestCart.length > 0) {
        return existingGuestCart[0].id;
    }

    const [result] = await connection.execute(
        `INSERT INTO rental_carts (session_id, user_email, status)
         VALUES (?, NULL, 'active')`,
        [sessionKey]
    );

    return result.insertId;
}

async function getActiveCart(connection, req) {
    const userEmail = req.session.user || null;

    if (userEmail) {
        const [rows] = await connection.execute(
            `SELECT id
             FROM rental_carts
             WHERE status = 'active'
             AND user_email = ?
             ORDER BY updated_at DESC, id DESC
             LIMIT 1`,
            [userEmail]
        );

        return rows.length > 0 ? rows[0].id : null;
    }

    if (!req.session.cartKey) {
        return null;
    }

    const [rows] = await connection.execute(
        `SELECT id
         FROM rental_carts
         WHERE status = 'active'
         AND session_id = ?
         AND user_email IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [req.session.cartKey]
    );

    return rows.length > 0 ? rows[0].id : null;
}

async function mergeGuestCartIntoUserCart(connection, req, userEmail) {
    const sessionKey = req.session.cartKey;

    if (!sessionKey || !userEmail) {
        return;
    }

    const [guestCarts] = await connection.execute(
        `SELECT id
         FROM rental_carts
         WHERE status = 'active'
         AND session_id = ?
         AND user_email IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [sessionKey]
    );

    if (guestCarts.length === 0) {
        return;
    }

    const guestCartId = guestCarts[0].id;

    const [userCarts] = await connection.execute(
        `SELECT id
         FROM rental_carts
         WHERE status = 'active'
         AND user_email = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [userEmail]
    );

    if (userCarts.length === 0) {
        await connection.execute(
            `UPDATE rental_carts
             SET user_email = ?, updated_at = NOW()
             WHERE id = ?`,
            [userEmail, guestCartId]
        );
        return;
    }

    const userCartId = userCarts[0].id;

    if (userCartId === guestCartId) {
        return;
    }

    const [guestItems] = await connection.execute(
        `SELECT product_id, rental_start, rental_end, quantity
         FROM rental_cart_items
         WHERE cart_id = ?`,
        [guestCartId]
    );

    for (const item of guestItems) {
        const conflict = await checkCartItemConflict(
            connection,
            userCartId,
            item.product_id,
            item.rental_start,
            item.rental_end
        );

        if (!conflict) {
            await connection.execute(
                `INSERT INTO rental_cart_items
                 (cart_id, product_id, rental_start, rental_end, quantity)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    userCartId,
                    item.product_id,
                    item.rental_start,
                    item.rental_end,
                    item.quantity || 1
                ]
            );
        }
    }

    await connection.execute(
        `DELETE FROM rental_carts
         WHERE id = ?`,
        [guestCartId]
    );

    await connection.execute(
        `UPDATE rental_carts
         SET updated_at = NOW()
         WHERE id = ?`,
        [userCartId]
    );
}

async function checkProductAvailability(connection, productId, rentalStart, rentalEnd, excludeCartItemId = null) {
    const [orderConflicts] = await connection.execute(
        `SELECT roi.id
         FROM rental_order_items roi
         JOIN rental_orders ro ON ro.id = roi.order_id
         WHERE roi.product_id = ?
         AND ro.status IN ('reserved', 'paid', 'confirmed')
         AND (ro.status != 'reserved' OR ro.reserved_until > NOW())
         AND roi.rental_start <= ?
         AND roi.rental_end >= ?
         LIMIT 1`,
        [productId, rentalEnd, rentalStart]
    );

    if (orderConflicts.length > 0) {
        return false;
    }

    return true;
}

async function checkCartItemConflict(connection, cartId, productId, rentalStart, rentalEnd, excludeCartItemId = null) {
    let sql = `
        SELECT id
        FROM rental_cart_items
        WHERE cart_id = ?
        AND product_id = ?
        AND rental_start <= ?
        AND rental_end >= ?
    `;

    const params = [cartId, productId, rentalEnd, rentalStart];

    if (excludeCartItemId) {
        sql += ` AND id != ?`;
        params.push(excludeCartItemId);
    }

    sql += ` LIMIT 1`;

    const [conflicts] = await connection.execute(sql, params);

    return conflicts.length > 0;
}

function getFormValue(formData, fieldName) {
    const element = formData
        .flatMap(step => step.elements)
        .find(el => el.name === fieldName);

    return element ? element.value : null;
}

async function expireOldReservations(connection) {
    const [deletedItems] = await connection.execute(
        `DELETE roi
         FROM rental_order_items roi
         JOIN rental_orders ro ON ro.id = roi.order_id
         WHERE ro.status = 'reserved'
         AND ro.reserved_until IS NOT NULL
         AND ro.reserved_until < NOW()`
    );

    const [updatedOrders] = await connection.execute(
        `UPDATE rental_orders
         SET status = 'expired'
         WHERE status = 'reserved'
         AND reserved_until IS NOT NULL
         AND reserved_until < NOW()`
    );

    if (updatedOrders.affectedRows > 0 || deletedItems.affectedRows > 0) {
        console.log(
            `${new Date().toISOString()} - Cleanup: ${updatedOrders.affectedRows} Orders expired, ${deletedItems.affectedRows} Order-Items gelöscht`
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

async function runDatabaseCleanup(connection) {
    const start = Date.now();

    await expireOldReservations(connection);
    await deleteExpiredGuestVerifications(connection);
    await deleteOldActiveCarts(connection);

    const duration = Date.now() - start;

    /*console.log(
        `${new Date().toISOString()} - Cleanup abgeschlossen (${duration}ms)`
    );*/
}

async function getUserIdByEmail(connection, email) {
    if (!email) return null;

    const [rows] = await connection.execute(
        `SELECT id FROM users WHERE username = ? LIMIT 1`,
        [email]
    );

    return rows.length > 0 ? rows[0].id : null;
}

async function generateOrderNo(connection) {
    const year = new Date().getFullYear();

    const [rows] = await connection.execute(
        `SELECT order_no
         FROM rental_orders
         WHERE order_no LIKE ?
         ORDER BY order_no DESC
         LIMIT 1`,
        [`R${year}%`]
    );

    let nextNumber = 1;

    if (rows.length > 0 && rows[0].order_no) {
        nextNumber = Number(rows[0].order_no.slice(5)) + 1;
    }

    return `R${year}${String(nextNumber).padStart(5, '0')}`;
}

async function getCartItemsForOrder(connection, cartId) {
    const [items] = await connection.execute(
        `SELECT 
            ci.id,
            ci.product_id AS productId,
            DATE_FORMAT(ci.rental_start, '%Y-%m-%d') AS rentalStart,
            DATE_FORMAT(ci.rental_end, '%Y-%m-%d') AS rentalEnd,
            ci.quantity,
            p.product_key AS productKey,
            p.title,
            p.price_per_day AS pricePerDay,
            p.deposit
         FROM rental_cart_items ci
         JOIN rental_products p ON p.id = ci.product_id
         WHERE ci.cart_id = ?
         ORDER BY ci.id ASC`,
        [cartId]
    );

    return items;
}

function calculateRentalDays(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

function buildOrderSummary(orderNo, cartItems) {
    let rentalTotal = 0;
    let depositTotal = 0;

    const items = cartItems.map(item => {
        const days = calculateRentalDays(item.rentalStart, item.rentalEnd);
        const lineRentalTotal = days * Number(item.pricePerDay || 0) * Number(item.quantity || 1);
        const lineDepositTotal = Number(item.deposit || 0) * Number(item.quantity || 1);

        rentalTotal += lineRentalTotal;
        depositTotal += lineDepositTotal;

        return {
            productId: item.productId,
            productKey: item.productKey,
            title: item.title,
            rentalStart: item.rentalStart,
            rentalEnd: item.rentalEnd,
            days,
            quantity: item.quantity,
            pricePerDay: Number(item.pricePerDay || 0),
            deposit: Number(item.deposit || 0),
            rentalTotal: lineRentalTotal,
            depositTotal: lineDepositTotal
        };
    });

    return {
        orderNo,
        status: 'reserved',
        items,
        totals: {
            rentalTotal,
            depositTotal,
            grandTotalBeforeDepositReturn: rentalTotal + depositTotal
        }
    };
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

const uploadProductImages = multer({
    storage: productImageStorage,
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

// Session Middleware konfigurieren
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 30 * 60 * 1000
    }
}));

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

app.post('/login', async (req, res) => {
    const {
        username,
        password
    } = req.body;
    try {
        const connection = await mysql.createConnection(dbConfig);
        // Hole das Passwort des Benutzers aus der Datenbank
        const [rows] = await connection.execute(
            'SELECT password, role FROM users WHERE username = ?',
            [username]
        );
        if (rows.length > 0) {
            // Vergleiche das eingegebene Passwort mit dem gehashten Passwort in der
            // Datenbank
            const passwordValid = await bcrypt.compare(password, rows[0].password);

            if (passwordValid) {
                req.session.user = username;
                req.session.role = rows[0].role;
                req.session.createdAt = Date.now();
                await mergeGuestCartIntoUserCart(connection, req, username);
                res.status(200).send("Login erfolgreich!");

                console.log(
                    new Date().toISOString(),
                    '- Anmeldung: Benutzer',
                    username,
                    'erfolgreich angemeldet mit Rolle',
                    rows[0].role
                );
            } else {
                // Passwort ist falsch
                res
                    .status(401)
                    .send("Falsche Zugangsdaten.");
            }
        } else {
            // Kein Benutzer gefunden
            res
                .status(401)
                .send("Falsche Zugangsdaten.");
        }
        await connection.end();
    } catch (error) {
        console.error('Fehler beim Login:', error);
        res
            .status(500)
            .send("Serverfehler beim Versuch, sich anzumelden.");
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
        req
            .session
            .destroy(err => {
                if (err) {
                    console.log('Fehler beim Beenden der Sitzung:', err);
                    return res
                        .status(500)
                        .send('Fehler beim Abmelden');
                }
                res.send('Logout erfolgreich');
            });
    } else {
        res
            .status(400)
            .send("Kein Benutzer ist angemeldet.");
    }
});

function checkAdmin(req, res, next) {
    if (req.session.user && req.session.role === 'global_admin') {
        next();
    } else {
        return res.status(403).send('Kein Zugriff');
    }
}

async function generatePDF(formDataObj, templatePath, outputPath) {

    let signatureBase64;
    const formData = formDataObj;
    const templateBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    // Suche nach der Signatur im formDataObj
    formDataObj
        .form
        .forEach(step => {
            if (true) {
                const signatureElement = step
                    .elements
                    .find(element => element.name === "Signature");
                if (signatureElement) {
                    signatureBase64 = signatureElement
                        .value
                        .split(';base64,')
                        .pop();
                }
            }
        });

    formData
        .form
        .forEach(step => {
            step
                .elements
                .forEach(element => {
                    // Ignoriere einige Felder sodass keine Fehler auftreten
                    if (element.name === "total_work" || element.name === "total_material" || element.name === "Signature" || ((element.name.startsWith("work_") || element.name.startsWith("material_")) && !element.name.includes("_combined_")) || element.name === "email") {
                        return;
                    }

                    // Behandlung des OrderType
                    if (element.name === "OrderType" && element.value !== "Auftragsart auswählen...") {
                        // Setze das entsprechende Checkfeld basierend auf dem Wert von OrderType
                        const orderTypeToCheckboxName = {
                            "Materiallieferung": "MaterialDelivery",
                            "Inbetriebnahme": "Commissioning",
                            "Gewährleistung": "Warranty",
                            "Wartung ohne Vertrag": "MaintenanceNoContract",
                            "Wartung mit Vertrag": "MaintenanceContract",
                            "Arbeits- und Materialnachweis": "WorkAndMaterialProof"
                        };
                        const checkboxName = orderTypeToCheckboxName[element.value];
                        if (checkboxName) {
                            try {
                                const checkBox = form.getCheckBox(checkboxName);
                                checkBox.check();
                            } catch (error) {
                                console.error(
                                    `${new Date().toISOString()} - Fehler beim Setzen des Checkfelds "${checkboxName}": ${error}`
                                );
                            }
                        }
                    } else {
                        try {
                            // Behandlung anderer Felder (Textfelder und Checkfelder)
                            const field = form.getField(element.name);
                            if (field instanceof PDFTextField) {
                                field.setText(element.value);
                            } else if (field instanceof PDFCheckBox && element.value === "on") {
                                field.check();
                            }
                        } catch (error) {
                            console.error(
                                `${new Date().toISOString()} - Fehler beim Verarbeiten des Feldes "${element.name}": ${error}`
                            );
                        }
                    }
                });
        });

    if (signatureBase64) {
        const signatureImage = await pdfDoc.embedPng(
            Buffer.from(signatureBase64, 'base64')
        );
        // Annahme: Die Signatur soll auf der ersten Seite erscheinen.
        const page = pdfDoc.getPages()[0];

        // Feste Position und Größe für die Signatur. Diese Werte solltest du anpassen,
        // basierend auf der Position, wo die Signatur erscheinen soll.
        const x = 298.38; // Horizontale Position
        const y = 762.24; // Vertikale Position
        const width = 142.02; // Breite der Signatur
        const height = 37.54; // Höhe der Signatur

        page.drawImage(signatureImage, {
            x: x,
            y: page.getHeight() - y - height, // Anpassung, um y von unten zu positionieren
            width: width,
            height: height
        });
    }

    // Optional: Formularfelder flatten, wenn nötig form.flatten();
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
}

async function sendEmailWithPDF(recipients, pdfFilePath, pdfFilename) {
    if (!recipients || recipients.length === 0) {
        return false;
    }

    const transporter = nodemailer.createTransport({
        host: 'mail.your-server.de',
        port: 465,
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: `"Segnitz Rental" <${process.env.SMTP_USER}>`,
        to: recipients.join(', '),
        subject: 'Ihr Mietauftrag',
        text: 'Im Anhang finden Sie Ihren Mietauftrag als PDF.',
        attachments: [
            {
                filename: pdfFilename,
                path: pdfFilePath
            }
        ]
    });

    return true;
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

            console.log(
                `${new Date().toISOString()} - Availability check: Produkt "${item.title}" (${item.productId}) von ${item.rentalStart} bis ${item.rentalEnd}: ${available ? 'frei' : 'blockiert'}`
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

        const [orderResult] = await connection.execute(
            `INSERT INTO rental_orders
            (order_no, cart_id, user_id, customer_email, customer_first_name, customer_last_name,
            customer_phone, customer_address, customer_zip, customer_city, status, reserved_until, confirmation_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', DATE_ADD(NOW(), INTERVAL 15 MINUTE), ?)`,
            [
                orderNo,
                cartId,
                userId,
                email,
                firstName,
                lastName,
                phone,
                address,
                zip,
                city,
                JSON.stringify(orderSummary)
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
        }

        await connection.execute(
            `DELETE FROM rental_carts
             WHERE id = ?`,
            [cartId]
        );

        delete req.session.cartKey;

        await connection.execute(
            `DELETE FROM guest_verifications
             WHERE email = ?`,
            [email]
        );

        const enrichedPayload = {
            ...req.body,
            order: {
                id: orderId,
                reservedUntil,
                ...orderSummary
            }
        };

        await connection.commit();

        const timestamp = new Date().getTime();
        const pdfFilename = `Mietauftrag_${orderNo}_${timestamp}.pdf`;
        const pdfFilepath = path.join(__dirname, 'public', 'pdf', pdfFilename);
        const templatePdfPath = path.join(__dirname, 'public', 'pdf', 'template.pdf');
        const activeUser = req.session.user || 'Gast';

        await fsp.writeFile(
            path.join(__dirname, 'public', 'json', `order_${orderNo}_${timestamp}.json`),
            JSON.stringify(enrichedPayload, null, 2)
        );

        console.log(
            `${new Date().toISOString()} - Bestellung: Reservierung ${orderNo} vom Benutzer ${activeUser} gespeichert`
        );

        await generatePDF(enrichedPayload, templatePdfPath, pdfFilepath);

        if (email) {
            try {
                await sendEmailWithPDF([email], pdfFilepath, pdfFilename);
            } catch (mailError) {
                console.error('Fehler beim Mailversand:', mailError);
            }
        }

        res.json({
            orderId,
            orderNo,
            status: 'reserved',
            pdfUrl: `/pdf-download/${pdfFilename}`
        });
    } catch (err) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback fehlgeschlagen:', rollbackError);
            }
        }

        console.error('Fehler beim Reservieren der Bestellung:', err);
        res.status(500).json({
            error: 'Fehler beim Reservieren der Bestellung.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.get('/pdf-download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(__dirname, 'public', 'pdf', filename);
    res.download(filepath); // Setzt Content-Disposition zum Download
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

async function sendVerificationEmail(email, token) {
    const verificationUrl = `${process.env.BASE_URL}/verify-email?token=${token}`;

    const transporter = nodemailer.createTransport({
        host: 'mail.your-server.de',
        port: 465,
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: `"Segnitz Rental" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'E-Mail-Adresse bestätigen',
        text: `Bitte bestätigen Sie Ihre E-Mail-Adresse über diesen Link: ${verificationUrl}`,
        html: `
            <p>Bitte bestätigen Sie Ihre E-Mail-Adresse.</p>
            <p><a href="${verificationUrl}">E-Mail-Adresse bestätigen</a></p>
            <p>Der Link ist 24 Stunden gültig.</p>
        `
    });
}

app.post('/register-customer', async (req, res) => {
    const {
        firstName,
        lastName,
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
            (username, password, role, first_name, last_name, phone, address, zip, city, customer_no, email_verified, verification_token, verification_expires)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email,
                hashedPassword,
                'user',
                firstName,
                lastName,
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

app.post('/request-guest-verification', async (req, res) => {
    const {
        email
    } = req.body;

    if (!email) {
        return res.status(400).json({
            error: 'E-Mail-Adresse fehlt'
        });
    }

    try {
        const connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const [existingUsers] = await connection.execute(
            'SELECT id FROM users WHERE username = ? LIMIT 1',
            [email]
        );

        if (existingUsers.length > 0) {
            await connection.end();
            return res.status(409).json({
                error: 'Diese E-Mail-Adresse existiert bereits. Bitte einloggen.'
            });
        }

        const token = createVerificationToken();
        const expires = getVerificationExpiry();

        await connection.execute(
            `INSERT INTO guest_verifications
            (email, verification_token, verified, expires_at)
            VALUES (?, ?, ?, ?)`,
            [email, token, 0, expires]
        );

        await connection.end();

        await sendVerificationEmail(email, token);

        console.log(
            `${new Date().toISOString()} - Gast-Verifikation: Bestätigungsmail an ${email} wurde versendet`
        );

        res.status(200).json({
            message: 'Bestätigungsmail wurde versendet.'
        });
    } catch (error) {
        console.error('Fehler bei Gast-Verifikation:', error);
        res.status(500).json({
            error: 'Fehler beim Versenden der Bestätigungsmail'
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

            return res.send('E-Mail-Adresse wurde erfolgreich bestätigt. Sie können das Fenster schließen.');
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

            return res.send('E-Mail-Adresse wurde erfolgreich bestätigt. Sie können das Fenster schließen.');
        }

        await connection.end();
        return res.status(400).send('Bestätigungslink ungültig oder abgelaufen.');
    } catch (error) {
        console.error('Fehler bei E-Mail-Verifikation:', error);
        res.status(500).send('Fehler bei der E-Mail-Verifikation.');
    }
});

app.post('/check-email-verification', async (req, res) => {
    const {
        email
    } = req.body;

    if (!email) {
        return res.status(400).json({
            verified: false,
            error: 'E-Mail-Adresse fehlt'
        });
    }

    try {
        const connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const [users] = await connection.execute(
            'SELECT email_verified FROM users WHERE username = ?',
            [email]
        );

        if (users.length > 0) {
            await connection.end();

            return res.json({
                verified: users[0].email_verified === 1
            });
        }

        const [guests] = await connection.execute(
            `SELECT verified 
             FROM guest_verifications 
             WHERE email = ?
             ORDER BY created_at DESC
             LIMIT 1`,
            [email]
        );

        await connection.end();

        if (guests.length > 0) {
            return res.json({
                verified: guests[0].verified === 1
            });
        }

        return res.json({
            verified: false
        });
    } catch (error) {
        console.error('Fehler beim Prüfen der E-Mail-Verifikation:', error);
        return res.status(500).json({
            verified: false,
            error: 'Fehler beim Prüfen der E-Mail-Verifikation'
        });
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

app.get('/products', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [products] = await connection.execute(
            'SELECT * FROM rental_products ORDER BY title ASC'
        );

        const [images] = await connection.execute(
            `SELECT id, product_id, image_path, sort_order
            FROM rental_product_images
            ORDER BY product_id ASC, sort_order ASC, id ASC`
        );

        const productsWithImages = products.map(product => {
            const productImages = images
                .filter(image => image.product_id === product.id)
                .map(image => ({
                    id: image.id,
                    path: image.image_path
                }));

            return {
                ...product,
                images: productImages,
                image_path: productImages[0]?.path || product.image_path || ''
            };
        });

        res.json(productsWithImages);
    } catch (error) {
        console.error('Fehler beim Laden der Produkte:', error);
        res.status(500).json({ error: 'Produkte konnten nicht geladen werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.get('/products/:id/availability', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const [blockedPeriods] = await connection.execute(
            `SELECT 
                DATE_FORMAT(roi.rental_start, '%Y-%m-%d') AS rentalStart,
                DATE_FORMAT(roi.rental_end, '%Y-%m-%d') AS rentalEnd
            FROM rental_order_items roi
            JOIN rental_orders ro ON ro.id = roi.order_id
            WHERE roi.product_id = ?
            AND ro.status IN ('reserved', 'paid', 'confirmed')
            AND (ro.status != 'reserved' OR ro.reserved_until > NOW())
            ORDER BY roi.rental_start ASC`,
            [req.params.id]
        );

        res.json(blockedPeriods);
    } catch (error) {
        console.error('Fehler beim Laden der Produktverfügbarkeit:', error);
        res.status(500).json({
            error: 'Produktverfügbarkeit konnte nicht geladen werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.post('/products', checkAdmin, async (req, res) => {
    const { productKey, title, description, pricePerDay, deposit, imagePath } = req.body;

    const normalizedPricePerDay = Number(String(pricePerDay).replace(',', '.'));
    const normalizedDeposit = Number(String(deposit).replace(',', '.'));

    if (!productKey || !title) {
        return res.status(400).json({ error: 'Produkt-Key und Titel sind Pflichtfelder.' });
    }

    if (
        Number.isNaN(normalizedPricePerDay) ||
        Number.isNaN(normalizedDeposit) ||
        normalizedPricePerDay < 0 ||
        normalizedDeposit < 0 ||
        normalizedPricePerDay > 999999.99 ||
        normalizedDeposit > 999999.99
    ) {
        return res.status(400).json({
            error: 'Preis und Kaution müssen zwischen 0 und 999999.99 liegen.'
        });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [result] = await connection.execute(
            `INSERT INTO rental_products 
    (product_key, title, description, price_per_day, deposit, image_path)
    VALUES (?, ?, ?, ?, ?, ?)`,
            [productKey, title, description, normalizedPricePerDay, normalizedDeposit, imagePath]
        );

        res.status(201).json({
            message: 'Produkt erstellt',
            productId: result.insertId
        });
    } catch (error) {
        console.error('Fehler beim Erstellen des Produkts:', error);
        res.status(500).json({ error: 'Produkt konnte nicht gespeichert werden.' });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.put('/products/:id', checkAdmin, async (req, res) => {
    const { title, description, pricePerDay, deposit, imagePath, isActive } = req.body;

    const normalizedPricePerDay = Number(String(pricePerDay).replace(',', '.'));
    const normalizedDeposit = Number(String(deposit).replace(',', '.'));

    if (!title) {
        return res.status(400).json({ error: 'Titel ist ein Pflichtfeld.' });
    }

    if (
        Number.isNaN(normalizedPricePerDay) ||
        Number.isNaN(normalizedDeposit) ||
        normalizedPricePerDay < 0 ||
        normalizedDeposit < 0 ||
        normalizedPricePerDay > 999999.99 ||
        normalizedDeposit > 999999.99
    ) {
        return res.status(400).json({
            error: 'Preis und Kaution müssen zwischen 0 und 999999.99 liegen.'
        });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        await connection.execute(
            `UPDATE rental_products
             SET title = ?, description = ?, price_per_day = ?, deposit = ?, image_path = ?, is_active = ?
             WHERE id = ?`,
            [title, description, normalizedPricePerDay, normalizedDeposit, imagePath, isActive ? 1 : 0, req.params.id]
        );

        res.json({ message: 'Produkt aktualisiert' });
    } catch (error) {
        console.error('Fehler beim Aktualisieren des Produkts:', error);
        res.status(500).json({ error: 'Produkt konnte nicht aktualisiert werden.' });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.delete('/products/:id', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        // 1. Alle Bilder vorher holen
        const [images] = await connection.execute(
            'SELECT image_path FROM rental_product_images WHERE product_id = ?',
            [req.params.id]
        );

        // 2. Produkt löschen (CASCADE löscht DB-Bilder)
        await connection.execute(
            'DELETE FROM rental_products WHERE id = ?',
            [req.params.id]
        );

        // 3. Dateien auf der Festplatte löschen
        for (const image of images) {
            const filePath = path.join(__dirname, 'public', image.image_path);

            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log('Bild gelöscht:', filePath);
                } else {
                    console.warn('Datei nicht gefunden:', filePath);
                }
            } catch (fileError) {
                console.error('Fehler beim Löschen der Datei:', filePath, fileError);
            }
        }

        res.json({ message: 'Produkt und Bilder gelöscht.' });

    } catch (error) {
        console.error('Fehler beim Löschen des Produkts:', error);
        res.status(500).json({ error: 'Produkt konnte nicht gelöscht werden.' });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.post('/products/:id/images', checkAdmin, uploadProductImages.array('images', 10), async (req, res) => {
    const productId = req.params.id;

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [existingImages] = await connection.execute(
            'SELECT COUNT(*) AS count FROM rental_product_images WHERE product_id = ?',
            [productId]
        );

        const existingCount = existingImages[0].count;
        const uploadCount = req.files.length;

        if (existingCount + uploadCount > 10) {
            return res.status(400).json({
                error: 'Maximal 10 Bilder pro Produkt erlaubt.'
            });
        }

        for (let i = 0; i < req.files.length; i++) {
            const imagePath = `img/products/${req.files[i].filename}`;

            await connection.execute(
                `INSERT INTO rental_product_images 
                 (product_id, image_path, sort_order)
                 VALUES (?, ?, ?)`,
                [productId, imagePath, existingCount + i]
            );
        }

        res.json({ message: 'Bilder erfolgreich hochgeladen.' });

    } catch (error) {
        console.error('Fehler beim Bilderupload:', error);
        res.status(500).json({ error: 'Bilder konnten nicht hochgeladen werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.put('/products/:id/images/order', checkAdmin, async (req, res) => {
    const productId = req.params.id;
    const { imageIds } = req.body;

    if (!Array.isArray(imageIds)) {
        return res.status(400).json({ error: 'Ungültige Bildreihenfolge.' });
    }

    if (imageIds.length > 10) {
        return res.status(400).json({ error: 'Maximal 10 Bilder pro Produkt erlaubt.' });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        for (let index = 0; index < imageIds.length; index++) {
            await connection.execute(
                `UPDATE rental_product_images
                 SET sort_order = ?
                 WHERE id = ? AND product_id = ?`,
                [index, imageIds[index], productId]
            );
        }

        res.json({ message: 'Bildreihenfolge gespeichert.' });
    } catch (error) {
        console.error('Fehler beim Speichern der Bildreihenfolge:', error);
        res.status(500).json({ error: 'Bildreihenfolge konnte nicht gespeichert werden.' });
    } finally {
        if (connection) await connection.end();
    }
});

app.delete('/product-images/:id', checkAdmin, async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(
            'SELECT image_path FROM rental_product_images WHERE id = ?',
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Bild nicht gefunden.' });
        }

        const imagePath = path.join(__dirname, 'public', rows[0].image_path);

        await connection.execute(
            'DELETE FROM rental_product_images WHERE id = ?',
            [req.params.id]
        );

        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }

        res.json({ message: 'Bild gelöscht.' });
    } catch (error) {
        console.error('Fehler beim Löschen des Bildes:', error);
        res.status(500).json({ error: 'Bild konnte nicht gelöscht werden.' });
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
                DATE_FORMAT(returned_at, '%Y-%m-%d %H:%i:%s') AS returned_at
             FROM rental_orders
             ORDER BY id DESC`
        );

        res.json(orders);
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
            `SELECT *
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

        const [items] = await connection.execute(
            `SELECT
                roi.id,
                roi.product_id AS productId,
                p.title,
                DATE_FORMAT(roi.rental_start, '%Y-%m-%d') AS rentalStart,
                DATE_FORMAT(roi.rental_end, '%Y-%m-%d') AS rentalEnd,
                roi.price_per_day AS pricePerDay,
                roi.deposit
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
            `SELECT id, image_path AS imagePath, created_at
             FROM rental_order_return_images
             WHERE order_id = ?
             ORDER BY id DESC`,
            [req.params.id]
        );

        res.json({
            ...orders[0],
            items: finalItems,
            returnImages: images
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

app.get('/cart', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);
        const cartId = await getActiveCart(connection, req);

        if (!cartId) {
            return res.json({
                cartId: null,
                items: []
            });
        }

        const [items] = await connection.execute(
            `SELECT 
                ci.id,
                ci.product_id AS productId,
                DATE_FORMAT(ci.rental_start, '%Y-%m-%d') AS rentalStart,
                DATE_FORMAT(ci.rental_end, '%Y-%m-%d') AS rentalEnd,
                ci.quantity,
                p.product_key AS productKey,
                p.title,
                p.description,
                p.price_per_day AS pricePerDay,
                p.deposit,
                p.image_path AS imagePath
             FROM rental_cart_items ci
             JOIN rental_products p ON p.id = ci.product_id
             WHERE ci.cart_id = ?
             ORDER BY ci.id ASC`,
            [cartId]
        );

        res.json({
            cartId,
            items
        });
    } catch (error) {
        console.error('Fehler beim Laden des Warenkorbs:', error);
        res.status(500).json({
            error: 'Warenkorb konnte nicht geladen werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.post('/cart/items', async (req, res) => {
    const { productId, rentalStart, rentalEnd } = req.body;

    if (!productId || !rentalStart || !rentalEnd) {
        return res.status(400).json({
            error: 'Produkt, Mietbeginn und Mietende sind Pflichtfelder.'
        });
    }

    if (new Date(rentalEnd) < new Date(rentalStart)) {
        return res.status(400).json({
            error: 'Das Mietende darf nicht vor dem Mietbeginn liegen.'
        });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const [products] = await connection.execute(
            `SELECT id
             FROM rental_products
             WHERE id = ?
             AND is_active = 1`,
            [productId]
        );

        if (products.length === 0) {
            return res.status(404).json({
                error: 'Produkt wurde nicht gefunden oder ist nicht aktiv.'
            });
        }

        const isAvailable = await checkProductAvailability(
            connection,
            productId,
            rentalStart,
            rentalEnd
        );

        if (!isAvailable) {
            return res.status(409).json({
                error: 'Das Produkt ist im ausgewählten Zeitraum nicht verfügbar.'
            });
        }

        const cartId = await getOrCreateActiveCart(connection, req);

        const cartConflict = await checkCartItemConflict(
            connection,
            cartId,
            productId,
            rentalStart,
            rentalEnd
        );

        if (cartConflict) {
            return res.status(409).json({
                error: 'Dieses Produkt befindet sich für diesen Zeitraum bereits im Warenkorb.'
            });
        }

        const [result] = await connection.execute(
            `INSERT INTO rental_cart_items
             (cart_id, product_id, rental_start, rental_end, quantity)
             VALUES (?, ?, ?, ?, 1)`,
            [cartId, productId, rentalStart, rentalEnd]
        );

        await connection.execute(
            `UPDATE rental_carts
             SET updated_at = NOW()
             WHERE id = ?`,
            [cartId]
        );

        res.status(201).json({
            message: 'Produkt wurde zum Warenkorb hinzugefügt.',
            itemId: result.insertId
        });
    } catch (error) {
        console.error('Fehler beim Hinzufügen zum Warenkorb:', error);
        res.status(500).json({
            error: 'Produkt konnte nicht zum Warenkorb hinzugefügt werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.put('/cart/items/:id', async (req, res) => {
    const { rentalStart, rentalEnd } = req.body;

    if (!rentalStart || !rentalEnd) {
        return res.status(400).json({
            error: 'Mietbeginn und Mietende sind Pflichtfelder.'
        });
    }

    if (new Date(rentalEnd) < new Date(rentalStart)) {
        return res.status(400).json({
            error: 'Das Mietende darf nicht vor dem Mietbeginn liegen.'
        });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const cartId = await getOrCreateActiveCart(connection, req);

        const [items] = await connection.execute(
            `SELECT id, product_id
             FROM rental_cart_items
             WHERE id = ?
             AND cart_id = ?`,
            [req.params.id, cartId]
        );

        if (items.length === 0) {
            return res.status(404).json({
                error: 'Warenkorbposition wurde nicht gefunden.'
            });
        }

        const cartConflict = await checkCartItemConflict(
            connection,
            cartId,
            items[0].product_id,
            rentalStart,
            rentalEnd,
            req.params.id
        );

        if (cartConflict) {
            return res.status(409).json({
                error: 'Dieses Produkt befindet sich für diesen Zeitraum bereits im Warenkorb.'
            });
        }

        const isAvailable = await checkProductAvailability(
            connection,
            items[0].product_id,
            rentalStart,
            rentalEnd,
            req.params.id
        );

        if (!isAvailable) {
            return res.status(409).json({
                error: 'Das Produkt ist im ausgewählten Zeitraum nicht verfügbar.'
            });
        }

        await connection.execute(
            `UPDATE rental_cart_items
             SET rental_start = ?, rental_end = ?
             WHERE id = ?
             AND cart_id = ?`,
            [rentalStart, rentalEnd, req.params.id, cartId]
        );

        await connection.execute(
            `UPDATE rental_carts
             SET updated_at = NOW()
             WHERE id = ?`,
            [cartId]
        );

        res.json({
            message: 'Warenkorbposition wurde aktualisiert.'
        });
    } catch (error) {
        console.error('Fehler beim Aktualisieren der Warenkorbposition:', error);
        res.status(500).json({
            error: 'Warenkorbposition konnte nicht aktualisiert werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.delete('/cart/items/:id', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const cartId = await getOrCreateActiveCart(connection, req);

        const [result] = await connection.execute(
            `DELETE FROM rental_cart_items
             WHERE id = ?
             AND cart_id = ?`,
            [req.params.id, cartId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: 'Warenkorbposition wurde nicht gefunden.'
            });
        }

        const [remainingItems] = await connection.execute(
            `SELECT COUNT(*) AS count
             FROM rental_cart_items
             WHERE cart_id = ?`,
            [cartId]
        );

        if (remainingItems[0].count === 0) {
            await connection.execute(
                `DELETE FROM rental_carts
                 WHERE id = ?`,
                [cartId]
            );

            delete req.session.cartKey;

            console.log(
                `${new Date().toISOString()} - Warenkorb ${cartId} wurde gelöscht.`
            )
        } else {
            await connection.execute(
                `UPDATE rental_carts
                 SET updated_at = NOW()
                 WHERE id = ?`,
                [cartId]
            );
        }

        res.json({
            message: 'Warenkorbposition wurde gelöscht.'
        });
    } catch (error) {
        console.error('Fehler beim Löschen der Warenkorbposition:', error);
        res.status(500).json({
            error: 'Warenkorbposition konnte nicht gelöscht werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

app.delete('/cart', async (req, res) => {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        await runDatabaseCleanup(connection);

        const cartId = await getActiveCart(connection, req);

        if (!cartId) {
            return res.json({
                message: 'Warenkorb ist bereits leer.'
            });
        }

        await connection.execute(
            `DELETE FROM rental_carts WHERE id = ?`,
            [cartId]
        );

        delete req.session.cartKey;

        console.log(
            `${new Date().toISOString()} - Warenkorb ${cartId} wurde vollständig geleert.`
        );

        res.json({
            message: 'Warenkorb wurde geleert.'
        });
    } catch (error) {
        console.error('Fehler beim Leeren des Warenkorbs:', error);
        res.status(500).json({
            error: 'Warenkorb konnte nicht geleert werden.'
        });
    } finally {
        if (connection) {
            await connection.end();
        }
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