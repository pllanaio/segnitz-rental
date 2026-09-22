(function (root) {
    'use strict';
    const pending = new WeakSet();
    async function run(element, callback) {
        if (!element || pending.has(element)) return;
        pending.add(element);
        const controls = element.tagName === 'FORM' ? [...element.querySelectorAll('[type="submit"]')] : [element];
        const prior = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        element.setAttribute('aria-busy', 'true');
        try { return await callback(); }
        catch { root.showAlert?.('Die Aktion konnte nicht abgeschlossen werden. Bitte erneut versuchen.', 'danger'); }
        finally {
            pending.delete(element);
            element.removeAttribute('aria-busy');
            controls.forEach((control, index) => { control.disabled = prior[index]; });
        }
    }
    function bindForm(form, callback) {
        form?.addEventListener('submit', event => { event.preventDefault(); return run(form, () => callback(event)); });
    }
    function bindClick(button, callback) {
        button?.addEventListener('click', event => run(button, () => callback(event)));
    }
    const api = Object.freeze({ run, bindForm, bindClick });
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PendingActions = api;
})(typeof window === 'object' ? window : globalThis);
