new tempusDominus.TempusDominus(document.getElementById('DateTimePicker'), {
    display: {
        icons: {
            type: 'icons',
            time: 'bi bi-clock',
            date: 'bi bi-calendar-week',
            up: 'bi bi-arrow-up',
            down: 'bi bi-arrow-down',
            previous: 'bi bi-chevron-left',
            next: 'bi bi-chevron-right'
        }
    },
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
