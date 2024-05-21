const progress = (value) => {
    document
        .getElementsByClassName('progress-bar')[0]
        .style
        .width = `${value}%`;
}

let step = document.getElementsByClassName('step');
let prevBtn = document.getElementById('prev-btn');
let nextBtn = document.getElementById('next-btn');
let submitBtn = document.getElementById('submit-btn');
let form = document.getElementsByTagName('form')[0];
let preloader = document.getElementById('preloader-wrapper');
let bodyElement = document.querySelector('body');
let succcessDiv = document.getElementById('success');

let current_step = 0;
let stepCount = 7;
step[current_step]
    .classList
    .add('d-block');
if (current_step == 0) {
    prevBtn
        .classList
        .add('d-none');
    submitBtn
        .classList
        .add('d-none');
    nextBtn
        .classList
        .add('d-inline-block');
}

function submitSignature() {
    var dataURL = signaturePad.toDataURL();
    //Konsolenausgabe zur Sendungsüberprüfung des Bildes
    if (dataURL.trim() !== "") {
        document
            .getElementById("Signature")
            .value = dataURL;
        console.log("Unterschrift erfolgreich übertragen");
        console.log(dataURL);
    } else {
        console.log("Keine Bildübertragung erfolgt");
    }
}

nextBtn.addEventListener('click', () => {

    // Check if current step is valid before moving to next
    let isValid = true;
    switch(current_step) {
        case 0:
            isValid = validateStep1();
            break;
        case 1:
            isValid = validateStep2();
            break;
        case 2:
            isValid = validateStep3();
            break;
        case 3:
            isValid = validateStep4();
            break;
        case 4:
            isValid = validateStep5();
            break;
        case 5:
            isValid = validateStep6();
            break;
        case 6:
            isValid = validateStep7();
            break;
        case 7:
            isValid = validateStep8();
            break;

    }
    
    if (!isValid) {
        return; // Stop the function if the current step is not valid
    }


    current_step++;
    let previous_step = current_step - 1;
    if ((current_step > 0) && (current_step <= stepCount)) {
        prevBtn
            .classList
            .remove('d-none');
        prevBtn
            .classList
            .add('d-inline-block');
        step[current_step]
            .classList
            .remove('d-none');
        step[current_step]
            .classList
            .add('d-block');
        step[previous_step]
            .classList
            .remove('d-block');
        step[previous_step]
            .classList
            .add('d-none');
        if (current_step == stepCount) {
            submitBtn
                .classList
                .remove('d-none');
            submitBtn
                .classList
                .add('d-inline-block');
            nextBtn
                .classList
                .remove('d-inline-block');
            nextBtn
                .classList
                .add('d-none');
        }
    } else {
        if (current_step > stepCount) {
            form.onsubmit = () => {
                return true
            }
        }
    }
    progress((100 / stepCount) * current_step);
});

prevBtn.addEventListener('click', () => {
    if (current_step > 0) {
        current_step--;
        let previous_step = current_step + 1;
        prevBtn
            .classList
            .add('d-none');
        prevBtn
            .classList
            .add('d-inline-block');
        step[current_step]
            .classList
            .remove('d-none');
        step[current_step]
            .classList
            .add('d-block')
        step[previous_step]
            .classList
            .remove('d-block');
        step[previous_step]
            .classList
            .add('d-none');
        if (current_step < stepCount) {
            submitBtn
                .classList
                .remove('d-inline-block');
            submitBtn
                .classList
                .add('d-none');
            nextBtn
                .classList
                .remove('d-none');
            nextBtn
                .classList
                .add('d-inline-block');
            prevBtn
                .classList
                .remove('d-none');
            prevBtn
                .classList
                .add('d-inline-block');
        }
    }

    if (current_step == 0) {
        prevBtn
            .classList
            .remove('d-inline-block');
        prevBtn
            .classList
            .add('d-none');
    }
    progress((100 / stepCount) * current_step);
});

submitBtn.addEventListener('click', (event) => {
    // Stelle sicher, dass alle Validierungen bestanden sind, bevor das Formular abgesendet wird
    let signatureValid = validateStep8(); // Diese Funktion überprüft die Unterschrift und Zustimmungen

    if (!signatureValid) {
        event.preventDefault(); // Verhindere das Absenden des Formulars
    } else {
        preloader.classList.add('d-block'); // Zeige den Ladebildschirm an, falls alles gültig ist
            const timer = ms => new Promise(res => setTimeout(res, ms));

    timer(0)
        .then(() => {
            bodyElement
                .classList
                .add('loaded');
        })
        .then(() => {
            step[stepCount]
                .classList
                .remove('d-block');
            step[stepCount]
                .classList
                .add('d-none');
            prevBtn
                .classList
                .remove('d-inline-block');
            prevBtn
                .classList
                .add('d-none');
            submitBtn
                .classList
                .remove('d-inline-block');
            submitBtn
                .classList
                .add('d-none');
            succcessDiv
                .classList
                .remove('d-none');
            succcessDiv
                .classList
                .add('d-block');
        })
    }
});

