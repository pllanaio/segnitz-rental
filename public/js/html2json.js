document
    .getElementById('form-wrapper')
    .addEventListener('submit', function (event) {
        event.preventDefault(); // Verhindert die normale Formularübermittlung

        var jsonObject = {
            form: []
        };

        const stepsContainer = document.getElementById('steps-container');
        const steps = stepsContainer.getElementsByClassName('step');

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const elements = step.querySelectorAll('input, select, textarea');
            const stepData = {
                step: i + 1,
                elements: [] // Ein Array für alle Elementtypen
            };

            elements.forEach(element => {
                const elementData = {
                    name: element.name,
                    value: element.value
                };
                if (element.type === 'checkbox' || element.type === 'radio') {
                    elementData.value = element.checked
                        ? 'on'
                        : 'off';
                    if (element.checked) {
                        elementData.checked = element.checked;
                    }
                }
                stepData
                    .elements
                    .push(elementData);
            });

            jsonObject
                .form
                .push(stepData);
        }

        // Konvertieren des JSON-Objekts in einen String und Ausgabe
        var jsonStr = JSON.stringify(jsonObject, null, 2);
        console.log("JSON-Datei erfolgreich generiert");
        console.log(jsonStr);

        // Senden der Daten aus dem html-body
        fetch('/data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: jsonStr
        })
            .then(response => response.json())
            .then(data => {
                // window.open(data.pdfUrl, '_blank'); Prüfen, ob der Button bereits existiert
                // let downloadButton = document.getElementById('downloadPdfButton'); if
                // (!downloadButton) { Button existiert noch nicht, also wird er erstellt
                // downloadButton = document.createElement('button');  downloadButton.id =
                // 'downloadPdfButton';  Eindeutige ID für den Button downloadButton.textContent
                // = 'PDF herunterladen';  downloadButton.className = 'btn btn-primary';
                // downloadButton.onclick = function() { fetch(data.pdfUrl)    .then(response =>
                // response.blob())    .then(blob => { saveAs(blob, 'Auftragsschein.pdf');
                // });  };
                window.location.href = data.pdfUrl;

                // const container = document.getElementById('final');
                // container.appendChild(downloadButton); }
            })
            .catch((error) => console.error('Fehler:', error));
    });