// Bootstrap's JavaScript (same 5.1.3 release the plain-JS pages used) is loaded
// only in the browser. Importing it registers Bootstrap's data API
// (data-bs-toggle, data-bs-dismiss, carousels) on the document.
let bootstrapModule = null;
// Modals whose fade-in finished. Bootstrap ignores hide() during the transition.
const shownModals = new WeakSet();

export function getBootstrap() {
    if (typeof window === 'undefined') return null;
    if (!bootstrapModule) {
        // eslint-disable-next-line global-require
        bootstrapModule = require('bootstrap/dist/js/bootstrap.bundle.js');
        window.bootstrap = bootstrapModule;
        document.addEventListener('shown.bs.modal', event => shownModals.add(event.target));
        document.addEventListener('hide.bs.modal', event => shownModals.delete(event.target));
        document.addEventListener('hidden.bs.modal', event => shownModals.delete(event.target));
    }
    return bootstrapModule;
}

export function getModal(element, options) {
    const bootstrap = getBootstrap();
    if (!bootstrap || !element) return null;
    return bootstrap.Modal.getOrCreateInstance(element, options);
}

export function showModal(element, options) {
    getModal(element, options)?.show();
}

// Hides a modal; if it is still fading in, it is hidden right after it is shown.
export function hideModal(element) {
    const bootstrap = getBootstrap();
    if (!bootstrap || !element) return;
    const instance = bootstrap.Modal.getInstance(element);
    if (!instance) return;
    if (element.classList.contains('show') && !shownModals.has(element)) {
        element.addEventListener('shown.bs.modal', () => instance.hide(), { once: true });
        return;
    }
    instance.hide();
}

export function onModalEvent(element, eventName, handler, options) {
    if (!element) return () => {};
    element.addEventListener(eventName, handler, options);
    return () => element.removeEventListener(eventName, handler, options);
}
