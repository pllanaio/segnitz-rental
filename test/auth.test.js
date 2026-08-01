'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAdmin } = require('../middleware/auth');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    redirectTarget: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    redirect(target) {
      this.redirectTarget = target;
      return this;
    }
  };
}

test('allows a logged-in global admin', () => {
  const req = {
    session: { user: 'admin@example.com', role: 'global_admin' },
    originalUrl: '/backend.html'
  };
  const res = createResponse();
  let nextCalled = false;

  checkAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.redirectTarget, null);
});

test('rejects unauthenticated admin API calls with 401', () => {
  const req = { session: {}, originalUrl: '/admin/orders' };
  const res = createResponse();

  checkAdmin(req, res, () => assert.fail('next must not be called'));

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Nicht angemeldet.' });
});

test('redirects unauthenticated page requests to login and stores target', () => {
  const req = { session: {}, originalUrl: '/backend.html' };
  const res = createResponse();

  checkAdmin(req, res, () => assert.fail('next must not be called'));

  assert.equal(req.session.redirectAfterLogin, '/backend.html');
  assert.equal(res.redirectTarget, '/login.html?reason=session_expired');
});

test('rejects logged-in non-admin users', () => {
  const req = {
    session: { user: 'user@example.com', role: 'customer' },
    originalUrl: '/admin/orders'
  };
  const res = createResponse();

  checkAdmin(req, res, () => assert.fail('next must not be called'));

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Keine Berechtigung.' });
});
