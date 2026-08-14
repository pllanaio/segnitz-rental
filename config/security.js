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

function createHelmetOptions(environment = process.env, { frontendScriptHashes = [] } = {}) {
    const production = isProduction(environment);
    const legacyDevelopmentScripts = !production && frontendScriptHashes.length === 0
        ? ['https://cdn.jsdelivr.net']
        : [];
    const developmentStyleSources = production
        ? []
        : ['https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'];
    const developmentFontSources = production ? [] : ['https://fonts.gstatic.com'];
    const directives = {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'", ...frontendScriptHashes, ...legacyDevelopmentScripts],
        scriptSrcAttr: ["'none'"],
        styleSrc: [
            "'self'",
            "'unsafe-inline'",
            ...developmentStyleSources
        ],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:', ...developmentFontSources],
        connectSrc: ["'self'"]
    };

    directives.upgradeInsecureRequests = production ? [] : null;

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
