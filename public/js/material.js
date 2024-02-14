$(document).ready(function () {
    $('.add_material').on('click', add_material);
    $('.remove_material').on('click', remove_material);
    function add_material() {
        var new_material_no = parseInt($('#total_material').val()) + 1;
        var new_input = "<input type='text' id='new_material_" +
                new_material_no + "' class='form-control' placeholder='Anzahl, Bezeichnung, Pre" +
                "is'><br>";

        $('#new_material').append(new_input);

        $('#total_material').val(new_material_no);
    }
    function remove_material() {
        var last_material_no = $('#total_material').val();

        if (last_material_no > 1) {
            $('#new_material_' + last_material_no).remove();
            $('#total_material').val(last_material_no - 1);
        }
    }
});