const express = require("express");
const fsp = require("fs").promises;
const fs = require('fs');
const path = require("path");
const app = express();
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();
app.use(express.json({limit: '1mb'}));
app.use(express.urlencoded({limit: '1mb', extended: true}));
app.use(express.static("public"));
const {PDFDocument, PDFTextField, PDFCheckBox} = require('pdf-lib');

app.use((req, res, next) => {
    const payloadSize = Buffer.byteLength(JSON.stringify(req.body));
    console.log(`Payload-Größe: ${payloadSize} Bytes`);
    next();
});

app.use(cors());

function logDatabaseChange(action, table, value, timestamp = new Date()) {
    console.log(`${timestamp.toISOString()} - Datenbankänderung: Element ${action} in der Tabelle ${table}. Betroffenes Element: ${JSON.stringify(value)}`);
}

app.get('/materials', async (req, res) => {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PW,
            database: process.env.DB_NAME
        });

        const [rows, fields] = await connection.execute('SELECT material_name FROM materials');

        await connection.end();

        const materialOptions = rows.map(row => row.material_name);
        res.json(materialOptions);
    } catch (error) {
        console.error('Fehler beim Laden der Materialoptionen aus der Datenbank:', error);
        res.status(500).json({ error: 'Fehler beim Laden der Materialoptionen aus der Datenbank' });
    }
});

app.get('/workers', async (req, res) => {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PW,
            database: process.env.DB_NAME
        });

        const [rows, fields] = await connection.execute('SELECT worker_name FROM workers');

        await connection.end();

        const workerOptions = rows.map(row => row.worker_name);
        res.json(workerOptions);
    } catch (error) {
        console.error('Fehler beim Laden der Monteuroptionen aus der Datenbank:', error);
        res.status(500).json({ error: 'Fehler beim Laden der Materialoptionen aus der Datenbank' });
    }
});

app.delete('/delete-material', async (req, res) => {
    const materialName = req.body.name;
    if (!materialName) {
        return res.status(400).json({ error: 'Materialname nicht angegeben' });
    }

    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PW,
            database: process.env.DB_NAME
        });

        const [result] = await connection.execute('DELETE FROM materials WHERE material_name = ?', [materialName]);
        
        await connection.end();

        // Loggen der Datenbankänderung
        if (result.affectedRows > 0) {
            logDatabaseChange('gelöscht', 'materials', { name: materialName });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Material nicht gefunden' });
        }

        res.status(200).json({ message: 'Material erfolgreich gelöscht' });
    } catch (error) {
        console.error('Fehler beim Löschen des Materials aus der Datenbank:', error);
        res.status(500).json({ error: 'Fehler beim Löschen des Materials aus der Datenbank' });
    }
});

app.delete('/delete-worker', async (req, res) => {
    const workerName = req.body.name;
    if (!workerName) {
        return res.status(400).json({ error: 'Arbeitername nicht angegeben' });
    }

    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PW,
            database: process.env.DB_NAME
        });

        const [result] = await connection.execute('DELETE FROM workers WHERE worker_name = ?', [workerName]);
        
        await connection.end();

        // Loggen der Datenbankänderung
        if (result.affectedRows > 0) {
            logDatabaseChange('gelöscht', 'workers', { name: workerName });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Arbeiter nicht gefunden' });
        }

        res.status(200).json({ message: 'Arbeiter erfolgreich gelöscht' });
    } catch (error) {
        console.error('Fehler beim Löschen des Arbeiters aus der Datenbank:', error);
        res.status(500).json({ error: 'Fehler beim Löschen des Arbeiters aus der Datenbank' });
    }
});

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
            if (step.step === 8) {
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
                    // Ignoriere die Felder total_work total_material und Signature
                    if (element.name === "total_work" || element.name === "total_material" || element.name === "Signature"||
                    (
                        (element.name.startsWith("work_") || element.name.startsWith("material_")) &&
                        !element.name.includes("_combined_")
                    )) {
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
                                console.error(`Fehler beim Setzen des Checkfelds "${checkboxName}": ${error}`);
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
                            console.error(`Fehler beim Verarbeiten des Feldes "${element.name}": ${error}`);
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

app.post('/data', async (req, res) => {
    try {
        const timestamp = new Date().getTime();
        const pdfFilename = `pdf_${timestamp}.pdf`;
        const pdfFilepath = path.join(__dirname, 'public', 'pdf', pdfFilename);
        const templatePdfPath = path.join(__dirname, 'public', 'pdf', 'template.pdf');

        // Speichern der Formulardaten als JSON
        const jsonFilename = `data_${timestamp}.json`;
        const jsonFilePath = path.join(__dirname, 'public', 'json', jsonFilename);
        await fsp.writeFile(jsonFilePath, JSON.stringify(req.body, null, 2));
        console.log('Formulardaten als JSON gespeichert.');

        // Übergebe formData direkt als Objekt
        await generatePDF(req.body, templatePdfPath, pdfFilepath);
        console.log('PDF-Datei erfolgreich generiert');
        res.json({pdfUrl: `/pdf-download/${pdfFilename}`});
    } catch (err) {
        console.error('Fehler:', err);
        res
            .status(500)
            .send('Fehler beim Verarbeiten der Anfrage');
    }
});

app.post('/add-material', async (req, res) => {
    const materialName = req.body.name;
    if (!materialName) {
        return res.status(400).json({ error: 'Materialname nicht angegeben' });
    }

    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PW,
            database: process.env.DB_NAME
        });

        const [result] = await connection.execute('INSERT INTO materials (material_name) VALUES (?)', [materialName]);
        
        await connection.end();

        // Loggen der Datenbankänderung
        logDatabaseChange('hinzugefügt', 'materials', { name: materialName });

        res.status(200).json({ message: 'Material erfolgreich hinzugefügt', id: result.insertId });
    } catch (error) {
        console.error('Fehler beim Hinzufügen des Materials zur Datenbank:', error);
        res.status(500).json({ error: 'Fehler beim Hinzufügen des Materials zur Datenbank' });
    }
})

app.post('/add-worker', async (req, res) => {
    const workerName = req.body.name;
    if (!workerName) {
        return res.status(400).json({ error: 'Monteursname nicht angegeben' });
    }

    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PW,
            database: process.env.DB_NAME
        });

        const [result] = await connection.execute('INSERT INTO workers (worker_name) VALUES (?)', [workerName]);
        
        await connection.end();

        // Loggen der Datenbankänderung
        logDatabaseChange('hinzugefügt', 'workers', { name: workerName });

        res.status(200).json({ message: 'Monteur erfolgreich hinzugefügt', id: result.insertId });
    } catch (error) {
        console.error('Fehler beim Hinzufügen des Monteurs zur Datenbank:', error);
        res.status(500).json({ error: 'Fehler beim Hinzufügen des Monteurs zur Datenbank' });
    }
});

app.get('/pdf-download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(__dirname, 'public', 'pdf', filename);
    res.download(filepath); // Setzt Content-Disposition zum Download
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/backend',(req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'backend.html'))
})

app.listen(3000, () => {
    console.log("Apollo Order Manager - Nather Heizung und Sanitär");
    console.log("Server läuft auf Port 3000");
})
