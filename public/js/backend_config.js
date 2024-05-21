document.addEventListener('DOMContentLoaded', function() {
    var select = document.getElementById("DBType");
    var selectedOptionsContainer = document.getElementById("selectedOptionsContainer");
    var addButton = document.getElementById("addButton");
    var inputField = inputGroup.querySelector('input');
    var form = document.getElementById('form-wrapper');

    form.addEventListener('submit', function(event) {
        event.preventDefault(); // Verhindert das Formular-Submit
        var inputValue = document.querySelector('#inputGroup input').value.trim();
        if (inputValue) {
            addNewItem(inputValue);
        } else {
            alert('Bitte geben Sie einen Wert ein!');
        }
    });

    select.addEventListener('change', function() {
        if (this.value) {
            inputGroup.style.display = 'flex'; // Zeige das Eingabefeld an
            inputGroup.style.width = '100%'
        } else {
            inputGroup.style.display = 'none'; // Verstecke das Eingabefeld
        }
        updateSelectedOptions(this.value); // Aktualisiere die Optionen wie zuvor
    });

    addButton.addEventListener('click', function() {
        var inputValue = inputField.value.trim();
        if (!inputValue) {
            alert('Bitte geben Sie einen Wert ein!');
            return;
        }
        addNewItem(inputValue);
    });

    function addNewItem(item) {
        var selectedDB = select.value;
        var endpoint = selectedDB === 'material' ? '/add-material' : '/add-worker';
        fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: item })
        })
        .then(response => {
            if (response.ok) {
                alert('Eintrag erfolgreich hinzugefügt');
                updateSelectedOptions(selectedDB); // Refresh the options
                inputField.value = ''; // Clear the input field
            } else {
                alert('Fehler beim Hinzufügen des Eintrags');
            }
        })
        .catch(error => {
            console.error('Fehler beim Hinzufügen des Eintrags:', error);
            alert('Fehler beim Hinzufügen des Eintrags');
        });
    }

    function updateSelectedOptions(selectedValue) {
    selectedOptionsContainer.innerHTML = ''; // Clear previous options
    var itemCountSpan = document.getElementById('itemCount'); // Element für die Anzeige der Anzahl

    if (selectedValue === "material") {
        fetch('/materials')
        .then(response => response.json())
        .then(materialData => {
            console.log('Materialoptionen aus der Datenbank:', materialData);
            itemCountSpan.textContent = materialData.length; // Aktualisiert die Anzahl der Einträge
            materialData.forEach(material => {
                var buttonGroup = createButtonGroup(material);
                selectedOptionsContainer.appendChild(buttonGroup);
                selectedOptionsContainer.appendChild(document.createElement('br'));
            });
        })
        .catch(error => {
            console.error('Fehler beim Abrufen der Materialdaten:', error);
            selectedOptionsContainer.textContent = 'Fehler beim Abrufen der Materialdaten';
            itemCountSpan.textContent = '0'; // Zurücksetzen auf 0 bei einem Fehler
        });
    } else if (selectedValue === "monteure") {
        fetch('/workers')
        .then(response => response.json())
        .then(workData => {
            console.log('Monteuroptionen aus der Datenbank:', workData);
            itemCountSpan.textContent = workData.length; // Aktualisiert die Anzahl der Einträge
            workData.forEach(worker => {
                var buttonGroup = createButtonGroup(worker);
                selectedOptionsContainer.appendChild(buttonGroup);
                selectedOptionsContainer.appendChild(document.createElement('br'));
            });
        })
        .catch(error => {
            console.error('Fehler beim Abrufen der Monteurdaten:', error);
            selectedOptionsContainer.textContent = 'Fehler beim Abrufen der Monteurdaten';
            itemCountSpan.textContent = '0'; // Zurücksetzen auf 0 bei einem Fehler
        });
    }
}

    function createButtonGroup(item) {
        var div = document.createElement('div');
        div.className = 'btn-group d-flex';
        div.style.width = '100%'; // Setzt die Breite der Button-Group auf 100%

        var button = document.createElement('button');
        button.className = 'btn btn-primary';
        button.style.width = '75%'; // Setzt die Breite des Hauptbuttons auf 75%
        button.textContent = item;

        var deleteButton = document.createElement('button');
        deleteButton.className = 'btn btn-danger';
        deleteButton.style.width = '25%'; // Setzt die Breite des Löschbuttons auf 25%
        deleteButton.textContent = 'Löschen';
        deleteButton.addEventListener('click', function(event) {
            event.preventDefault();
            deleteItem(item);
        });

        div.appendChild(button);
        div.appendChild(deleteButton);

        return div;
    }

    function deleteItem(item) {
        var selectedValue = select.value;
        var endpoint = selectedValue === 'material' ? '/delete-material' : '/delete-worker';
        fetch(endpoint, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: item })
        })
        .then(response => {
            if (response.ok) {
                alert('Eintrag erfolgreich gelöscht');
                updateSelectedOptions(selectedValue); // Refresh the options
            } else {
                alert('Fehler beim Löschen des Eintrags');
            }
        })
        .catch(error => {
            console.error('Fehler beim Löschen des Eintrags:', error);
            alert('Fehler beim Löschen des Eintrags');
        });
    }
});