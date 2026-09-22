'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { createPaymentReconciler } = require('../services/paymentReconciliationService');
const driverRoot = path.dirname(require.resolve('mysql2'));
const ExecutePacket = require(path.join(driverRoot, 'lib/packets/execute.js'));
const { Types } = require('mysql2');

function wireTypes(parameters) {
    const packet = new ExecutePacket(1, parameters, 45, '+00:00', undefined, 0).toPacket();
    packet.offset = 4;
    assert.equal(packet.readInt8(), 0x17); // COM_STMT_EXECUTE, actual mysql2 encoder.
    packet.skip(4 + 1 + 4); // statement ID, flags, iteration count
    packet.skip(Math.ceil(parameters.length / 8));
    assert.equal(packet.readInt8(), 1); // new parameter types follow
    return parameters.map(() => { const type = packet.readInt8(); packet.skip(1); return type; });
}

test('reconciliation LIMIT uses bounded decimal bindings instead of mysql2 DOUBLE wire values', async () => {
    assert.equal(wireTypes([0, 2])[1], Types.DOUBLE); // Confirm the actual prior wire contract.
    for (const batchSize of [1, 2, 4, 100, 1000, '4']) {
        let statements = 0;
        let ended = false;
        const reconciler = createPaymentReconciler({
            batchSize,
            createConnection: async () => ({
                async execute(_sql, parameters) {
                    statements++;
                    const types = wireTypes(parameters);
                    assert.equal(types[1], Types.VAR_STRING, 'MySQL LIMIT must not receive a binary DOUBLE parameter');
                    assert.match(parameters[1], /^[1-9][0-9]{0,2}$/u);
                    assert.ok(Number(parameters[1]) <= 100);
                    return [[]];
                },
                async end() { ended = true; }
            }),
            reconcilePayment: async () => { throw new Error('Empty fixture must not contact a provider'); }
        });
        try { await reconciler.cycle(); }
        finally { await reconciler.stop(); }
        assert.equal(statements, Number(batchSize) === 1 ? 1 : 2);
        assert.equal(ended, true);
        assert.ok(reconciler.progress.lastCompletedAt);
    }
});
