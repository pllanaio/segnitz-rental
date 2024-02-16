function submitImage() {
        var dataURL = signaturePad.toDataURL();
        //Konsolenausgabe zur Sendungsüberprüfung des Bildes
        if (dataURL.trim() !== "") {
            console.log("Unterschrift erfolgreich übertragen");
            document.getElementById("signature").value = dataURL;
        } else {
            console.log("Keine Bildübertragung erfolgt");
        }
}