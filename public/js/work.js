document.addEventListener('DOMContentLoaded', function () {
    document
        .querySelector('.add_work')
        .addEventListener('click', add_work);
    document
        .querySelector('.remove_work')
        .addEventListener('click', remove_work);

    function add_work() {
        var total_work = document.getElementById('total_work');
        var current_work_no = parseInt(total_work.value);

        // Check if the maximum limit of 10 work input fields has been reached
        if (current_work_no >= 10) {
            alert('Maximum of 10 work input fields reached.');
            return; // Prevent adding more than 10 input fields
        }

        var new_work_no = current_work_no + 1;
        var new_input = document.createElement('input');
        new_input.type = 'text';
        new_input.name = 'new_work_' + new_work_no;
        new_input.id = 'new_work_' + new_work_no;
        new_input.className = 'form-control';
        new_input.placeholder = 'Datum, Name, Arbeitsstunden';

        var br = document.createElement('br');
        br.id = 'br_new_work_' + new_work_no; // Assign an ID to the <br> for easier removal

        var new_work_div = document.getElementById('new_work');
        new_work_div.appendChild(new_input);
        new_work_div.appendChild(br);

        total_work.value = new_work_no;
    }

    function remove_work() {
        var total_work = document.getElementById('total_work');
        var last_work_no = total_work.value;

        if (last_work_no > 1) {
            var elementToRemove = document.getElementById(
                'new_work_' + last_work_no
            );
            var brToRemove = document.getElementById(
                'br_new_work_' + last_work_no
            ); // Get the <br> element using its ID

            if (elementToRemove) 
                elementToRemove
                    .parentNode
                    .removeChild(elementToRemove);
            if (brToRemove) 
                brToRemove
                    .parentNode
                    .removeChild(brToRemove); // Remove the <br> element
            
            total_work.value = last_work_no - 1;
        }
    }
});