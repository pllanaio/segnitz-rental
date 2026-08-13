'use strict';

const HTML_ESCAPE_ENTITIES = Object.freeze({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;'
});

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"'`]/g, character => HTML_ESCAPE_ENTITIES[character]);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml };
}
