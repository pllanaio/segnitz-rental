const express = require("express");
const fsp = require("fs").promises;
const fs = require('fs');
const path = require("path");
const app = express();
require('dotenv').config();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use(express.static("public"));
const PDFDocument = require('pdfkit');

app.use((req, res, next) => {
    const payloadSize = Buffer.byteLength(JSON.stringify(req.body));
    console.log(`Payload-Größe: ${payloadSize} Bytes`);
    next();
});

async function generatePDF(formData, signaturePath) {
    const doc = new PDFDocument();
    const pdfPath = path.join(__dirname, 'public', 'pdf', `output_${Date.now()}.pdf`);
    if (!fs.existsSync(path.dirname(pdfPath))) {
        fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    }
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    formData.forEach(step => {
        doc.fontSize(16).fillColor('black').text(`Step ${step.step}`, { underline: true }).moveDown(0.5);
        step.elements.forEach(element => {
            if (element.name === 'Signature' && step.step === 8) {
                doc.image(signaturePath, { fit: [100, 100], align: 'center' }).moveDown(0.5);
            } else {
                doc.fontSize(12).fillColor('blue').text(`${element.name}: ${element.value}`, { indent: 20, align: 'left' }).moveDown(0.5);
            }
        });
        doc.moveDown(1);
    });

    doc.end();
    return new Promise((resolve, reject) => {
        stream.on('finish', () => resolve(pdfPath));
        stream.on('error', reject);
    });
}

app.post('/data', async (req, res) => {
    try {
       // const pdfdata = req.body;
        const timestamp = new Date().getTime();
        const formData = req.body.form;

        // Speichern der Formulardaten als JSON
       // const jsonFilename = `data_${timestamp}.json`;
       // const jsonFilePath = path.join(__dirname, 'public', 'json', jsonFilename);
       // await fsp.writeFile(jsonFilePath, JSON.stringify(pdfdata, null, 2));
       // console.log('Formulardaten als JSON gespeichert.');

        //Speichern der Signatur als Bild
        const signature = formData.find(step => step.step === 8).elements.find(element => element.name === "Signature").value;
        const base64Data = signature.split(';base64,').pop();
        const signaturePath = path.join(__dirname, 'public', 'signatures', `signature_${timestamp}.png`);
        await fsp.writeFile(signaturePath, base64Data, { encoding: 'base64' });

        const pdfPath = await generatePDF(formData, signaturePath);
        const pdfUrl = `/pdf/${path.basename(pdfPath)}`;
        console.log('PDF-Datei erfolgreich generiert');
        res.json({ pdfUrl });

    } catch (err) {
        console.error('Fehler:', err);
        res.status(500).send('Fehler beim Verarbeiten der Anfrage');
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, () => {
    console.log("Server läuft auf Port 3000");
});