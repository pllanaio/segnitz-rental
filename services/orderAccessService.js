'use strict';

const crypto = require('crypto');

const ORDER_ACCESS_COOKIE = 'segnitz.order_access';
const ORDER_ACCESS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function hashOrderAccessToken(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function createOrderAccessGrant(now = new Date()) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + ORDER_ACCESS_MAX_AGE_MS);

    return {
        token,
        tokenHash: hashOrderAccessToken(token),
        expiresAt
    };
}

function parseCookieHeader(cookieHeader) {
    const cookies = new Map();

    for (const part of String(cookieHeader || '').split(';')) {
        const separator = part.indexOf('=');
        if (separator < 1) continue;

        const name = part.slice(0, separator).trim();
        if (cookies.has(name)) continue;

        const encodedValue = part.slice(separator + 1).trim();
        try {
            cookies.set(name, decodeURIComponent(encodedValue));
        } catch {
            cookies.set(name, encodedValue);
        }
    }

    return cookies;
}

function hasValidOrderAccessCookie(req, order, now = new Date()) {
    const expectedHash = String(order.guestAccessTokenHash || order.guest_access_token_hash || '');
    const expiresAt = new Date(
        order.guestAccessTokenExpiresAt || order.guest_access_token_expires_at || 0
    );

    if (!/^[a-f0-9]{64}$/i.test(expectedHash) || !Number.isFinite(expiresAt.getTime())) {
        return false;
    }

    if (expiresAt.getTime() <= now.getTime()) return false;

    const token = parseCookieHeader(req?.headers?.cookie).get(ORDER_ACCESS_COOKIE);
    if (!token) return false;

    const actualHash = hashOrderAccessToken(token);
    return crypto.timingSafeEqual(
        Buffer.from(actualHash, 'hex'),
        Buffer.from(expectedHash.toLowerCase(), 'hex')
    );
}

function setOrderAccessCookie(res, orderId, grant) {
    const normalizedOrderId = Number(orderId);
    if (!Number.isInteger(normalizedOrderId) || normalizedOrderId < 1 || !grant?.token) {
        throw new Error('Ungültige Order-Access-Cookie-Daten.');
    }

    res.cookie(ORDER_ACCESS_COOKIE, grant.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: `/orders/${normalizedOrderId}`,
        maxAge: Math.max(0, grant.expiresAt.getTime() - Date.now())
    });
}

module.exports = {
    ORDER_ACCESS_COOKIE,
    ORDER_ACCESS_MAX_AGE_MS,
    createOrderAccessGrant,
    hashOrderAccessToken,
    hasValidOrderAccessCookie,
    parseCookieHeader,
    setOrderAccessCookie
};
