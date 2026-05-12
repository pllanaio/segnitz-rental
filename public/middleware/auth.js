function checkAdmin(req, res, next) {
    const isLoggedIn = req.session && req.session.user;
    const isAdmin = req.session && req.session.role === 'global_admin';

    const isApiCall = req.originalUrl.startsWith('/admin');

    if (!isLoggedIn) {
        if (isApiCall) {
            return res.status(401).json({ error: 'Nicht angemeldet.' });
        }

        req.session.redirectAfterLogin = req.originalUrl;
        return res.redirect('/login.html?reason=session_expired');
    }

    if (!isAdmin) {
        if (isApiCall) {
            return res.status(403).json({ error: 'Keine Berechtigung.' });
        }

        return res.redirect('/index.html');
    }

    next();
}

module.exports = {
    checkAdmin
};