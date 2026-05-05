document
    .getElementById('form-wrapper')
    .addEventListener('submit', function (event) {
        event.preventDefault();

        const jsonObject = {
            form: []
        };

        const stepsContainer = document.getElementById('steps-container');
        const steps = stepsContainer.getElementsByClassName('step');

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const elements = step.querySelectorAll('input, select, textarea');
            const stepData = {
                step: i + 1,
                elements: []
            };

            elements.forEach(element => {
                const elementData = {
                    name: element.name,
                    value: element.value
                };

                if (element.type === 'checkbox' || element.type === 'radio') {
                    elementData.value = element.checked ? 'on' : 'off';

                    if (element.checked) {
                        elementData.checked = element.checked;
                    }
                }

                stepData.elements.push(elementData);
            });

            jsonObject.form.push(stepData);
        }

        fetch('/data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(jsonObject, null, 2)
        })
            .then(async response => {
                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(data.error || 'Der Mietauftrag konnte nicht versendet werden.');
                }

                return data;
            })
            .then(data => {
                const final = document.getElementById('final');

                if (final) {
                    final.innerHTML = `
                        <div class="alert alert-success">
                            Mietauftrag erfolgreich per E-Mail versendet.
                        </div>
                    `;
                }
            })
            .catch(error => {
                const final = document.getElementById('final');

                if (final) {
                    final.innerHTML = `
                        <div class="alert alert-danger">
                            ${error.message || 'Der Mietauftrag konnte nicht versendet werden.'}
                        </div>
                    `;
                }
            });
    });