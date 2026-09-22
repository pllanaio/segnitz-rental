'use strict';
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('synthetic restore preserves private mounts and cleans writers before host ownership', () => {
    execFileSync('python3', [path.join(__dirname, 'restore-workspace.test.py')], { stdio: 'pipe', timeout: 15000 });
});
