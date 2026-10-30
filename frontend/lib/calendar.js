// flatpickr 4.6.13 with the German locale, bundled instead of loaded from /vendor.
let flatpickrModule = null;

function loadFlatpickr() {
    if (!flatpickrModule) {
        // eslint-disable-next-line global-require
        const flatpickr = require('flatpickr');
        flatpickrModule = flatpickr.default || flatpickr;
        // eslint-disable-next-line global-require
        const { German } = require('flatpickr/dist/l10n/de.js');
        flatpickrModule.l10ns.de = German;
    }
    return flatpickrModule;
}

export function createCalendar(target, options) {
    const flatpickr = loadFlatpickr();
    return flatpickr(target, { locale: 'de', ...options });
}

export function formatCalendarDate(date, format) {
    return loadFlatpickr().formatDate(date, format);
}
