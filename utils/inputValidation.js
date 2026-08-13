'use strict';

const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MAX_BYTES = 72;
const SIGNATURE_MAX_LENGTH = 750000;

const CUSTOMER_FIELD_LIMITS = Object.freeze({
    firstName: 100,
    lastName: 100,
    company: 255,
    phone: 50,
    address: 255,
    zip: 20,
    city: 100
});

function normalizeEmail(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

function isValidEmail(value) {
    const email = normalizeEmail(value);

    if (!email || email.length > EMAIL_MAX_LENGTH) return false;

    const atIndex = email.indexOf('@');
    if (atIndex < 1 || atIndex > 64 || atIndex !== email.lastIndexOf('@')) return false;

    const domain = email.slice(atIndex + 1);
    if (domain.length < 3 || domain.length > 189 || domain.startsWith('.') || domain.endsWith('.')) {
        return false;
    }

    if (!domain.includes('.') || /\s/u.test(email)) return false;

    return !email.includes('\u0000');
}

function isBoundedString(value, maxLength, { required = true } = {}) {
    if (typeof value !== 'string') return !required && (value === null || value === undefined);

    const normalized = value.trim();
    if (required && !normalized) return false;
    return normalized.length <= maxLength;
}

function hasValidCustomerFieldLengths(customer) {
    return isBoundedString(customer.firstName, CUSTOMER_FIELD_LIMITS.firstName) &&
        isBoundedString(customer.lastName, CUSTOMER_FIELD_LIMITS.lastName) &&
        isBoundedString(customer.company, CUSTOMER_FIELD_LIMITS.company, { required: false }) &&
        isBoundedString(customer.phone, CUSTOMER_FIELD_LIMITS.phone) &&
        isBoundedString(customer.address, CUSTOMER_FIELD_LIMITS.address) &&
        isBoundedString(customer.zip, CUSTOMER_FIELD_LIMITS.zip) &&
        isBoundedString(customer.city, CUSTOMER_FIELD_LIMITS.city);
}

function isDigitsOnly(value, maxLength) {
    if (!isBoundedString(value, maxLength)) return false;
    return /^[0-9]+$/u.test(value.trim());
}

function isSafeAddress(value) {
    if (!isBoundedString(value, CUSTOMER_FIELD_LIMITS.address)) return false;
    return /^[a-zA-Z0-9äöüÄÖÜß\s]+$/u.test(value.trim());
}

function isValidPassword(value) {
    if (typeof value !== 'string' || value.length < 8) return false;
    if (Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_BYTES) return false;

    return /[0-9]/u.test(value) && /[^A-Za-z0-9]/u.test(value);
}

function isValidSignatureDataUrl(value) {
    if (typeof value !== 'string' || value.length > SIGNATURE_MAX_LENGTH) return false;

    const prefixes = [
        'data:image/png;base64,',
        'data:image/jpeg;base64,'
    ];
    const prefix = prefixes.find(candidate => value.startsWith(candidate));

    if (!prefix || value.length === prefix.length) return false;
    return /^[A-Za-z0-9+/=]+$/u.test(value.slice(prefix.length));
}

module.exports = {
    CUSTOMER_FIELD_LIMITS,
    EMAIL_MAX_LENGTH,
    PASSWORD_MAX_BYTES,
    SIGNATURE_MAX_LENGTH,
    hasValidCustomerFieldLengths,
    isBoundedString,
    isDigitsOnly,
    isSafeAddress,
    isValidEmail,
    isValidPassword,
    isValidSignatureDataUrl,
    normalizeEmail
};
