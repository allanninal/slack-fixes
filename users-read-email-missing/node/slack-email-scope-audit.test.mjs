import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScopes, verdict } from './slack-email-scope-audit.mjs';

function human(id, email) {
  const profile = { real_name: 'A Person' };
  if (email) profile.email = email;
  return { id, deleted: false, is_bot: false, profile };
}

test('no emails and no scope is the finding', () => {
  const [state, detail] = verdict([human('U1'), human('U2')], new Set(['users:read']));
  assert.equal(state, 'scope-missing');
  assert.match(detail, /0 of 2/);
});

test('no emails with the scope is not a scope problem', () => {
  const [state, detail] = verdict(
    [human('U1'), human('U2')], new Set(['users:read', 'users:read.email']));
  assert.equal(state, 'scope-granted-none-visible');
  assert.match(detail, /admin policy/);
});

test('a few missing is ordinary and says so', () => {
  const [state, detail] = verdict(
    [human('U1', 'a@example.com'), human('U2')],
    new Set(['users:read', 'users:read.email']));
  assert.equal(state, 'partial');
  assert.match(detail, /per member/);
});

test('every human with an email is complete', () => {
  const members = [human('U1', 'a@example.com'), human('U2', 'b@example.com')];
  assert.equal(verdict(members, new Set(['users:read.email']))[0], 'complete');
});

test('bots and deactivated accounts are not in the denominator', () => {
  const members = [
    human('U1', 'a@example.com'),
    { id: 'U2', deleted: true, is_bot: false, profile: {} },
    { id: 'B1', deleted: false, is_bot: true, profile: {} },
    { id: 'USLACKBOT', deleted: false, is_bot: false, profile: {} },
  ];
  const [state, detail] = verdict(members, new Set(['users:read.email']));
  assert.equal(state, 'complete');
  assert.match(detail, /1 of 1/);
});

test('a page of only bots yields no verdict', () => {
  const members = [{ id: 'B1', deleted: false, is_bot: true, profile: {} }];
  assert.equal(verdict(members, new Set())[0], 'no-humans');
});

test('scope header parsing survives spaces and absence', () => {
  assert.deepEqual(
    [...parseScopes('users:read, users:read.email ,team:read')].sort(),
    ['team:read', 'users:read', 'users:read.email']);
  assert.equal(parseScopes(null).size, 0);
  assert.equal(parseScopes('').size, 0);
});
