'use strict';
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('backup helpers reject unsafe targets and verify synthetic archive roundtrips', () => {
    execFileSync('python3', [path.join(__dirname, 'backup-restore.test.py')], { stdio: 'pipe', timeout: 15000 });
});
