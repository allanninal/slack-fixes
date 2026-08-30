import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, verdict } from './slack-event-silence-audit.mjs';

const BOT = 'B123';
const BOT_USER = 'U999';

function msg(ts, text = 'hello', bot = false) {
  const m = { ts: `${ts}.000100`, text };
  if (bot) m.bot_id = BOT;
  return m;
}

const mention = (ts) => msg(ts, `<@${BOT_USER}> please deploy`);

test('scan separates triggers from replies', () => {
  const stats = scan([mention(100), msg(110, 'unrelated chatter'), msg(120, 'done', true)],
    BOT, BOT_USER);
  assert.equal(stats.triggers, 1);
  assert.equal(stats.replies, 1);
  assert.equal(stats.unanswered, 0);
});

test('the bots own mention of itself is not a trigger', () => {
  const messages = [msg(100, `<@${BOT_USER}> was asked`, true)];
  assert.equal(scan(messages, BOT, BOT_USER).triggers, 0);
});

test('a run of mentions after the last reply is the finding', () => {
  const messages = [msg(1000, 'on it', true), mention(5000), mention(9000), mention(13000)];
  const [state, detail] = verdict(scan(messages, BOT, BOT_USER));
  assert.equal(state, 'silent');
  assert.match(detail, /3 mention\(s\)/);
});

test('an app that never replied is a different diagnosis', () => {
  const messages = [mention(1000), mention(2000), mention(3000), mention(4000)];
  const [state, detail] = verdict(scan(messages, BOT, BOT_USER));
  assert.equal(state, 'never-answered');
  assert.match(detail, /never configured/);
});

test('a reply after the last mention is healthy', () => {
  const messages = [mention(1000), msg(1100, 'done', true)];
  assert.equal(verdict(scan(messages, BOT, BOT_USER))[0], 'answering');
});

test('one unanswered mention is not enough', () => {
  const messages = [msg(1000, 'done', true), mention(2000)];
  assert.equal(verdict(scan(messages, BOT, BOT_USER))[0], 'too-little-evidence');
});

test('a quiet channel is not evidence', () => {
  const messages = [msg(1000, 'morning'), msg(2000, 'morning')];
  assert.equal(verdict(scan(messages, BOT, BOT_USER))[0], 'no-triggers');
});

test('the threshold is adjustable', () => {
  const messages = [msg(1000, 'done', true), mention(2000), mention(3000)];
  assert.equal(verdict(scan(messages, BOT, BOT_USER), 2)[0], 'silent');
});
