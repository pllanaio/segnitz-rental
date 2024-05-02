document.addEventListener('DOMContentLoaded', function () {
// Array der verfügbaren Materialien
var availableOptions = ['Öldüse', 'Ölfilter', 'Röhrensyphon lang', 'Eckventil', 'Doppelspindelventil', 'Schwimmerventil', 'Spülventil', 'Spezialsägeblatt', 'Füllwasser nach VDI2035', 'Innenoberteil ½"', 'Innenoberteil ¾“','Schrägsitzventiloberteil ½"', 'Schrägsitzventiloberteil ¾"','Schrägsitzventiloberteil 1"', 'Auslaufhahn ½"'];

// Event Listener für Klicken auf den Button zum Hinzufügen eines Materials
document.querySelector('.add_material').addEventListener('click', add_material);

// Event Listener für Klicken auf den Button zum Entfernen eines Materials
document.querySelector('.remove_material').addEventListener('click', remove_material);



    // Funktion zum Hinzufügen eines Materialfelds
    function add_material() {
        var total_material = document.getElementById('total_material');
        var current_material_no = parseInt(total_material.value);

        // Limit the number of material inputs to a maximum of 10
        if (current_material_no >= 10) {
            alert('Maximum of 10 material input fields reached.');
            return; // Stop the function if the limit is reached
        }

        // Find the container div
        var material_count_div = document.getElementById('material_count');

        // Create the input group div
        var input_group_div = document.createElement('div');
        input_group_div.className = 'input-group';

        // Create the text input element
        var new_input = document.createElement('input');
        new_input.type = 'text';
        new_input.className = 'form-control';
        new_input.placeholder = 'Anzahl'; // Placeholder text
        new_input.setAttribute('aria-label', 'Anzahl'); // ARIA label
        new_input.name = 'new_material_' + current_material_no; // Name attribute
        new_input.id = 'new_material_' + current_material_no; // ID attribute

        // Create the select element
        var new_select = document.createElement('select');
        new_select.className = 'form-select';
        new_select.setAttribute('aria-label', 'Dropdown-Menü'); // ARIA label

        // Create and append the default option (disabled placeholder)
        var default_option = document.createElement('option');
        default_option.text = 'Material auswählen...';
        default_option.setAttribute('disabled', true);
        default_option.setAttribute('selected', true);
        default_option.setAttribute('hidden', true);
        new_select.appendChild(default_option);

        // Create and append the available options
        availableOptions.forEach(function(option) {
            var option_element = document.createElement('option');
            option_element.value = option; // Value attribute
            option_element.text = option;
            new_select.appendChild(option_element);
        });

        // Append the input and select to the input group div
        input_group_div.appendChild(new_input);
        input_group_div.appendChild(new_select);

        // Create a line break element
        var br = document.createElement('br');

        // Append the input group and line break to the container
        material_count_div.appendChild(input_group_div);
        material_count_div.appendChild(br);

        // Update the total number of material inputs
        total_material.value = current_material_no + 1;
    }

    // Funktion zum Entfernen eines Materialfelds
    function remove_material() {
        var total_material = document.getElementById('total_material');
        var last_material_no = parseInt(total_material.value);

        if (last_material_no > 1) {
            var containerToRemove = document.getElementById('new_material_' + (last_material_no - 1)).parentNode;

            if (containerToRemove) {
                // Remove the preceding <br> element
                var brToRemove = containerToRemove.previousElementSibling;
                if (brToRemove && brToRemove.tagName.toLowerCase() === 'br') {
                    brToRemove.parentNode.removeChild(brToRemove);
                }

                containerToRemove.parentNode.removeChild(containerToRemove);

                total_material.value = last_material_no - 1;
            }
        } else {
            alert('Das erste Eingabefeld kann nicht entfernt werden.');
        }
    }

        // Setze die Optionen für das erste select-Feld
        var first_select = document.getElementById("material_dropdown_0")
        availableOptions.forEach(function(option) {
            var option_element = document.createElement('option');
            option_element.value = option; // Value attribute
            option_element.text = option;
            first_select.appendChild(option_element);
        });
});