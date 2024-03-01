const express = require("express");
const mysql = require("mysql2/promise");
const fs = require("fs").promises;
const path = require("path");
const app = express();
const handlebars = require('handlebars');
const puppeteer = require('puppeteer');
require('dotenv').config();
app.use(express.json());
app.use(express.static("public"));

// MySQL-Datenbankverbindung konfigurieren mit Promise-Unterstützung
const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PW,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

//PDF aus den .json Daten generieren
async function generatePDF(data, signaturePath) {
    const jsonData = JSON.parse(data);
    // Fügen Sie den Pfad zur Signatur den jsonData hinzu
    jsonData.signaturePath = signaturePath; // Stellen Sie sicher, dass Ihr Handlebars-Template dieses Feld verwendet
    const templatePath = path.join(__dirname, 'public', 'hbs', 'template.hbs');
    const templateHtml = await fs.readFile(templatePath, 'utf8');
    const template = handlebars.compile(templateHtml);
    const html = template(jsonData); // jsonData enthält jetzt auch den Pfad zur Signatur

    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setContent(html);
    const pdfPath = path.join(__dirname, 'public', 'pdf', `output_${Date.now()}.pdf`);
    await page.pdf({ path: pdfPath, format: 'A4' });
    await browser.close();

    return pdfPath;
}

app.post('/data', async (req, res) => {
    try {
        const pdfdata = req.body;
        const timestamp = new Date().getTime();
        const filename = `data_${timestamp}.json`;
        const filepath = path.join(__dirname, 'public', 'json', filename);
        await fs.writeFile(filepath, JSON.stringify(pdfdata, null, 2));
        console.log(`JSON-Datei erfolgreich gespeichert.`);
        const signature = req.body.form.find(step => step.step === 8).elements.find(element => element.name === "Signature").value;
        const base64Data = signature.split(';base64,').pop();
        const signaturePath = path.join(__dirname, 'public', 'signatures', `signature_${timestamp}.png`); 
        const signatureRelativePath = `/signatures/signature_${timestamp}.png`;// Relativer Pfad vom public-Verzeichnis
        await fs.writeFile(signaturePath, base64Data, {encoding: 'base64'});
        console.log('Signatur erfolgreich als Bild gespeichert.');
        const data = JSON.stringify(req.body, null, 2);
        const formData = req.body.form;
        const insertOrderDataQuery = 'INSERT INTO OrderData (form_inputs) VALUES (?)';
        await db.query(insertOrderDataQuery, [data]);
        for (const stepData of formData) {
            for (const element of stepData.elements) {
                const insertQuery = 'INSERT INTO form_inputs (step, keyname, value) VALUES (?, ?, ?)';
                await db.query(insertQuery, [stepData.step, element.name, element.value]);
            }
        }
        console.log("Formulardaten erfolgreich in der Datenbank gespeichert");

        const pdfPath = await generatePDF(JSON.stringify(req.body, null, 2), signatureRelativePath);
        console.log('PDF-Datei erfolgreich generiert');

        res.send({message: 'Daten erfolgreich gespeichert.', file: filename, pdf: pdfPath});
    } catch (err) {
        console.error('Fehler:', err);
        if (!res.headersSent) {
            res.status(500).send('Fehler beim Verarbeiten der Anfrage');
        }
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));

});

app.listen(3000, () => {
    console.log("NATHER Heizung & Sanitär - Auftragserfassung");
    console.log("Server läuft auf Port 3000");
});