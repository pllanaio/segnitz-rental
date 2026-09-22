'use strict';
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
test('restore internal-network relay confines endpoints and closes real TCP sockets', () => {
    execFileSync('python3', [path.join(__dirname, 'restore-network.test.py')], { stdio: 'pipe', timeout: 15000 });
});
