document.addEventListener('DOMContentLoaded', function () {
    document
        .querySelector('.add_work')
        .addEventListener('click', add_work);
    document
        .querySelector('.remove_work')
        .addEventListener('click', remove_work);

    // Array mit Auswahlmöglichkeiten
    var options = ['Reiner Nather', 'Andreas Rölz', 'Horst Rölz', 'Thomas Hörenz', 'Jeff Hörenz']; // Füge hier deine eigenen Auswahlmöglichkeiten hinzu

    // Setze die Optionen für das erste select-Feld
   /* var first_select = document.getElementById("work_dropdown_0")
    options.forEach(function (optionText) {
        var option = document.createElement('option');
        option.text = optionText;
        first_select.appendChild(option);
     });*/

    function add_work() {
        var total_work = document.getElementById('total_work');
        var current_work_no = parseInt(total_work.value);

        // Check if the maximum limit of 10 work input fields has been reached
        if (current_work_no >= 10) {
            alert('Maximum of 10 work input fields reached.');
            return; // Prevent adding more than 10 input fields
        }

        // Find the container div
        var work_count_div = document.getElementById('work_count');

        // Create the input group div
        var input_group_div = document.createElement('div');
        input_group_div.className = 'input-group';

        // Create the text input element
        var new_input = document.createElement('input');
        new_input.type = 'text';
        new_input.className = 'form-control';
        new_input.placeholder = 'Stunden'; // Placeholder text
        new_input.setAttribute('aria-label', 'Stunden'); // ARIA label
        new_input.name = 'work_' + current_work_no; // Name attribute
        new_input.id = 'work_' + current_work_no; // ID attribute

        // Create the select element
        var new_select = document.createElement('select');
        new_select.className = 'form-select';
        new_select.setAttribute('aria-label', 'Dropdown-Menü'); // ARIA label
        new_select.name = 'work_dropdown_' + current_work_no; // Name attribute
        new_select.id = 'work_dropdown_' + current_work_no; // ID attribute

        // Create and append the default option (disabled placeholder)
        var default_option = document.createElement('option');
        default_option.text = 'Monteur auswählen...';
        default_option.setAttribute('disabled', true);
        default_option.setAttribute('selected', true);
        default_option.setAttribute('hidden', true);
        new_select.appendChild(default_option);

        // Iterate over the options array and create options for the select element
        options.forEach(function (optionText) {
            var option = document.createElement('option');
            option.text = optionText;
            new_select.appendChild(option);
        });

        // Append the input and select to the input group div
        input_group_div.appendChild(new_input);
        input_group_div.appendChild(new_select);

        // Create a hidden input for combined data
        var combined_input = document.createElement('input');
        combined_input.type = 'hidden';
        combined_input.name = 'work_combined_' + current_work_no;
        combined_input.id = 'work_combined_' + current_work_no;
        input_group_div.appendChild(combined_input);

        // Output the value of the combined field to the console
        console.log(combined_input.value);

        // Create a line break element
        var br = document.createElement('br');

        // Append the input group and line break to the container
        work_count_div.appendChild(input_group_div);
        work_count_div.appendChild(br);

        // Update the total number of Work inputs
        total_work.value = current_work_no + 1;

        // Add event listener to input and select fields to update combined input
        new_input.addEventListener('input', update_combined);
        new_select.addEventListener('change', update_combined);

        // Function to update combined input field
        function update_combined() {
            combined_input.value = new_input.value + ' Arbeitsstunden - ' +
                    new_select
                .options[new_select.selectedIndex]
                .text;
            console.log(combined_input.value); // Output the updated value to the console
        }
    }

    // Funktion zum Entfernen eines Workfelds
    function remove_work() {
        var total_work = document.getElementById('total_work');
        var last_work_no = parseInt(total_work.value);

        if (last_work_no > 1) {
            var containerToRemove = document
                .getElementById('work_' + (
                    last_work_no - 1
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

                total_work.value = last_work_no - 1;
            }
        } else {
            alert('Das erste Eingabefeld kann nicht entfernt werden.');
        }
    }
});