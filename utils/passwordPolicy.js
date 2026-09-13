'use strict';

const PASSWORD_HASH_ROUNDS = 12;
const PASSWORD_MAX_BYTES = 72;
const PRIVILEGED_ROLES = new Set(['global_admin', 'bearbeiter']);

function isValidPassword(value, role = 'user') {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_BYTES) return false;
    if (PRIVILEGED_ROLES.has(role)) {
        return value.length >= 12 && /[a-z]/u.test(value) && /[A-Z]/u.test(value) &&
            /[0-9]/u.test(value) && /[^A-Za-z0-9]/u.test(value);
    }
    return value.length >= 8 && /[0-9]/u.test(value) && /[^A-Za-z0-9]/u.test(value);
}

function passwordPolicyMessage(role = 'user') {
    return PRIVILEGED_ROLES.has(role)
        ? 'Das Passwort muss mindestens 12 Zeichen, höchstens 72 Bytes, Groß- und Kleinbuchstaben, eine Zahl und ein Sonderzeichen enthalten.'
        : 'Das Passwort muss mindestens 8 Zeichen, höchstens 72 Bytes, eine Zahl und ein Sonderzeichen enthalten.';
}

module.exports = { PASSWORD_HASH_ROUNDS, PASSWORD_MAX_BYTES, isValidPassword, passwordPolicyMessage };
