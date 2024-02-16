document.addEventListener('DOMContentLoaded', function () {
    document.querySelector('.add_material').addEventListener('click', add_material);
    document.querySelector('.remove_material').addEventListener('click', remove_material);

    function add_material() {
        var total_material = document.getElementById('total_material');
        var current_material_no = parseInt(total_material.value);

        // Limit the number of material inputs to a maximum of 9
        if (current_material_no >= 10) {
            alert('Maximum of 10 material input fields reached.');
            return; // Stop the function if the limit is reached
        }

        var new_material_no = current_material_no + 1;
        var new_input = document.createElement('input');
        new_input.type = 'text';
        new_input.name = 'new_material_' + new_material_no;
        new_input.id = 'new_material_' + new_material_no;
        new_input.className = 'form-control';
        new_input.placeholder = 'Anzahl, Bezeichnung, Preis';

        var br = document.createElement('br');
        br.id = 'br_new_material_' + new_material_no; // Assign an ID to the <br> for easier removal

        var new_material_div = document.getElementById('new_material');
        new_material_div.appendChild(new_input);
        new_material_div.appendChild(br); // Append the <br> for spacing

        total_material.value = new_material_no;
    }

    function remove_material() {
        var total_material = document.getElementById('total_material');
        var last_material_no = total_material.value;

        if (last_material_no > 1) {
            var elementToRemove = document.getElementById('new_material_' + last_material_no);
            var brToRemove = document.getElementById('br_new_material_' + last_material_no); // Get the <br> element using its ID

            // Remove the input field and its immediately following <br> element
            if (elementToRemove) elementToRemove.parentNode.removeChild(elementToRemove);
            if (brToRemove) brToRemove.parentNode.removeChild(brToRemove);

            total_material.value = last_material_no - 1;
        }
    }
});