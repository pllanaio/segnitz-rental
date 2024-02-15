$(document).ready(function () {
    $('.add_work').on('click', add_work);
    $('.remove_work').on('click', remove_work);
    function add_work() {
        var new_work_no = parseInt($('#total_work').val()) + 1;
        var new_input = "<input type='text' name= 'new_work_" + new_work_no + "' id='new_work_" + new_work_no + "' class='fo" +
                "rm-control' placeholder='Datum , Name, Arbeitsstunden'><br>";
        $('#new_work').append(new_input);
        $('#total_work').val(new_work_no);
    }
    function remove_work() {
        var last_work_no = $('#total_work').val();
        if (last_work_no > 1) {
            $('#new_work_' + last_work_no).remove();
            $('#total_work').val(last_work_no - 1);
        }
    }
});