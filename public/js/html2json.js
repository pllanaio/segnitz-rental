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
                    elementData.value = element.checked ?
                        'on' :
                        'off';
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
        //console.log("JSON-Datei erfolgreich generiert");
        //console.log(jsonStr);

        // Senden der Daten aus dem html-body
        fetch('/data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: jsonStr
        })
            .then(response => response.json())
            .then(async data => {
                const response = await fetch(data.pdfUrl);
                if (!data.pdfUrl) {
                    throw new Error('Keine PDF URL vom Server erhalten');
                }
                const blob = await response.blob();

                const downloadUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');

                link.href = downloadUrl;
                link.download = data.pdfUrl.split('/').pop();
                document.body.appendChild(link);
                link.click();

                document.body.removeChild(link);
                URL.revokeObjectURL(downloadUrl);
            })
            .catch(error => {
                console.error('Fehler beim PDF-Download:', error);
                // ❗ HIER rein
                const submitBtn = document.getElementById('submit-btn');
                if (submitBtn) {
                    submitBtn.disabled = false;
                }

                alert('Fehler beim Erstellen oder Download der PDF.');
            });
    });