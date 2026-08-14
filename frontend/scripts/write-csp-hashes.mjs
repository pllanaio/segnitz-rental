import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDirectory = path.resolve(process.cwd(), 'out');
const inlineScriptPattern = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

async function collectHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectHtmlFiles(absolutePath);
      return entry.isFile() && entry.name.endsWith('.html') ? [absolutePath] : [];
    }),
  );

  return nestedFiles.flat();
}

function hashInlineScripts(html) {
  const hashes = [];
  for (const match of html.matchAll(inlineScriptPattern)) {
    const script = match[1];
    if (!script) continue;
    const digest = createHash('sha256').update(script, 'utf8').digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

const htmlFiles = await collectHtmlFiles(outputDirectory);
const hashes = new Set();

for (const htmlFile of htmlFiles) {
  const html = await readFile(htmlFile, 'utf8');
  for (const hash of hashInlineScripts(html)) hashes.add(hash);
}

const manifest = {
  scriptSrc: [...hashes].sort(),
};

await writeFile(
  path.join(outputDirectory, 'csp-script-hashes.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

console.log(`CSP-Manifest geschrieben: ${manifest.scriptSrc.length} Inline-Script-Hashes.`);
