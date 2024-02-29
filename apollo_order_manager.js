const express = require("express");
const mysql = require("mysql2");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const app = express();
require('dotenv').config();
app.use(express.json());
app.use(express.static("public"));

// MySQL-Datenbankverbindung konfigurieren
const db = mysql.createConnection(
    {host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PW, database: process.env.DB_NAME}
);

// PDF aus Daten generieren
function generatePDF(data, callback) {
  const doc = new PDFDocument();
  let filename = `FormData_${Date.now()}.pdf`;
  filename = encodeURIComponent(filename);
  doc.pipe(fs.createWriteStream(path.join(__dirname, 'public', 'pdfs', filename)));
  // PDF-Inhalt hier hinzufügen, z.B.:
  doc.text(data, 100, 100);
  doc.end();
  callback(filename);
}

db.connect(err => {
    if (err) 
        throw err;
    console.log("Mit MySQL verbunden.");
});

app.post('/data', (req, res) => {
    const data = JSON.stringify(req.body, null, 2);
    const formData = req.body.form; // Annahme, dass die Daten unter req.body.form liegen
    let formInputs = [];
    const insertOrderDataQuery = 'INSERT INTO OrderData (form_inputs) VALUES (?)';
    formData.forEach(stepData => {
        stepData
            .elements
            .forEach(element => {
                const step = stepData.step;
                const keyname = element.name; // entspricht der "name" im Formular
                const value = element.value; // entspricht der "value" im Formular

                // SQL-Insert-Befehl zur Speicherung der Daten in die form_inputs Tabelle
                const insertQuery = 'INSERT INTO form_inputs (step, keyname, value) VALUES (?, ?, ?)';
                db.query(insertQuery, [
                    step, keyname, value
                ], (err, result) => {
                    if (err) {
                        console.error('Fehler beim Einfügen in die Datenbank:', err);
                        return res
                            .status(500)
                            .send('Fehler beim Speichern der Daten');
                    } else {
                        formInputs.push(result.insertId);
                    }
                });
            });
    });
    db.query(insertOrderDataQuery, [data], (err, result) => {
        if (err) {
            console.error('Fehler beim Speichern in OrderData:', err);
            res
                .status(500)
                .send('Fehler beim Speichern der Daten in OrderData');
        } else {
            console.log('OrderData erfolgreich gespeichert');
            generatePDF(data, (filename) => {
                res.send({message: 'Daten erfolgreich gespeichert.', pdf: filename});
            });
        }
    });

});

app.get('/data', (req, res) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Fehler beim Lesen der Datei:', err);
            return res
                .status(500)
                .send('Fehler beim Lesen der Datei');
        }
        res.send(data);
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, function () {
    console.log("Server läuft auf Port 3000");
});