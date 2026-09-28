'use strict';
const { getMollieClient, withMollieTimeout, isTestMode } = require('./mollieService');
const terminalIdPattern = /^term_[A-Za-z0-9]{1,75}$/;
function posMode() {
    if (isTestMode() || String(process.env.MOLLIE_API_KEY || '').startsWith('test_')) return 'test';
    if (String(process.env.MOLLIE_API_KEY || '').startsWith('live_')) return 'live';
    throw Object.assign(new Error('Für POS muss ein Mollie-Profil-API-Schlüssel eingerichtet sein.'), { statusCode: 503 });
}
function normalizeTerminal(terminal) {
    if (!terminalIdPattern.test(terminal.id) || terminal.mode !== posMode()) throw new Error('Terminal gehört nicht zum aktiven Zahlungsmodus.');
    return { id: terminal.id, mode: terminal.mode, description: terminal.description || terminal.id,
        status: terminal.status, brand: terminal.brand || '', model: terminal.model || '', currency: terminal.currency || 'EUR' };
}
async function listTerminals() {
    if (isTestMode()) return ['term_testone', 'term_testtwo'].map(id => normalizeTerminal({ id, mode: 'test', description: id, status: 'active', currency: 'EUR' }));
    const items = [];
    let page = await withMollieTimeout(getMollieClient().terminals.page({ limit: 250 }));
    for (;;) {
        items.push(...Array.from(page).map(normalizeTerminal));
        if (!page.nextPageCursor) break;
        page = await withMollieTimeout(getMollieClient().terminals.page({ limit: 250, from: page.nextPageCursor }));
    }
    return items;
}
async function getTerminal(id) {
    if (!terminalIdPattern.test(String(id || ''))) throw Object.assign(new Error('Ungültige Terminal-ID.'), { statusCode: 400 });
    if (isTestMode()) {
        const terminal = (await listTerminals()).find(item => item.id === id);
        if (!terminal) throw Object.assign(new Error('Terminal nicht gefunden.'), { statusCode: 404 });
        return terminal;
    }
    return normalizeTerminal(await withMollieTimeout(getMollieClient().terminals.get(id)));
}
function validateTerminalSettings(body) {
    if (typeof body.label !== 'string' || body.label.trim().length > 120 ||
        typeof body.location !== 'string' || body.location.trim().length > 160 ||
        typeof body.enabled !== 'boolean' || !Number.isInteger(body.revision) || body.revision < 0) {
        throw Object.assign(new Error('Ungültige Terminal-Einstellungen.'), { statusCode: 400 });
    }
    return { label: body.label.trim(), location: body.location.trim(), enabled: body.enabled, revision: body.revision };
}
async function getPosLimits() {
    if (isTestMode()) return { minimum: 0.01, maximum: 10000 };
    const method = await withMollieTimeout(getMollieClient().methods.get('pointofsale'));
    if (method.minimumAmount?.currency !== 'EUR' || method.maximumAmount?.currency !== 'EUR') throw new Error('Mollie-Betragsgrenzen konnten nicht geprüft werden.');
    const limits = { minimum: Number(method.minimumAmount.value), maximum: Number(method.maximumAmount.value) };
    if (!Number.isFinite(limits.minimum) || !Number.isFinite(limits.maximum)) throw new Error('Ungültige Mollie-Betragsgrenzen.');
    return limits;
}
module.exports = { getPosLimits, posMode, listTerminals, getTerminal, validateTerminalSettings };
