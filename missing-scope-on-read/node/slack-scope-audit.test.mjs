import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScopes, verdict } from './slack-scope-audit.mjs';

test('scope header is split and trimmed', () => {
  assert.deepEqual(parseScopes('channels:read, users:read ,chat:write'),
    ['channels:read', 'chat:write', 'users:read']);
});

test('absent scope header is empty not a crash', () => {
  assert.deepEqual(parseScopes(null), []);
  assert.deepEqual(parseScopes(''), []);
});

test('a successful call needs nothing', () => {
  assert.equal(verdict(['channels:read'], { ok: true })[0], 'ok');
});

test('missing_scope names the alternatives as a choice', () => {
  const body = {
    ok: false, error: 'missing_scope',
    needed: 'channels:history,groups:history',
    provided: 'chat:write,users:read',
  };
  const [state, detail] = verdict(['chat:write', 'users:read'], body);
  assert.equal(state, 'missing-scope');
  assert.match(detail, /any one of/);
  assert.match(detail, /channels:history/);
  assert.match(detail, /reinstalled/);
});

test('credential errors are not scope errors', () => {
  const [state, detail] = verdict([], { ok: false, error: 'not_allowed_token_type' });
  assert.equal(state, 'wrong-token');
  assert.match(detail, /will not change it/);
});

test('unrelated errors do not become scope findings', () => {
  assert.equal(verdict(['channels:read'], { ok: false, error: 'channel_not_found' })[0],
    'other');
});

test('missing_scope without a needed field still reports', () => {
  const [state, detail] = verdict([], { ok: false, error: 'missing_scope' });
  assert.equal(state, 'missing-scope');
  assert.match(detail, /did not name one/);
});

test('a granted list that contradicts the response is its own state', () => {
  const body = { ok: false, error: 'missing_scope', needed: 'channels:history' };
  const [state, detail] = verdict(['channels:history'], body);
  assert.equal(state, 'scope-list-mismatch');
  assert.match(detail, /X-OAuth-Scopes/);
});
