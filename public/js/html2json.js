document.getElementById('form-wrapper').addEventListener('submit', function(event) {
  event.preventDefault(); // Verhindert die normale Formularübermittlung

  var jsonObject = { form: [] };

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
          const elementData = { name: element.name, value: element.value };
          if (element.type === 'checkbox' || element.type === 'radio') {
              elementData.checked = element.checked;
          }
          stepData.elements.push(elementData);
      });

      jsonObject.form.push(stepData);
  }

  // Konvertieren des JSON-Objekts in einen String und Ausgabe
  var jsonStr = JSON.stringify(jsonObject, null, 2);
  console.log("Erweiterte JSON-Datei erfolgreich generiert:");

  // Senden der Daten
  fetch('/data', {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
      },
      body: jsonStr,
  })
  .then(response => response.json())
  .then(data => console.log(data.message))
  .catch((error) => console.error('Fehler:', error));
});