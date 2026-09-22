'use strict';

const SECRET_KEY = /password|passwd|authorization|cookie|secret|token|signature|payload_json|^html$|^text$/iu;

function redactSecrets(value, seen = new WeakSet()) {
    if (typeof value === 'string') {
        return value
            .replace(/mail-password-reset-[a-f0-9]{64}/giu, 'mail-password-reset-[redacted]')
            .replace(/((?:resetToken|token|password|client_secret|access_token)\s*[=:]\s*)[^\s&"'<>]+/giu, '$1[redacted]')
            .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/giu, 'Bearer [redacted]')
            .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/giu, '[redacted image]');
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (value instanceof Error) return { name: value.name, code: value.code, message: redactSecrets(value.message) };
    if (Array.isArray(value)) return value.map(item => redactSecrets(item, seen));
    return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
        [key, SECRET_KEY.test(key) ? '[redacted]' : redactSecrets(entry, seen)]));
}

module.exports = { redactSecrets };
