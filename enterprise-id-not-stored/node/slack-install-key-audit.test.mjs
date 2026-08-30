import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collisions, verdict } from './slack-install-key-audit.mjs';

test('grid install with no stored enterprise_id is the finding', () => {
  const [state, detail] = verdict(
    { key: 'T111' },
    { ok: true, team_id: 'T111', enterprise_id: 'E999', is_enterprise_install: false },
  );
  assert.equal(state, 'enterprise-id-dropped');
  assert.match(detail, /E999/);
});

test('org wide install filed under a workspace key', () => {
  const [state] = verdict(
    { key: 'T111', enterprise_id: 'E999' },
    { ok: true, team_id: null, enterprise_id: 'E999', is_enterprise_install: true },
  );
  assert.equal(state, 'org-install-under-team-key');
});

test('row pointing at another org is a credential handout', () => {
  const [state, detail] = verdict(
    { key: 'E1.T111', enterprise_id: 'E1' },
    { ok: true, team_id: 'T111', enterprise_id: 'E2', is_enterprise_install: false },
  );
  assert.equal(state, 'enterprise-id-wrong');
  assert.match(detail, /another organisation/);
});

test('plain workspace install is not reported', () => {
  const [state, detail] = verdict(
    { key: 'T111' },
    { ok: true, team_id: 'T111', enterprise_id: null, is_enterprise_install: false },
  );
  assert.equal(state, 'single-workspace');
  assert.match(detail, /migrates to an org/);
});

test('key that does not round trip', () => {
  const [state] = verdict(
    { key: 'T222' },
    { ok: true, team_id: 'T111', enterprise_id: null, is_enterprise_install: false },
  );
  assert.equal(state, 'key-drift');
});

test('dead token is reported rather than guessed at', () => {
  assert.equal(verdict({ key: 'T111' }, { ok: false, error: 'token_revoked' })[0], 'unusable');
});

test('same team under two orgs is a cross row finding', () => {
  const [teams, keys] = collisions([
    { key: 'T111', team_id: 'T111', enterprise_id: 'E1' },
    { key: 'T111', team_id: 'T111', enterprise_id: 'E2' },
  ]);
  assert.deepEqual(teams, ['T111']);
  assert.deepEqual(keys, ['T111']);
});

test('distinct installs do not collide', () => {
  const [teams, keys] = collisions([
    { key: 'E1.T111', team_id: 'T111', enterprise_id: 'E1' },
    { key: 'E2.T222', team_id: 'T222', enterprise_id: 'E2' },
  ]);
  assert.deepEqual(teams, []);
  assert.deepEqual(keys, []);
});
