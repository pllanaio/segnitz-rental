document.addEventListener('DOMContentLoaded', function () {
    var MachineUsageCheckElement = document.getElementById('MachineUsageCheck');
    var MachineUsageTextfieldElement = document.getElementById('MachineUsageTextfield');
    var DisposeCheckElement = document.getElementById('DisposeCheck');
    var DisposeTextfieldElement = document.getElementById('DisposeTextfield');
    var WorkCheckElement = document.getElementById('WorkCheck');
    var WorkTextfield = document.getElementById('WorkTextfield');

    MachineUsageCheckElement.addEventListener('change', function () {
        MachineUsageTextfieldElement.disabled = !MachineUsageCheckElement.checked;
    });

    DisposeCheckElement.addEventListener('change', function () {
        DisposeTextfieldElement.disabled = !DisposeCheckElement.checked;
    });

    WorkCheckElement.addEventListener('change', function () {
        WorkTextfield.disabled = !WorkCheckElement.checked;
    });
});