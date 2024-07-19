document.addEventListener('DOMContentLoaded', function () {

    // Definiere das Array der verfügbaren Materialien
    var availableOptionsMaterial = [];

    // Laden der Materialoptionen aus der Datenbank
    fetch('/materials')
        .then(response => response.json())
        .then(materialOptions => {
            // Hier kannst du die Materialoptionen verwenden
            //console.log('Materialoptionen aus der Datenbank:', materialOptions);
            // Füge die Materialoptionen in das Array availableOptionsMaterial ein
            availableOptionsMaterial.push(...materialOptions);

            // Rufe die Funktion zum Hinzufügen der Dropdown-Menüs auf
            addDropdownMenus();
            updateMaterialDropdowns(); // Initial call to set up the dropdowns
        });

    // Funktion zum Hinzufügen der Dropdown-Menüs
    function addDropdownMenus() {
        // Event Listener für Klicken auf den Button zum Hinzufügen eines Materials
        document
            .querySelector('.add_material')
            .addEventListener('click', add_material);

        // Event Listener für Klicken auf den Button zum Entfernen eines Materials
        document
            .querySelector('.remove_material')
            .addEventListener('click', remove_material);
    }

    // Funktion zum Hinzufügen eines Materialfelds
    function add_material() {
        var total_material = document.getElementById('total_material');
        var current_material_no = parseInt(total_material.value);

        // Limit the number of material inputs to a maximum of 10
        if (current_material_no >= 10) {
            alert('Maximum an Materialfeldern erreicht');
            return; // Stop the function if the limit is reached
        }

        // Find the container div
        var material_count_div = document.getElementById('material_count');

        // Create the input group div
        var input_group_div = document.createElement('div');
        input_group_div.className = 'input-group mb-3';

        // Create the text input element for quantity
        var new_input = document.createElement('input');
        new_input.type = 'text';
        new_input.className = 'form-control';
        new_input.placeholder = 'Anzahl'; // Placeholder text
        new_input.setAttribute('aria-label', 'Anzahl'); // ARIA label
        new_input.name = 'material_' + current_material_no; // Name attribute
        new_input.id = 'material_' + current_material_no; // ID attribute

        // Create the select element for materials
        var new_select = document.createElement('select');
        new_select.className = 'form-select';
        new_select.setAttribute('aria-label', 'Dropdown-Menü'); // ARIA label
        new_select.name = 'material_dropdown_' + current_material_no; // Name attribute
        new_select.id = 'material_dropdown_' + current_material_no; // ID attribute

        // Create and append the default option (disabled placeholder)
        var default_option = document.createElement('option');
        default_option.text = 'Material auswählen...';
        default_option.setAttribute('disabled', true);
        default_option.setAttribute('selected', true);
        default_option.setAttribute('hidden', true);
        new_select.appendChild(default_option);

        // Create and append the available options
        availableOptionsMaterial.forEach(function (option) {
            var option_element = document.createElement('option');
            option_element.value = option; // Value attribute
            option_element.text = option;
            new_select.appendChild(option_element);
        });

        // Create the text input element for price
        var new_price = document.createElement('input');
        new_price.type = 'text';
        new_price.className = 'form-control';
        new_price.placeholder = 'Preis (€)'; // Placeholder text
        new_price.setAttribute('aria-label', 'Preis (€)'); // ARIA label
        new_price.name = 'material_price_' + current_material_no; // Name attribute
        new_price.id = 'material_price_' + current_material_no; // ID attribute

        // Append the input and select to the input group div
        input_group_div.appendChild(new_input);
        input_group_div.appendChild(new_select);
        input_group_div.appendChild(new_price);

        // Create a hidden input for combined data
        var combined_input = document.createElement('input');
        combined_input.type = 'hidden';
        combined_input.name = 'material_combined_' +
                current_material_no;
        combined_input.id = 'material_combined_' + current_material_no;
        input_group_div.appendChild(combined_input);

        // Create a line break element
        var br = document.createElement('br');

        // Append the input group and line break to the container
        material_count_div.appendChild(input_group_div);
        material_count_div.appendChild(br);

        // Update the total number of material inputs
        total_material.value = current_material_no + 1;

        // Add event listeners to input and select fields to update combined input
        new_input.addEventListener('input', update_combined);
        new_select.addEventListener('change', update_combined);
        new_price.addEventListener('input', update_combined);

        // Attach updateMaterialDropdowns to the click event of new input and select elements
        new_input.addEventListener('click', updateMaterialDropdowns);
        new_select.addEventListener('click', updateMaterialDropdowns);
        new_price.addEventListener('click', updateMaterialDropdowns);

        // Call updateMaterialDropdowns after adding a new material field
        updateMaterialDropdowns();

        // Function to update combined input field
        function update_combined() {
            combined_input.value = new_input.value + ' Stück - ' + new_select
                .options[new_select.selectedIndex]
                .text + ' - ' + new_price.value + ' €';
            //console.log(combined_input.value);  Output the updated value to the console
        }
    }

    // Funktion zum Entfernen eines Materialfelds
    function remove_material() {
        var total_material = document.getElementById('total_material');
        var last_material_no = parseInt(total_material.value);

        if (last_material_no > 1) {
            var containerToRemove = document
                .getElementById('material_' + (
                    last_material_no - 1
                ))
                .parentNode;

            if (containerToRemove) {
                // Remove the preceding <br> element
                var brToRemove = containerToRemove.previousElementSibling;
                if (brToRemove && brToRemove.tagName.toLowerCase() === 'br') {
                    brToRemove
                        .parentNode
                        .removeChild(brToRemove);
                }

                containerToRemove
                    .parentNode
                    .removeChild(containerToRemove);

                total_material.value = last_material_no - 1;
            }
        }
        // Wenn es nur noch ein Materialfeld gibt, das erste Feld entfernen
        if (last_material_no === 1) {
            var firstMaterialField = document
                .getElementById('material_0')
                .parentNode;
            if (firstMaterialField) {
                var brToRemove = firstMaterialField.previousElementSibling;
                if (brToRemove && brToRemove.tagName.toLowerCase() === 'br') {
                    brToRemove
                        .parentNode
                        .removeChild(brToRemove);
                }
                firstMaterialField
                    .parentNode
                    .removeChild(firstMaterialField);
            }
        }

        // Call updateMaterialDropdowns after removing a material field
        updateMaterialDropdowns();
    }

    function updateMaterialDropdowns() {
        const selectedMaterials = [];
        const totalMaterial = parseInt(document.getElementById('total_material').value);
    
        for (let i = 0; i < totalMaterial; i++) {
            const select = document.getElementById('material_dropdown_' + i);
            if (select && select.value !== 'Material auswählen...') {
                selectedMaterials.push(select.value);
            }
        }
    
        for (let i = 0; i < totalMaterial; i++) {
            const select = document.getElementById('material_dropdown_' + i);
            if (select) {
                const currentValue = select.value;
                select.innerHTML = ''; // Clear existing options
    
                // Create and append the default option
                const defaultOption = document.createElement('option');
                defaultOption.text = 'Material auswählen...';
                defaultOption.disabled = true;
                defaultOption.selected = true;
                defaultOption.hidden = true;
                select.appendChild(defaultOption);
    
                // Create and append the available options
                availableOptionsMaterial.forEach(function (option) {
                    if (!selectedMaterials.includes(option) || option === currentValue) {
                        const optionElement = document.createElement('option');
                        optionElement.value = option;
                        optionElement.text = option;
                        select.appendChild(optionElement);
                    }
                });
    
                select.value = currentValue; // Set the current value back
            }
        }
    }
});
