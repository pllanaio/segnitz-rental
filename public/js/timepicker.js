window.datetimepicker = new tempusDominus.TempusDominus(document.getElementById('datetimepicker1'), {
    localization: {
        today: 'Heute',
        selectMonth: 'Monat auswählen',
        previousMonth: 'letzter Monat',
        nextMonth: 'nächster Monat',
        selectYear: 'Jahr auswählen',
        previousYear: 'letztes Jahr',
        nextYear: 'nächstes Jahr',
        selectTime: 'Zeit auswählen',
        selectDate: 'Datum auswählen',
        dayViewHeaderFormat: {
            month: 'long',
            year: '2-digit'
        },
        locale: 'default',
        startOfTheWeek: 0,
        hourCycle: 'h23',
        dateFormats: {
            LLLL: 'd.MM.yyyy HH:mm'
        },
        ordinal: (n) => n,
        format: 'LLLL'
    }
});