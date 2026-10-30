const HTML_ESCAPE_ENTITIES = Object.freeze({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;'
});

// React escapes rendered text itself. This helper remains for the few places that
// build strings outside of JSX (downloads, document titles, compatibility APIs).
export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"'`]/g, character => HTML_ESCAPE_ENTITIES[character]);
}
