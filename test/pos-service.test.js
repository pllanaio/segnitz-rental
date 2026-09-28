'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function service(client, key = 'test_contract') {
    const context = { module: { exports: {} }, process: { env: { MOLLIE_API_KEY: key } },
        require: () => ({ getMollieClient: () => client, withMollieTimeout: promise => promise, isTestMode: () => false }) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/posService.js'), 'utf8'), context);
    return context.module.exports;
}
test('Terminalverwaltung lädt alle Seiten und hält Test- und Live-Modus getrennt', async () => {
    const requests = [];
    const api = service({ terminals: { page: async options => {
        requests.push(options);
        if (options.from) return [{ id: 'term_two', mode: 'test', status: 'active' }];
        const first = [{ id: 'term_one', mode: 'test', status: 'active' }]; first.nextPageCursor = 'term_two'; return first;
    } } });
    assert.equal((await api.listTerminals()).length, 2);
    assert.equal(requests[1].from, 'term_two'); assert.equal(requests[0].testmode, undefined);
    const mismatch = service({ terminals: { get: async () => ({ id: 'term_one', mode: 'live' }) } });
    await assert.rejects(mismatch.getTerminal('term_one'), /Zahlungsmodus/);
});
test('Terminalverwaltung prüft Einstellungen und unbekannte IDs vor API-Aufrufen', async () => {
    const api = service({});
    await assert.rejects(api.getTerminal('../invalid'), /Terminal-ID/);
    assert.throws(() => api.validateTerminalSettings({ label: 'x', location: '', enabled: 'false', revision: 0 }), /Einstellungen/);
    const settings = api.validateTerminalSettings({ label: ' Lager ', location: 'Abholung', enabled: false, revision: 2 });
    assert.equal(settings.label, 'Lager'); assert.equal(settings.enabled, false);
});
