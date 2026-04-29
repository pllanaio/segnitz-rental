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
        //console.log("Unterschrift erfolgreich generiert");
        //console.log(dataURL);
    } else {
        console.log("Keine Bildübertragung erfolgt");
    }
}

nextBtn.addEventListener('click', () => {

    // Check if current step is valid before moving to next
    let isValid = true;
    switch (current_step) {
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
    // Stelle sicher, dass alle Validierungen bestanden sind, bevor das Formular
    // abgesendet wird
    let signatureValid = validateStep8(); // Diese Funktion überprüft die Unterschrift und Zustimmungen

    if (!signatureValid) {
        event.preventDefault(); // Verhindere das Absenden des Formulars
    } else {
        preloader
            .classList
            .add('d-block'); // Zeige den Ladebildschirm an, falls alles gültig ist
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
    const recipient = document
        .querySelector('textarea[name="Recipient"]')
        .value;
    const client = document
        .querySelector('textarea[name="Client"]')
        .value;
    const ownerChecked = document
        .getElementById('Owner')
        .checked;
    const renterChecked = document
        .getElementById('Renter')
        .checked;
    const otherRelatedChecked = document
        .getElementById('other_related')
        .checked;


    // Überprüfung der Texteingaben auf ungültige Zeichen
    if (!recipient || !client) {
        alert('Keine Leeren Felder erlaubt');
        isValid = false;
    } else if (!ownerChecked && !renterChecked && !otherRelatedChecked) {
        alert(
            'Bitte wählen Sie mindestens eine Option (Eigentümer, Mieter, Objektangehöriger' +
            ').'
        );
        isValid = false;
    }

    return isValid;
}

function validateStep2() {
    let isValid = true;
    const orderType = document
        .querySelector('select[name="OrderType"]')
        .value;

    if (orderType === "" || orderType === "Auftragsart auswählen...") {
        alert('Bitte eine Auftragsart auswählen');
        isValid = false;
    }
    return isValid;
}

function validateStep3() {
    let isValid = true;
    const orderNo = document
        .querySelector('input[name="OrderNo"]')
        .value;
    const clientNo = document
        .querySelector('input[name="ClientNo"]')
        .value;
    const workToDo = document
        .querySelector('input[name="WorkToDo"]')
        .value;
    const workerSelected = document
        .querySelector('select[name="Worker"]')
        .value;

    // Überprüfung, ob die Felder für Auftragsnummer und Kundennummer gefüllt sind
    if (!workToDo) {
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
    const dateTimePickerInput = document
        .querySelector(
            'input[name="DateTimePickerInput"]'
        )
        .value;
    const workReport = document
        .querySelector('textarea[name="WorkReport"]')
        .value;

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
    const totalWork = parseInt(document.getElementById('total_work').value);
    const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;

    for (let i = 0; i < totalWork; i++) {
        const workInput = document.getElementById('work_' + i);
        const workSelect = document.getElementById('work_dropdown_' + i);
        const workDate = document.getElementById('work_date_' + i);

        // Überprüfung des Datumsfeldes
        if (!workDate.value || !dateRegex.test(workDate.value)) {
            alert('Bitte geben Sie ein gültiges Datum im Format TT.MM.JJJJ in das Datumsfeld ' + (i + 1) + ' ein.');
            isValid = false;
            break;
        } else {
            const [day, month, year] = workDate.value.split('.').map(Number);
            if (day < 1 || day > 31 || month < 1 || month > 12 || year > 9999) {
                alert('Bitte geben Sie ein gültiges Datum im Format TT.MM.JJJJ in das Datumsfeld ' + (i + 1) + ' ein.');
                isValid = false;
                break;
            }
        }

        // Überprüfung, ob im Dropdown noch "Monteur auswählen" ausgewählt ist
        if (workSelect.value === 'Monteur auswählen...') {
            alert('Bitte wählen Sie einen Monteur für das Monteursfeld ' + (i + 1) + '.');
            isValid = false;
            break;
        }
        
        // Überprüfung, ob das Eingabefeld leer ist oder keine Zahl enthält
        if (!workInput.value || isNaN(workInput.value) || workInput.value == "0") {
            alert('Bitte geben Sie eine gültige Stundenanzahl in das Monteursfeld ' + (i + 1) + ' ein.');
            isValid = false;
            break;
        }
    }

    return isValid;
}

function validateStep6() {
    let isValid = true;
    const totalMaterial = parseInt(document.getElementById('total_material').value);

    for (let i = 0; i < totalMaterial; i++) {
        const materialInput = document.getElementById('material_' + i);
        const materialSelect = document.getElementById('material_dropdown_' + i);
        const materialPrice = document.getElementById('material_price_' + i); // Assuming the IDs are 'material_price_0', 'material_price_1', etc.

        // Überprüfung, ob das Eingabefeld leer ist oder keine Zahl enthält
        if (!materialInput.value || isNaN(materialInput.value) || materialInput.value == "0") {
            alert('Bitte geben Sie eine gültige Zahl in das Materialfeld ' + (i + 1) + ' ein.');
            isValid = false;
            break;
        }

        // Überprüfung, ob im Dropdown noch "Material auswählen" ausgewählt ist
        if (materialSelect.value === 'Material auswählen...') {
            alert('Bitte wählen Sie ein Material für das Materialfeld ' + (i + 1) + '.');
            isValid = false;
            break;
        }

        // Überprüfung, ob das material_price-Feld nur Zahlen enthält oder leer ist
        if (materialPrice.value && isNaN(parseFloat(materialPrice.value))) {
            alert('Das Feld "Materialpreis" für Materialfeld ' + (i + 1) + ' darf nur Zahlen enthalten oder leer sein.');
            isValid = false;
            break;
        }
    }

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
    const CarProvisionFee = document.getElementById ('CarProvisionFee');
    const kfz_pauschale = document.getElementById ('kfz_pauschale');

    // Prüfe, ob die zugehörigen Textfelder ausgefüllt sind, wenn die Checkboxen
    // aktiviert sind
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
    if (CarProvisionFee.checked && !kfz_pauschale.value.trim()){
        alert('Bitte geben Sie Details zur Kfz-Bereitstellung an.');
        isValid = false;
    }
    return isValid;
}

function validateStep8() {
    let isValid = true;
    const signatureCanvas = signaturePad.isEmpty(); // Nutzt die isEmpty() Funktion von SignaturePad, um zu prüfen, ob eine Unterschrift geleistet wurde
    const agbsChecked = document
        .getElementById('agbs')
        .checked;
    const dsgvoChecked = document
        .getElementById('dsgvo')
        .checked;

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

function logout() {
    fetch('/logout', {method: 'POST'})
        .then(response => {
            if (response.ok) {
                // Optional: Weiterleitung zur Login-Seite oder Anzeige einer Bestätigung
                window.location.href = '/index.html';
            } else {
                console.error('Fehler beim Logout');
                alert('Fehler beim Abmelden');
            }
        })
        .catch(error => {
            console.error('Netzwerkfehler beim Versuch, sich abzumelden:', error);
        });
}

// ==========================
// AUTH STATUS HANDLING
// ==========================
document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById('admin-button');
    const loginStatus = document.getElementById('login-status');
    const logoutBtn = document.getElementById('logout-button');

    // Falls Seite kein Login-Bereich hat (z.B. backend.html), einfach abbrechen
    if (!btn || !loginStatus || !logoutBtn) return;

    fetch('/auth-status')
        .then(res => res.json())
        .then(data => {
            if (data.loggedIn && data.role === 'global_admin') {
                // Button → Konfiguration
                btn.href = '/backend.html';
                btn.querySelector('button').innerHTML =
                    '<i class="bi bi-gear"></i> Konfiguration';
                logoutBtn.style.display = 'inline-block';
                loginStatus.textContent = `Angemeldet als: ${data.user}`;
            } else if (data.loggedIn) {
                btn.href = '#';
                btn.querySelector('button').innerHTML =
                    '<i class="bi bi-person-check"></i> Eingeloggt';

                logoutBtn.style.display = 'inline-block';
                loginStatus.textContent = `Angemeldet als: ${data.user}`;
                // Logout anzeigen
                logoutBtn.style.display = 'inline-block';

                // User anzeigen
                loginStatus.textContent = `Angemeldet als: ${data.user}`;
            } else {
                btn.href = '/login.html';
                btn.querySelector('button').innerHTML =
                    '<i class="bi bi-person-lock"></i> Login';

                logoutBtn.style.display = 'none';
                loginStatus.textContent = 'Kein Benutzer angemeldet';
            }
        })
        .catch(err => {
            console.error('Auth-Status Fehler:', err);
        });
});