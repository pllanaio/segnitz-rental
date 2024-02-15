document.getElementById('form-wrapper').addEventListener('submit', function(event){
    event.preventDefault(); // Verhindert die normale Formularübermittlung

    var formData = new FormData(this);
    var jsonObject = {};

    for (const [key, value]  of formData.entries()) {
        jsonObject[key] = value;
    }

    // Konvertieren des JSON-Objekts in einen String
    var jsonStr = JSON.stringify(jsonObject, null, 2);
    
    // Erstellen und Herunterladen der JSON-Datei
    var blob = new Blob([jsonStr], {type: "application/json"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = "formData.json";
    document.body.appendChild(a); // notwendig für Firefox
    a.click();
    document.body.removeChild(a);
});