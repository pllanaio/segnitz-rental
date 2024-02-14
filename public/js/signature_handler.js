    var wrapper = document.getElementById("signature-pad"),
    canvas = wrapper.querySelector("canvas"),
    signaturePad;

    /**
    *  Behandlung der Größenänderung der Unterschriftenfelds
    */
    function resizeCanvas() {
    var oldContent = signaturePad.toData();
    var ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas
        .getContext("2d")
        .scale(ratio, ratio);
    signaturePad.clear();
    signaturePad.fromData(oldContent);
    }

    /**
    *  Speichern des Inhaltes als Bild
    */
    function download(filename) {
    var blob = dataURLToBlob(signaturePad.toDataURL());
    var url = window
        .URL
        .createObjectURL(blob);
    var a = document.createElement("a");

    a.style = "display: none";
    a.href = url;
    a.download = filename;
    document
        .body
        .appendChild(a);
    a.click();
    window
        .URL
        .revokeObjectURL(url);
    }

    /**
    * DataURL in Binär umwandeln
    */
    function dataURLToBlob(dataURL) {
    // Code von https://github.com/ebidel/filer.js
    var parts = dataURL.split(';base64,');
    var contentType = parts[0].split(":")[1];
    var raw = window.atob(parts[1]);
    var rawLength = raw.length;
    var uInt8Array = new Uint8Array(rawLength);
    for (var i = 0; i < rawLength; ++i) {
        uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], {type: contentType});
    }
    var signaturePad = new SignaturePad(canvas);
    signaturePad.minWidth = 1; //minimale Breite des Stiftes
    signaturePad.maxWidth = 5; //maximale Breite des Stiftes
    signaturePad.penColor = "#000000"; //Stiftfarbe
    signaturePad.backgroundColor = "#FFFFFF"; //Hintergrundfarbe

    window.onclick = resizeCanvas;
    resizeCanvas();