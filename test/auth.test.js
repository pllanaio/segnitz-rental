'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAdmin, isApiRequest } = require('../middleware/auth');

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
    originalUrl: '/backend.html',
    method: 'GET'
  };
  const res = createResponse();
  let nextCalled = false;

  checkAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.redirectTarget, null);
});

test('classifies admin and JSON requests as API requests', () => {
  assert.equal(isApiRequest({ originalUrl: '/admin/orders', method: 'GET' }), true);
  assert.equal(isApiRequest({ originalUrl: '/products', method: 'POST' }), true);
  assert.equal(
    isApiRequest({
      originalUrl: '/products',
      method: 'GET',
      headers: { accept: 'application/json' }
    }),
    true
  );
});

test('classifies a regular page request as non-API', () => {
  assert.equal(
    isApiRequest({
      originalUrl: '/backend.html',
      method: 'GET',
      headers: { accept: 'text/html' }
    }),
    false
  );
});

test('classifies fetch-style GET requests without an explicit HTML accept header as API', () => {
  assert.equal(
    isApiRequest({
      originalUrl: '/my-profile',
      method: 'GET',
      headers: { accept: '*/*' }
    }),
    true
  );
});

test('rejects unauthenticated admin API calls with 401', () => {
  const req = { session: {}, originalUrl: '/admin/orders', method: 'GET' };
  const res = createResponse();

  checkAdmin(req, res, () => assert.fail('next must not be called'));

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Nicht angemeldet.' });
});

test('rejects unauthenticated non-GET API calls with 401', () => {
  const req = { session: {}, originalUrl: '/products', method: 'POST' };
  const res = createResponse();

  checkAdmin(req, res, () => assert.fail('next must not be called'));

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Nicht angemeldet.' });
  assert.equal(res.redirectTarget, null);
});

test('redirects unauthenticated page requests to login and stores target', () => {
  const req = {
    session: {},
    originalUrl: '/backend.html',
    method: 'GET',
    headers: { accept: 'text/html' }
  };
  const res = createResponse();

  checkAdmin(req, res, () => assert.fail('next must not be called'));

  assert.equal(req.session.redirectAfterLogin, '/backend.html');
  assert.equal(res.redirectTarget, '/login.html?reason=session_expired');
});

test('handles a missing session without throwing', () => {
  const req = {
    originalUrl: '/backend.html',
    method: 'GET',
    headers: { accept: 'text/html' }
  };
  const res = createResponse();

  checkAdmin(req, res, () => assert.fail('next must not be called'));

  assert.equal(res.redirectTarget, '/login.html?reason=session_expired');
});

test('rejects logged-in non-admin users', () => {
  const req = {
    session: { user: 'user@example.com', role: 'customer' },
    originalUrl: '/admin/orders',
    method: 'GET'
  };
  const res = createResponse();

  checkAdmin(req, res, () => assert.fail('next must not be called'));

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Keine Berechtigung.' });
});
