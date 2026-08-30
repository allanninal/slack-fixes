import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cursorOf, verdict } from './slack-pagination-audit.mjs';

test('absent response_metadata means the end', () => {
  assert.equal(cursorOf({ ok: true, channels: [] }), '');
});

test('null and empty cursors mean the end too', () => {
  assert.equal(cursorOf({ response_metadata: { next_cursor: null } }), '');
  assert.equal(cursorOf({ response_metadata: { next_cursor: '   ' } }), '');
});

test('a real cursor survives', () => {
  assert.equal(cursorOf({ response_metadata: { next_cursor: 'dGVhbTpDMDYx' } }),
    'dGVhbTpDMDYx');
});

test('full page with a cursor is the truncation signature', () => {
  const [state, detail] = verdict(100, 100, 'dGVhbTpD');
  assert.equal(state, 'truncated');
  assert.match(detail, /100/);
});

test('short page with a cursor still has more', () => {
  const [state, detail] = verdict(37, 100, 'dGVhbTpD');
  assert.equal(state, 'more-pages');
  assert.match(detail, /not the last page/);
});

test('full page without a cursor is complete but not reassuring', () => {
  const [state, detail] = verdict(100, 100, '');
  assert.equal(state, 'complete-at-limit');
  assert.match(detail, /luck/);
});

test('short page without a cursor is the whole set', () => {
  assert.equal(verdict(42, 100, '')[0], 'complete');
});

test('the full walk reports what is being missed', () => {
  const [, detail] = verdict(100, 100, 'dGVhbTpD', 412);
  assert.match(detail, /412/);
  assert.match(detail, /misses 312/);
});
