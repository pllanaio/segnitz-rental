function submitImage() {
        var dataURL = signaturePad.toDataURL();
        //Konsolenausgabe zur Sendungsüberprüfung des Bildes
        if (dataURL.trim() !== "") {
            document.getElementById("Signature").value = dataURL;
            console.log("Unterschrift erfolgreich übertragen");
        } else {
            console.log("Keine Bildübertragung erfolgt");
        }
}