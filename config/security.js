'use strict';

function isProduction(environment = process.env) {
    return environment.NODE_ENV === 'production';
}

function assertSecurityEnvironment(environment = process.env) {
    if (!isProduction(environment)) {
        return;
    }

    const sessionSecret = String(environment.SESSION_SECRET || '');

    if (sessionSecret.length < 32) {
        throw new Error('SESSION_SECRET muss in Produktion mindestens 32 Zeichen lang sein.');
    }
}

function createSessionCookieOptions(environment = process.env) {
    return {
        secure: isProduction(environment),
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 60 * 1000
    };
}

function createHelmetOptions(environment = process.env) {
    const directives = {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        scriptSrcAttr: ["'none'"],
        styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://cdn.jsdelivr.net',
            'https://fonts.googleapis.com'
        ],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"]
    };

    directives.upgradeInsecureRequests = isProduction(environment) ? [] : null;

    return {
        contentSecurityPolicy: { directives },
        crossOriginEmbedderPolicy: false,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    };
}

module.exports = {
    assertSecurityEnvironment,
    createHelmetOptions,
    createSessionCookieOptions,
    isProduction
};
