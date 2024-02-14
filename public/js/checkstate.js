$(document).ready(function () {

        var maschineneinsatz_check_element = document.getElementById('maschineneinsatz_check');
        var maschineneinsatz_textfield_element = document.getElementById(
            'maschineneinsatz_textfield'
        );
        var entsorgung_check_element = document.getElementById('entsorgung_check');
        var entsorgung_textfield_element = document.getElementById(
            'entsorgung_textfield'
        );
        var work_check_element = document.getElementById('work_check');
        var work_textfield_element = document.getElementById('work_textfield');
        maschineneinsatz_check_element.addEventListener('change', function () {
            maschineneinsatz_textfield_element.disabled = !maschineneinsatz_check_element.checked;
        });
        entsorgung_check_element.addEventListener('change', function () {
            entsorgung_textfield_element.disabled = !entsorgung_check_element.checked;
        });
        work_check_element.addEventListener('change', function () {
            work_textfield_element.disabled = !work_check_element.checked;
        });
});