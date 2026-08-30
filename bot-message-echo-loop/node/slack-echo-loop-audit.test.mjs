import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSelf, verdict } from './slack-echo-loop-audit.mjs';

const ME = { bot_id: 'B111', user_id: 'U111' };

const msg = (ts, { bot, user } = {}) => {
  const m = { ts: String(ts) };
  if (bot) m.bot_id = bot;
  if (user) m.user = user;
  return m;
};

test('another app bot message is not ours', () => {
  assert.equal(isSelf(msg(1, { bot: 'B999' }), ME), false);
});

test('our bot id and our user id both count', () => {
  assert.equal(isSelf(msg(1, { bot: 'B111' }), ME), true);
  assert.equal(isSelf(msg(2, { user: 'U111' }), ME), true);
});

test('replies interleaved with humans are quiet', () => {
  const messages = [msg(1, { user: 'U777' }), msg(2, { bot: 'B111' }),
    msg(3, { user: 'U777' }), msg(4, { bot: 'B111' })];
  assert.equal(verdict(messages, ME)[0], 'quiet');
});

test('a fast unbroken run is the loop', () => {
  const messages = Array.from({ length: 12 }, (_, i) => msg(1000 + i * 0.3, { bot: 'B111' }));
  const [state, detail] = verdict(messages, ME);
  assert.equal(state, 'echo-loop');
  assert.match(detail, /12/);
});

test('a slow long run is a batch, not a loop', () => {
  const messages = Array.from({ length: 12 }, (_, i) => msg(1000 + i * 5, { bot: 'B111' }));
  assert.equal(verdict(messages, ME)[0], 'batch');
});

test('history arriving newest first is still measured correctly', () => {
  const messages = Array.from({ length: 9 }, (_, i) => msg(1000 + i * 0.3, { bot: 'B111' })).reverse();
  assert.equal(verdict(messages, ME)[0], 'echo-loop');
});

test('two in a row is a short run', () => {
  const messages = [msg(1, { user: 'U777' }), msg(2, { bot: 'B111' }), msg(2.4, { bot: 'B111' })];
  assert.equal(verdict(messages, ME)[0], 'short-run');
});
