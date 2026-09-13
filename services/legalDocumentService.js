'use strict';

function safeDocumentUrl(value) {
    if (typeof value !== 'string' || /[\u0000-\u0020\\]/u.test(value)) return null;
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function getLegalDocuments(env = process.env) {
    const terms = { version: env.LEGAL_TERMS_VERSION || '', url: safeDocumentUrl(env.LEGAL_TERMS_URL) };
    const privacy = { version: env.LEGAL_PRIVACY_VERSION || '', url: safeDocumentUrl(env.LEGAL_PRIVACY_URL) };
    const operatorUrl = safeDocumentUrl(env.LEGAL_OPERATOR_URL);
    const versionValid = version => typeof version === 'string' && /^[^\u0000-\u001f\u007f]{1,100}$/u.test(version);
    const ready = Boolean(versionValid(terms.version) && terms.url && versionValid(privacy.version) && privacy.url && operatorUrl);
    return { ready, terms, privacy, operatorUrl, signatureImageUploadEnabled: env.SIGNATURE_IMAGE_UPLOAD_ENABLED === '1' };
}
function acceptedDocumentSnapshot({ termsVersion, privacyVersion }, env = process.env, now = new Date()) {
    const documents = getLegalDocuments(env);
    if (!documents.ready) return { status: 503, error: 'Die freigegebenen Vertragsdokumente sind noch nicht hinterlegt. Bitte den Betreiber kontaktieren.' };
    if (termsVersion !== documents.terms.version || privacyVersion !== documents.privacy.version) return { status: 409, error: 'Die Vertragsdokumente wurden geändert. Bitte die Seite neu laden und die aktuellen Dokumente prüfen.' };
    return { snapshot: { terms: documents.terms, privacy: documents.privacy, operatorUrl: documents.operatorUrl, acceptedAt: now.toISOString() } };
}
module.exports = { acceptedDocumentSnapshot, getLegalDocuments, safeDocumentUrl };
