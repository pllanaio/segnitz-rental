'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const dbConfig = require('../config/db');
const driverRoot = path.dirname(require.resolve('mysql2'));
const getParser = require(path.join(driverRoot, 'lib/parsers/static_text_parser.js'));
const Packet = require(path.join(driverRoot, 'lib/packets/packet.js'));
const Types = require('mysql2').Types;

function decodeBigint(value) {
    const bytes = Buffer.from(value, 'ascii');
    const wireRow = Buffer.concat([Buffer.alloc(4), Buffer.from([bytes.length]), bytes]);
    const packet = new Packet(0, wireRow, 0, wireRow.length);
    const field = { name: 'value', columnType: Types.LONGLONG, encoding: 'ascii', characterSet: 63 };
    return getParser([field], {}, dbConfig).next(packet, [field], {}).value;
}

test('mysql2 keeps safe COUNT values numeric while preserving unsafe BIGINT IDs exactly', () => {
    assert.equal(decodeBigint('201'), 201);
    assert.equal(decodeBigint('9007199254740993'), '9007199254740993');
});
