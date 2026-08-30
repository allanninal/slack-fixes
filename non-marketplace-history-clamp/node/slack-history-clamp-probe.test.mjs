import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './slack-history-clamp-probe.mjs';

test('a full page is unclamped', () => {
  const [state, detail] = verdict({
    requested: 200, returned: 200, next_cursor: 'dXNlcjpV',
  });
  assert.equal(state, 'unclamped');
  assert.match(detail, /Tier 3/);
});

test('exactly fifteen with a cursor is the clamp', () => {
  assert.equal(
    verdict({ requested: 200, returned: 15, next_cursor: 'dXNlcjpV' })[0],
    'clamped',
  );
});

test('a refused second call confirms it', () => {
  const [state, detail] = verdict({
    requested: 200, returned: 15, next_cursor: 'dXNlcjpV',
    second_call_error: 'ratelimited',
  });
  assert.equal(state, 'clamped-confirmed');
  assert.match(detail, /ratelimited/);
});

test('exactly fifteen with no cursor is not a finding', () => {
  const [state, detail] = verdict({ requested: 200, returned: 15, next_cursor: '' });
  assert.equal(state, 'inconclusive');
  assert.match(detail, /busier channel/);
});

test('asking for fifteen proves nothing', () => {
  assert.equal(
    verdict({ requested: 15, returned: 15, next_cursor: 'abc' })[0],
    'not-probed',
  );
});

test('a short quiet channel is not clamped', () => {
  assert.equal(
    verdict({ requested: 200, returned: 4, next_cursor: '' })[0],
    'small-channel',
  );
});

test('fewer than the cap with a cursor is something else', () => {
  assert.equal(
    verdict({ requested: 200, returned: 9, next_cursor: 'abc' })[0],
    'short-page',
  );
});
