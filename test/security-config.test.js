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
  const developmentOptions = createHelmetOptions({ NODE_ENV: 'development' });
  const productionOptions = createHelmetOptions({ NODE_ENV: 'production' });

  assert.deepEqual(developmentOptions.contentSecurityPolicy.directives.objectSrc, ["'none'"]);
  assert.deepEqual(developmentOptions.contentSecurityPolicy.directives.frameAncestors, ["'none'"]);
  assert.deepEqual(
    developmentOptions.contentSecurityPolicy.directives.scriptSrcAttr,
    ["'none'"]
  );
  assert.deepEqual(
    developmentOptions.contentSecurityPolicy.directives.scriptSrc,
    ["'self'", 'https://cdn.jsdelivr.net']
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

test('protects changed return mutations with CSRF validation and rate limiting', () => {
  assert.match(
    serverSource,
    /adminCsrfTokensEqual\(\s*providedToken,\s*req\.session\.adminCsrfToken\s*\)/
  );
  assert.match(
    serverSource,
    /app\.put\(\s*'\/admin\/order-items\/:itemId\/cancel',\s*checkAdmin,\s*requireAdminCsrfToken,\s*adminReturnMutationLimiter,/
  );
  assert.match(
    serverSource,
    /app\.post\(\s*'\/admin\/order-items\/:itemId\/return-images',\s*checkAdmin,\s*requireAdminCsrfToken,\s*adminReturnMutationLimiter,/
  );
  assert.match(
    serverSource,
    /app\.put\(\s*'\/admin\/order-items\/:itemId\/return',\s*checkAdmin,\s*requireAdminCsrfToken,\s*adminReturnMutationLimiter,/
  );
  assert.match(
    serverSource,
    /app\.post\(\s*'\/admin\/order-payments\/:id\/retry-refund',\s*checkAdmin,\s*requireAdminCsrfToken,\s*adminReturnMutationLimiter,/
  );
  assert.match(
    serverSource,
    /app\.post\(\s*'\/admin\/order-payments\/manual-refund',\s*checkAdmin,\s*requireAdminCsrfToken,\s*adminReturnMutationLimiter,/
  );
});
