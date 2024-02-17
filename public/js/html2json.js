document.getElementById('form-wrapper').addEventListener('submit', function(event){
    event.preventDefault(); // Verhindert die normale Formularübermittlung

    var formData = new FormData(this);
    var jsonObject = {};

    for (const [key, value]  of formData.entries()) {
        jsonObject[key] = value;
    }

    // Konvertieren des JSON-Objekts in einen String
    var jsonStr = JSON.stringify(jsonObject, null, 2);
    console.log("JSON-Datei erfolgreich generiert");

    fetch('/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonStr, // Der zuvor erstellte JSON-String Ihrer Formulardaten
      })
      .then(response => response.json())
      .then(data => console.log(data.message))
      .catch((error) => console.error('Fehler:', error));
});