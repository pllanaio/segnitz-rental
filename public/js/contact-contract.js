(function (root) {
    'use strict';
    const bounded = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);
    const isSafeAddress = value => bounded(value, 255) && /^[\p{L}\p{M}\p{N} .,'’/()\-]+$/u.test(value.trim());
    const isValidPhone = value => bounded(value, 50) && /^\+?[0-9 ()/.\-]+$/u.test(value.trim()) && (value.match(/[0-9]/gu) || []).length >= 3 && (value.match(/[0-9]/gu) || []).length <= 25;
    const isValidPostalCode = value => bounded(value, 20) && /^[\p{L}\p{N} \-]+$/u.test(value.trim());
    // Only validation. Never silently remove characters from contact details.
    const api = Object.freeze({ isSafeAddress, isValidPhone, isValidPostalCode });
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ContactContract = api;
})(typeof window === 'object' ? window : globalThis);
