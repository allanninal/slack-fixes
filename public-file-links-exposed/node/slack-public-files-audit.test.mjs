import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, humanSize } from './slack-public-files-audit.mjs';

test('a public URL is an exposure', () => {
  const [state, detail] = verdict({ public_url_shared: true, channels: ['C1'] });
  assert.equal(state, 'exposed');
  assert.match(detail, /no login/);
});

test('a public URL on a file in no channel is worse', () => {
  const [state, detail] = verdict({
    public_url_shared: true, channels: [], groups: [], ims: [],
  });
  assert.equal(state, 'exposed-orphan');
  assert.match(detail, /no channel/);
});

test('is_public alone is not an exposure', () => {
  const [state, detail] = verdict({ is_public: true, channels: ['C1'] });
  assert.equal(state, 'workspace-visible');
  assert.match(detail, /Not an exposure/);
});

test('a private file is private', () => {
  assert.equal(verdict({ channels: ['C1'] })[0], 'private');
});

test('an external file is not judged by Slack flags', () => {
  assert.equal(verdict({ is_external: true, public_url_shared: true })[0], 'external');
});

test('a file with no flags at all is private', () => {
  assert.equal(verdict({})[0], 'private');
});

test('sizes are rendered in the nearest unit', () => {
  assert.equal(humanSize(2048), '2KB');
});
