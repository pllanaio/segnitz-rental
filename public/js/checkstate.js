document.addEventListener('DOMContentLoaded', function () {
    var MachineUsageCheckElement = document.getElementById('MachineUsageCheck');
    var MachineUsageTextfieldElement = document.getElementById('MachineUsageTextfield');
    var DisposeCheckElement = document.getElementById('DisposeCheck');
    var DisposeTextfieldElement = document.getElementById('DisposeTextfield');
    var WorkCheckElement = document.getElementById('WorkCheck');
    var WorkTextfield = document.getElementById('WorkTextfield');
    var RenterCheck = document.getElementById('Renter');
    var OwnerCheck = document.getElementById('Owner');
    var other_relatedCheck = document.getElementById('other_related');

    MachineUsageCheckElement.addEventListener('change', function () {
        MachineUsageTextfieldElement.disabled = !MachineUsageCheckElement.checked;
    });

    DisposeCheckElement.addEventListener('change', function () {
        DisposeTextfieldElement.disabled = !DisposeCheckElement.checked;
    });

    WorkCheckElement.addEventListener('change', function () {
        WorkTextfield.disabled = !WorkCheckElement.checked;
    });


    // Event listener for Renter checkbox
    RenterCheck.addEventListener('change', function () {
        if (RenterCheck.checked) {
            // Disable other checkboxes
            OwnerCheck.checked = false;
            other_relatedCheck.checked = false;
        }
    });
    
    // Event listener for Owner checkbox
    OwnerCheck.addEventListener('change', function () {
        if (OwnerCheck.checked) {
            // Disable other checkboxes
            RenterCheck.checked = false;
            other_relatedCheck.checked = false;
        }
    });
    
    // Event listener for other_related checkbox
    other_relatedCheck.addEventListener('change', function () {
         if (other_relatedCheck.checked) {
            // Disable other checkboxes
            RenterCheck.checked = false;
            OwnerCheck.checked = false;
        }
    });

});