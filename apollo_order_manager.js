const express = require("express");
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.static("public"));

const filePath = path.join(__dirname, 'public', 'formdata', 'formData.json');

function saveDataToFile(data) {
  fs.writeFileSync(filePath, data, 'utf8');
}

app.post('/data', (req, res) => {
  const data = JSON.stringify(req.body, null, 2);
  saveDataToFile(data);
  res.send({ message: 'Daten erfolgreich gespeichert.' });
});

app.get('/data', (req, res) => {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Fehler beim Lesen der Datei:', err);
      return res.status(500).send('Fehler beim Lesen der Datei');
    }
    res.send(data);
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, function() {
  console.log("Server läuft auf Port 3000");
});