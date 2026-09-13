'use strict';
const { redactSecrets } = require('../utils/redaction');
const { errorStatus } = require('../utils/httpErrors');

function jsonErrors(error, req, res, next) {
    if (req.aborted) return;
    if (res.headersSent) return next(error);
    const code = String(error?.code || error?.type || 'INTERNAL_ERROR');
    let status = 500;
    let message = 'Die Anfrage konnte nicht verarbeitet werden.';
    if (errorStatus(error) === 503 && code !== 'IMAGE_BUSY') {
        res.set('Retry-After', '2');
        return res.status(503).json({ error: 'Dienst vorübergehend nicht verfügbar. Bitte erneut versuchen.', code: 'SERVICE_UNAVAILABLE' });
    } else if (error?.status === 413 || code === 'entity.too.large' || code === 'LIMIT_FILE_SIZE' || code === 'IMAGE_SIZE' || code === 'IMAGE_QUOTA') {
        status = 413; message = 'Die übermittelten Daten sind zu groß.';
    } else if (error?.status === 415 || code === 'INVALID_IMAGE_TYPE' || code === 'INVALID_IMAGE_CONTENT') {
        status = 415; message = 'Das Datenformat oder die Zeichencodierung wird nicht unterstützt.';
    } else if (code === 'IMAGE_BUSY') {
        status = 503; message = 'Bildverarbeitung ausgelastet. Bitte erneut versuchen.';
        res.set('Retry-After', '2');
    } else if (error?.status === 400 || code === 'INVALID_FIELD_NAME' || code.startsWith('LIMIT_') || code === 'UPLOAD_ABORTED' || error?.message === 'Unexpected end of form') {
        status = 400; message = 'Die übermittelten Daten sind ungültig.';
    }
    if (status === 500) console.error('request_error', redactSecrets({ code, message: error?.message, requestId: req.requestId }));
    return res.status(status).json({ error: message, code: status === 500 ? 'INTERNAL_ERROR' : code });
}

module.exports = { jsonErrors };