function validateStep1() {
    let isValid = true;
    const recipient = document.querySelector('input[name="Recipient"]').value;
    const client = document.querySelector('input[name="Client"]').value;
    const ownerChecked = document.getElementById('Owner').checked;
    const renterChecked = document.getElementById('Renter').checked;
    const otherRelatedChecked = document.getElementById('other_related').checked;

    // Regex, der nur Buchstaben, Leerzeichen und einige Satzzeichen erlaubt
    const textOnlyRegex = /^[a-zA-ZäöüßÄÖÜéèàùçÉÈÀÙÇ.,' -]+$/;

    // Überprüfung der Texteingaben auf ungültige Zeichen
    if (!recipient || !client) {
        alert('Keine Leeren Felder erlaubt');
        isValid = false;
    } else if (!textOnlyRegex.test(recipient) || !textOnlyRegex.test(client)) {
        alert('Bitte geben Sie nur Text ohne Zahlen und Sonderzeichen in die Felder ein.');
        isValid = false;
    } else if (!ownerChecked && !renterChecked && !otherRelatedChecked) {
        alert('Bitte wählen Sie mindestens eine Option (Eigentümer, Mieter, Objektangehöriger).');
        isValid = false;
    }

    return isValid;
}

function validateStep2() {
    let isValid = true;
    const orderType = document.querySelector('select[name="OrderType"]').value;

    if (orderType === "" || orderType === "Auftragsart auswählen...") {
        alert('Bitte eine Auftragsart auswählen');
        isValid = false;
    }
    return isValid;
}

function validateStep3() {
    let isValid = true;
    const orderNo = document.querySelector('input[name="OrderNo"]').value;
    const clientNo = document.querySelector('input[name="ClientNo"]').value;
    const workToDo = document.querySelector('input[name="WorkToDo"]').value;
    const workerSelected = document.querySelector('select[name="Worker"]').value;

    // Überprüfung, ob die Felder für Auftragsnummer und Kundennummer gefüllt sind
    if (!orderNo || !clientNo) {
        alert('Auftragsnummer und Kundennummer dürfen nicht leer sein.');
        isValid = false;
    } else if (!workToDo) {
        alert('Bitte geben Sie die auszuführenden Arbeiten an.');
        isValid = false;
    } else if (workerSelected === "" || workerSelected === "Monteur auswählen...") {
        alert('Bitte wählen Sie einen Monteur aus.');
        isValid = false;
    }

    return isValid;
}

function validateStep4() {
    let isValid = true;
    const dateTimePickerInput = document.querySelector('input[name="DateTimePickerInput"]').value;
    const workReport = document.querySelector('textarea[name="WorkReport"]').value;

    // Überprüfung, ob das Datum ausgewählt wurde
    if (!dateTimePickerInput) {
        alert('Bitte geben Sie den Termin und die Uhrzeit an.');
        isValid = false;
    } else if (!workReport.trim()) {
        alert('Der Arbeitsbericht darf nicht leer sein.');
        isValid = false;
    }

    return isValid;
}

function validateStep5() {
    let isValid = true;
    return isValid;
}

function validateStep6() {
    let isValid = true;
    return isValid;
}

function validateStep7() {
    let isValid = true;
    const machineUsageCheck = document.getElementById('MachineUsageCheck');
    const disposeCheck = document.getElementById('DisposeCheck');
    const workCheck = document.getElementById('WorkCheck');
    const machineUsageTextfield = document.getElementById('MachineUsageTextfield');
    const disposeTextfield = document.getElementById('DisposeTextfield');
    const workTextfield = document.getElementById('WorkTextfield');

    // Prüfe, ob die zugehörigen Textfelder ausgefüllt sind, wenn die Checkboxen aktiviert sind
    if (machineUsageCheck.checked && !machineUsageTextfield.value.trim()) {
        alert('Bitte geben Sie Details zum Maschineneinsatz an.');
        isValid = false;
    }
    if (disposeCheck.checked && !disposeTextfield.value.trim()) {
        alert('Bitte geben Sie Details zur Entsorgung an.');
        isValid = false;
    }
    if (workCheck.checked && !workTextfield.value.trim()) {
        alert('Bitte geben Sie Details zu weiteren Arbeiten an.');
        isValid = false;
    }
    return isValid;
}

function validateStep8() {
    let isValid = true;
    const signatureCanvas = signaturePad.isEmpty(); // Nutzt die isEmpty() Funktion von SignaturePad, um zu prüfen, ob eine Unterschrift geleistet wurde
    const agbsChecked = document.getElementById('agbs').checked;
    const dsgvoChecked = document.getElementById('dsgvo').checked;

    // Überprüfe, ob eine Unterschrift geleistet wurde
    if (signatureCanvas) {
        alert('Bitte leisten Sie Ihre Unterschrift.');
        isValid = false;
    }

    if (!agbsChecked) {
        alert('Bitte stimmen Sie den Allgemeinen Geschäftsbedingungen zu.');
        isValid = false;
    }

    if (!dsgvoChecked) {
        alert('Bitte stimmen Sie der Datenschutzerklärung zu.');
        isValid = false;
    }

    return isValid;
}

