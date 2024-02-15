function submitImage() {
        var dataURL = signaturePad.toDataURL();
        //Konsolenausgabe zur Sendungsüberprüfung des Bildes
        if (dataURL.trim() !== "") {
            console.log("Bild erfolgreich übertragen");
            console.log(dataURL);
            document.getElementById("signature").value = dataURL;
        } else {
            console.log("Keine Bildübertragung erfolgt");
        }
}