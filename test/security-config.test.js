'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertSecurityEnvironment,
  createHelmetOptions,
  createSessionCookieOptions,
  isProduction
} = require('../config/security');

const serverSource = fs.readFileSync(
  path.resolve(__dirname, '../segnitz_rental.js'),
  'utf8'
);

test('detects production environments', () => {
  assert.equal(isProduction({ NODE_ENV: 'production' }), true);
  assert.equal(isProduction({ NODE_ENV: 'development' }), false);
});

test('uses secure session cookies in production only', () => {
  assert.deepEqual(createSessionCookieOptions({ NODE_ENV: 'production' }), {
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 60 * 1000
  });

  assert.equal(createSessionCookieOptions({ NODE_ENV: 'test' }).secure, false);
});

test('requires a strong production session secret', () => {
  assert.throws(
    () => assertSecurityEnvironment({ NODE_ENV: 'production', SESSION_SECRET: 'short' }),
    /mindestens 32 Zeichen/
  );

  assert.doesNotThrow(() =>
    assertSecurityEnvironment({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a'.repeat(32)
    })
  );
});

test('does not require production secrets for local tests', () => {
  assert.doesNotThrow(() => assertSecurityEnvironment({ NODE_ENV: 'test' }));
});

test('enables a restrictive baseline CSP', () => {
  const frontendHash = "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='";
  const developmentOptions = createHelmetOptions(
    { NODE_ENV: 'development' },
    { frontendScriptHashes: [frontendHash] }
  );
  const productionOptions = createHelmetOptions({ NODE_ENV: 'production' });
  const legacyDevelopmentOptions = createHelmetOptions({ NODE_ENV: 'development' });

  assert.deepEqual(developmentOptions.contentSecurityPolicy.directives.objectSrc, ["'none'"]);
  assert.deepEqual(developmentOptions.contentSecurityPolicy.directives.frameAncestors, ["'none'"]);
  assert.deepEqual(
    developmentOptions.contentSecurityPolicy.directives.scriptSrcAttr,
    ["'none'"]
  );
  assert.deepEqual(
    developmentOptions.contentSecurityPolicy.directives.scriptSrc,
    ["'self'", frontendHash]
  );
  assert.deepEqual(
    legacyDevelopmentOptions.contentSecurityPolicy.directives.scriptSrc,
    ["'self'", 'https://cdn.jsdelivr.net']
  );
  assert.deepEqual(
    productionOptions.contentSecurityPolicy.directives.scriptSrc,
    ["'self'"]
  );
  assert.deepEqual(
    productionOptions.contentSecurityPolicy.directives.styleSrc,
    ["'self'", "'unsafe-inline'"]
  );
  assert.deepEqual(
    productionOptions.contentSecurityPolicy.directives.fontSrc,
    ["'self'", 'data:']
  );
  assert.equal(
    developmentOptions.contentSecurityPolicy.directives.scriptSrc.includes("'unsafe-inline'"),
    false
  );
  assert.equal(
    developmentOptions.contentSecurityPolicy.directives.upgradeInsecureRequests,
    null
  );
  assert.deepEqual(
    productionOptions.contentSecurityPolicy.directives.upgradeInsecureRequests,
    []
  );
});

test('protects browser mutations with global CSRF validation', () => {
  assert.match(
    serverSource,
    /csrfTokensEqual\(\s*providedToken,\s*req\.session\.csrfToken\s*\)/
  );
  assert.match(
    serverSource,
    /app\.use\(requireCsrfToken\)/
  );
  assert.match(
    serverSource,
    /\['GET', 'HEAD', 'OPTIONS'\]\.includes\(method\)/
  );
  assert.match(
    serverSource,
    /req\.path === '\/webhooks\/mollie'/
  );
  assert.match(
    serverSource,
    /app\.get\(\s*'\/csrf-token'/
  );
});
