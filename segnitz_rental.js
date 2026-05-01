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
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PW,
            database: process.env.DB_NAME
        });
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
    try {
        const formData = req.body.form;

        const emailElement = formData
            .flatMap(step => step.elements)
            .find(el => el.name === "email" || el.name === "CustomerEmail");

        const email = emailElement ? emailElement.value : null;

        const timestamp = new Date().getTime();
        const pdfFilename = `Mietauftrag_${timestamp}.pdf`;
        const pdfFilepath = path.join(__dirname, 'public', 'pdf', pdfFilename);
        const templatePdfPath = path.join(__dirname, 'public', 'pdf', 'template.pdf');
        const activeUser = req.session.user || 'Gast';

        await fsp.writeFile(
            path.join(__dirname, 'public', 'json', `data_${timestamp}.json`),
            JSON.stringify(req.body, null, 2)
        );
        console.log(
            `${new Date().toISOString()} - Dateigenerierung: JSON-Datei vom Benutzer ${activeUser} erfolgreich generiert und gespeichert`
        );

        await generatePDF(req.body, templatePdfPath, pdfFilepath);
        console.log(
            `${new Date().toISOString()} - Dateigenerierung: PDF-Datei erfolgreich vom Benutzer ${activeUser} generiert und gespeichert`
        );

        if (email) {
            try {
                await sendEmailWithPDF([email], pdfFilepath, pdfFilename);

                console.log(
                    `${new Date().toISOString()} - Mailversand: PDF erfolgreich an ${email} versendet`
                );
            } catch (mailError) {
                console.error('Fehler beim Mailversand:', mailError);
            }
        }

        res.json({
            pdfUrl: `/pdf-download/${pdfFilename}`
        });
    } catch (err) {
        console.error('Fehler:', err);
        res
            .status(500)
            .send('Fehler beim Verarbeiten der Anfrage');
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
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER,
            password: process.env.DB_PW,
            database: process.env.DB_NAME
        });

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
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER,
            password: process.env.DB_PW,
            database: process.env.DB_NAME
        });

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
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER,
            password: process.env.DB_PW,
            database: process.env.DB_NAME
        });

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
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER,
            password: process.env.DB_PW,
            database: process.env.DB_NAME
        });

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
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER,
            password: process.env.DB_PW,
            database: process.env.DB_NAME
        });

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
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
        'SELECT * FROM rental_products ORDER BY title ASC'
    );
    await connection.end();
    res.json(rows);
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

        await connection.execute(
            `INSERT INTO rental_products 
            (product_key, title, description, price_per_day, deposit, image_path)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [productKey, title, description, normalizedPricePerDay, normalizedDeposit, imagePath]
        );

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
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute(
        'DELETE FROM rental_products WHERE id = ?',
        [req.params.id]
    );
    await connection.end();

    res.json({ message: 'Produkt gelöscht' });
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

app.listen(3000, () => {
    console.log(
        "*********** Segnitz Rental System ***********"
    )
    console.log("Server läuft auf Port 3000");
});