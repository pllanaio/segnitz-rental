var wrapper = document.getElementById("signature-pad"),
    canvas = wrapper.querySelector("canvas"),
    signaturePad;

/**
 *  Behandlung der Größenänderung der Unterschriftenfelds
 */
function resizeCanvas() {
    var oldContent = signaturePad.toData();
    var ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), Math.sqrt(1800000 / Math.max(1, canvas.offsetWidth * canvas.offsetHeight)));
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
    return new Blob([uInt8Array], {
        type: contentType
    });
}

/**
 * Clear the canvas
 */
function clearCanvas() {
    window.uploadedSignatureDataUrl = null;
    document.getElementById('signatureFile').value = '';
    document.getElementById('signatureFileStatus').textContent = '';
    signaturePad.clear();
}

var signaturePad = new SignaturePad(canvas);
signaturePad.minWidth = 1; //minimale Breite des Stiftes
signaturePad.maxWidth = 5; //maximale Breite des Stiftes
signaturePad.penColor = "#000000"; //Stiftfarbe
signaturePad.backgroundColor = "#FFFFFF"; //Hintergrundfarbe

window.addEventListener('resize', resizeCanvas);
document.getElementById('next-btn')?.addEventListener('click', () => {
    window.setTimeout(resizeCanvas, 0);
});
document.getElementById('clear-signature')?.addEventListener('click', clearCanvas);
resizeCanvas();

// Keyboard/screen-reader accessible import of the user's existing handwritten
// signature. Operator explicitly enables this method; the server decodes again.
document.getElementById('signatureFile')?.addEventListener('change', async event => {
    const status = document.getElementById('signatureFileStatus');
    window.uploadedSignatureDataUrl = null;
    const file = event.target.files[0];
    if (!file) return;
    try {
        if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 500000) throw new Error('Bitte PNG/JPEG mit höchstens 500 KB auswählen.');
        const bitmap = await createImageBitmap(file);
        if (bitmap.width * bitmap.height > 4000000 || bitmap.width < 1 || bitmap.height < 1) { bitmap.close(); throw new Error('Das Bild ist zu groß.'); }
        const imported = document.createElement('canvas');
        const scale = Math.min(1, 1200 / bitmap.width, 600 / bitmap.height);
        imported.width = Math.max(1, Math.round(bitmap.width * scale));
        imported.height = Math.max(1, Math.round(bitmap.height * scale));
        imported.getContext('2d').drawImage(bitmap, 0, 0, imported.width, imported.height);
        bitmap.close();
        const value = imported.toDataURL('image/png');
        if (value.length > 700000) throw new Error('Das normalisierte Bild ist zu groß.');
        window.uploadedSignatureDataUrl = value;
        status.textContent = 'Unterschriftsbild bereit. Es wird beim Bestellabschluss geprüft.';
    } catch (error) {
        event.target.value = '';
        status.textContent = error.message || 'Unterschriftsbild konnte nicht gelesen werden.';
    }
});
