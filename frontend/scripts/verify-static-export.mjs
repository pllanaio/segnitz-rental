import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const outputDirectory = path.resolve(process.cwd(), 'out');
const expectedRoutes = [
  'index.html',
  'login.html',
  'register.html',
  'setup.html',
  'verify-email.html',
  'email-verified.html',
  'profile.html',
  'backend.html',
];
const inlineScriptPattern = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
const nextAssetPattern = /(?:src|href)="(\/_next\/static\/[^"?#]+)(?:[?#][^"]*)?"/g;

async function collectHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectHtmlFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith('.html') ? [absolutePath] : [];
  }))).flat();
}

function hashScript(script) {
  return `'sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}'`;
}

for (const route of expectedRoutes) {
  await access(path.join(outputDirectory, `${route}.html`));
}

const manifest = JSON.parse(await readFile(
  path.join(outputDirectory, 'csp-script-hashes.json'),
  'utf8',
));
const manifestHashes = new Set(manifest.scriptSrc);
if (manifestHashes.size === 0) throw new Error('Der Static Export enthält keine CSP-Hashes.');
if (Buffer.byteLength([...manifestHashes].join(' '), 'utf8') > 6 * 1024) {
  throw new Error('Die CSP-Hashes überschreiten das Headerbudget von 6 KiB.');
}

const actualHashes = new Set();
const htmlFiles = await collectHtmlFiles(outputDirectory);
for (const htmlFile of htmlFiles) {
  const html = await readFile(htmlFile, 'utf8');
  if (html.includes('/_next/image?')) {
    throw new Error(`Next Image Optimizer ist im statischen Export nicht verfügbar: ${htmlFile}`);
  }
  if (/javascript:/iu.test(html)) {
    throw new Error(`Unsichere javascript:-URL im statischen Export: ${htmlFile}`);
  }

  for (const match of html.matchAll(inlineScriptPattern)) {
    if (match[1]) actualHashes.add(hashScript(match[1]));
  }
  for (const match of html.matchAll(nextAssetPattern)) {
    await access(path.join(outputDirectory, match[1].slice(1)));
  }
}

for (const hash of actualHashes) {
  if (!manifestHashes.has(hash)) throw new Error(`Inline-Script fehlt im CSP-Manifest: ${hash}`);
}
for (const hash of manifestHashes) {
  if (!actualHashes.has(hash)) throw new Error(`Veralteter Hash im CSP-Manifest: ${hash}`);
}

console.log(
  `Static Export verifiziert: ${expectedRoutes.length} Seiten, ` +
  `${actualHashes.size} Inline-Script-Hashes, ${htmlFiles.length} HTML-Dateien.`,
);
