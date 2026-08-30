import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './slack-channel-membership.mjs';

const ok = (channel) => ({ ok: true, channel });

test('member of a live channel is fine', () => {
  assert.equal(verdict(ok({ name: 'alerts', is_member: true }))[0], 'member');
});

test('archived outranks membership', () => {
  const [state, detail] = verdict(ok({ name: 'old', is_member: true, is_archived: true }));
  assert.equal(state, 'archived');
  assert.match(detail, /unarchived/);
});

test('public channel can be self joined', () => {
  const [state, detail] = verdict(ok({ name: 'general', is_member: false, is_private: false }));
  assert.equal(state, 'not-member-public');
  assert.match(detail, /channels:join/);
});

test('private channel needs a human', () => {
  const [state, detail] = verdict(ok({ name: 'secrets', is_member: false, is_private: true }));
  assert.equal(state, 'not-member-private');
  assert.match(detail, /invite/);
});

test('channel_not_found stays ambiguous', () => {
  const [state, detail] = verdict({ ok: false, error: 'channel_not_found' });
  assert.equal(state, 'not-found');
  assert.match(detail, /groups:read/);
});

test('missing_scope is not a membership answer', () => {
  const [state, detail] = verdict({ ok: false, error: 'missing_scope', needed: 'channels:read' });
  assert.equal(state, 'scope');
  assert.match(detail, /channels:read/);
});

test('other errors are not reported as membership', () => {
  assert.equal(verdict({ ok: false, error: 'invalid_auth' })[0], 'error');
});
