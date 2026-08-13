'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(projectRoot, 'Dockerfile'), 'utf8');
const compose = fs.readFileSync(path.join(projectRoot, 'compose.yml'), 'utf8');
const entrypoint = fs.readFileSync(path.join(projectRoot, 'docker-entrypoint.sh'), 'utf8');

test('the container repairs only the two upload mount points before dropping privileges', () => {
  assert.match(dockerfile, /apk add --no-cache tzdata su-exec/u);
  assert.match(
    dockerfile,
    /COPY --chown=root:root --chmod=0755 docker-entrypoint\.sh \/usr\/local\/bin\/docker-entrypoint\.sh/u
  );
  assert.match(dockerfile, /USER root[\s\S]*ENTRYPOINT \["docker-entrypoint\.sh"\]/u);
  assert.match(
    dockerfile,
    /HEALTHCHECK[\s\S]*CMD \["su-exec", "node:node", "node"/u
  );

  const privilegedMutationLines = entrypoint
    .split('\n')
    .filter(line => /^(?:mkdir|chown)\s/u.test(line));
  assert.deepEqual(privilegedMutationLines, [
    'mkdir -p /app/public/img/products /app/uploads/returns',
    'chown node:node /app/public/img/products /app/uploads/returns'
  ]);
  assert.doesNotMatch(entrypoint, /(?:mkdir|chown)[^\n]*\$/u);
  assert.doesNotMatch(entrypoint, /chown[^\n]*\s-R(?:\s|$)/u);
  assert.match(entrypoint, /^exec su-exec node:node "\$@"$/mu);
});

test('Compose grants only the minimal startup capabilities and keeps init forwarding', () => {
  assert.match(compose, /cap_drop:\n\s+- ALL/u);
  const capabilityBlock = compose.match(/cap_add:\n([\s\S]*?)\s+security_opt:/u);
  assert.ok(capabilityBlock);
  assert.deepEqual(
    capabilityBlock[1]
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean),
    ['- CHOWN', '- SETGID', '- SETUID']
  );
  assert.match(compose, /security_opt:\n\s+- no-new-privileges:true/u);
  assert.match(compose, /init: true/u);
});
