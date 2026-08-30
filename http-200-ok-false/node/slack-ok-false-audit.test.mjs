import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './slack-ok-false-audit.mjs';

test('two hundred with ok false is a failure', () => {
  const [state, detail] = verdict(200, { ok: false, error: 'not_in_channel' });
  assert.equal(state, 'ok-false');
  assert.match(detail, /not_in_channel/);
});

test('two hundred with ok true is the only success', () => {
  assert.equal(verdict(200, { ok: true })[0], 'ok');
});

test('missing ok field is not silently a success', () => {
  const [state, detail] = verdict(200, { channels: [] });
  assert.equal(state, 'ok-false');
  assert.match(detail, /no error field/);
});

test('warning on a successful call is its own state', () => {
  const [state, detail] = verdict(200, { ok: true, warning: 'missing_charset' });
  assert.equal(state, 'warned');
  assert.match(detail, /missing_charset/);
});

test('response_metadata warnings are read too', () => {
  const body = { ok: true, response_metadata: { warnings: ['superfluous_charset'] } };
  assert.equal(verdict(200, body)[0], 'warned');
});

test('non json body is not a slack answer', () => {
  assert.equal(verdict(200, '<html>proxy error</html>')[0], 'unreadable');
});

test('real status codes are still real', () => {
  const [state, detail] = verdict(429, { ok: false, error: 'ratelimited' });
  assert.equal(state, 'transport');
  assert.match(detail, /429/);
});
