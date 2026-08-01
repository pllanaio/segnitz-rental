'use strict';

const { execFileSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const excludedDirectories = new Set(['.git', 'node_modules']);
const files = [];

function collectJavaScriptFiles(directory) {
  for (const entry of readdirSync(directory)) {
    if (excludedDirectories.has(entry)) continue;

    const absolutePath = path.join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      collectJavaScriptFiles(absolutePath);
    } else if (stats.isFile() && entry.endsWith('.js')) {
      files.push(absolutePath);
    }
  }
}

collectJavaScriptFiles(root);

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Syntaxprüfung erfolgreich: ${files.length} JavaScript-Dateien geprüft.`);
