function submitImage() {
        var imageUrl = document
            .getElementById("signature")
            .value;
        var dataURL = signaturePad.toDataURL();
        imageUrl = dataURL;
        //Konsolenausgabe zur Sendungsüberprüfung des Bildes
        if (dataURL.trim() !== "") {
            console.log("Bild erfolgreich übertragen")
            console.log(imageUrl = dataURL);
        } else {
            console.log("Keine Bildübertragung erfolgt");
        }
}