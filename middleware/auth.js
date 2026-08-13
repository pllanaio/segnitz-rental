'use strict';

function isApiRequest(req) {
    const originalUrl = String(req.originalUrl || req.url || '');
    const method = String(req.method || 'GET').toUpperCase();
    const acceptHeader = String(req.headers?.accept || '').toLowerCase();

    return (
        originalUrl.startsWith('/admin') ||
        originalUrl.startsWith('/api/') ||
        !['GET', 'HEAD'].includes(method) ||
        acceptHeader.includes('application/json') ||
        !acceptHeader.includes('text/html') ||
        req.xhr === true
    );
}

function checkAdmin(req, res, next) {
    const isLoggedIn = Boolean(req.session && req.session.user);
    const isAdmin = Boolean(req.session && req.session.role === 'global_admin');
    const apiRequest = isApiRequest(req);

    if (!isLoggedIn) {
        if (apiRequest) {
            return res.status(401).json({ error: 'Nicht angemeldet.' });
        }

        if (req.session) {
            req.session.redirectAfterLogin = req.originalUrl;
        }

        return res.redirect('/login.html?reason=session_expired');
    }

    if (!isAdmin) {
        if (apiRequest) {
            return res.status(403).json({ error: 'Keine Berechtigung.' });
        }

        return res.redirect('/index.html');
    }

    return next();
}

module.exports = {
    checkAdmin,
    isApiRequest
};
