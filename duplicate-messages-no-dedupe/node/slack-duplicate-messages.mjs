/**
 * Find app-authored Slack messages that were posted more than once.
 *
 * Read only. Three GET methods and no writes: a bot token with channels:read
 * and channels:history is enough. The repair is printed, never performed.
 */
import { createHash } from 'node:crypto';

const API = 'https://slack.com/api';

// Slack redelivers an event that was not acknowledged in three seconds, once at
// roughly a minute and again at roughly five.
const RETRY_GAPS = [60, 300];

// Two runs of the same cron job land far enough apart that nothing else
// explains them. Half an hour is deliberately conservative.
const RERUN_GAP = 1800;

/**
 * Content hash for one message. Pure, so grouping is testable offline.
 *
 * Text alone is not enough: a Block Kit message usually carries a fallback in
 * `text` that is identical across every alert, so hashing that field on its own
 * merges unrelated messages into one false duplicate group. `ts` is excluded on
 * purpose, being the field guaranteed to differ between copies.
 */
export function fingerprint(message) {
  const payload = JSON.stringify([message.text ?? '', message.blocks ?? []]);
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function near(gap, target, tolerance) {
  return Math.abs(gap - target) <= target * tolerance;
}

/**
 * Name the cause of one duplicate group from the spacing of its copies.
 *
 * Pure, so the thresholds are visible and testable. Returns [state, detail];
 * a group matching no known spacing is reported as unclassified rather than
 * pushed into the nearest bucket.
 */
export function classify(timestamps, { tolerance = 0.25 } = {}) {
  const ts = timestamps.map(Number).sort((a, b) => a - b);
  const n = ts.length;
  if (n < 2) return ['unique', 'one message, nothing to explain'];

  const gaps = ts.slice(1).map((t, i) => t - ts[i]);
  const span = ts[n - 1] - ts[0];

  if (Math.max(...gaps) < 1) {
    return ['double-delivery',
      `${n} copies inside ${span.toFixed(2)}s. Sub-second spacing is two ` +
      'delivery paths handling one event, not a retry: app_mention and ' +
      'message.channels both subscribed, or Socket Mode running alongside a ' +
      'live Request URL.'];
  }

  if (gaps.every((g) => RETRY_GAPS.some((r) => near(g, r, tolerance)))) {
    return ['retry-duplicate',
      `${n} copies spaced ${gaps.map((g) => `${g.toFixed(0)}s`).join(', ')}. ` +
      "That is Slack's retry schedule: the handler did not acknowledge inside " +
      'three seconds and did the work again on redelivery.'];
  }

  if (Math.min(...gaps) >= RERUN_GAP) {
    return ['rerun',
      `${n} copies over ${(span / 3600).toFixed(1)} hour(s). Too far apart for ` +
      'a retry: two scheduler runs, a redeployed worker replaying a queue, or ' +
      'a backfill run twice.'];
  }

  return ['duplicated',
    `${n} copies over ${span.toFixed(1)}s, spacing matches no known cause. ` +
    'Worth reading by hand before you change anything.'];
}

async function call(token, method, params = {}) {
  const url = new URL(`${API}/${method}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status} from ${method}`);
  const body = await res.json();
  // Slack answers almost every failure with HTTP 200 and puts the error in the
  // body, so the body is what gets asserted on.
  if (!body.ok) {
    throw new Error(`${method}: ${body.error} (needed=${body.needed} ` +
                    `provided=${body.provided})`);
  }
  return body;
}

async function channels(token, explicit) {
  if (explicit.length) return explicit.map((id) => ({ id, name: id }));
  const out = [];
  let cursor = '';
  for (;;) {
    const body = await call(token, 'users.conversations',
      { limit: 200, types: 'public_channel,private_channel', cursor });
    out.push(...(body.channels ?? []));
    cursor = body.response_metadata?.next_cursor ?? '';
    if (!cursor) return out;
  }
}

async function history(token, channel, limit) {
  const out = [];
  let cursor = '';
  while (out.length < limit) {
    const body = await call(token, 'conversations.history',
      { channel, limit: Math.min(200, limit - out.length), cursor });
    out.push(...(body.messages ?? []));
    cursor = body.response_metadata?.next_cursor ?? '';
    if (!cursor) break;
  }
  return out.slice(0, limit);
}

async function main() {
  const token = (process.env.SLACK_BOT_TOKEN || "dummy-slack-bot-token");
  if (!token) {
    console.error('set SLACK_BOT_TOKEN (channels:read and channels:history)');
    process.exitCode = 2;
    return;
  }

  const explicit = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const limit = 200;

  const me = await call(token, 'auth.test');
  console.log(`authenticated as ${me.user} (bot_id=${me.bot_id}) in ${me.team}`);

  const targets = await channels(token, explicit);
  if (targets.length === 0) {
    console.log('the bot is not a member of any conversation');
    return;
  }

  let findings = 0;
  let authored = 0;
  for (const ch of targets) {
    const messages = await history(token, ch.id, limit);
    const mine = messages.filter((m) =>
      (me.bot_id && m.bot_id === me.bot_id) || (me.user_id && m.user === me.user_id));
    authored += mine.length;

    const groups = new Map();
    for (const m of mine) {
      const key = fingerprint(m);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }

    for (const [key, group] of [...groups].sort()) {
      const [state, detail] = classify(group.map((m) => m.ts));
      if (state === 'unique') continue;
      findings += 1;
      console.warn(`${state.padEnd(16)} #${ch.name ?? ch.id}  ${detail}`);
      console.warn(`  first ts ${group[0].ts}  fingerprint ${key}`);
      if (state === 'retry-duplicate') {
        console.warn('  repair: acknowledge the event inside 3s and do the work ' +
                     'after; key on event.event_id in a short-TTL set.');
      } else if (state === 'double-delivery') {
        console.warn('  repair: one delivery path per app. Drop either ' +
                     'app_mention or message.channels, and do not leave a ' +
                     'Request URL configured while Socket Mode is on.');
      } else if (state === 'rerun') {
        console.warn('  repair: take a per-job lock, or post once and ' +
                     'chat.update the same ts as the state changes.');
      }
    }
  }

  console.log(`${targets.length} channel(s), ${authored} app-authored ` +
              `message(s), ${findings} duplicate group(s)`);
  process.exitCode = findings ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and
// without the guard main() would run there too, fail on the missing token, and
// set a non-zero exit code that fails the whole test file even as every test
// passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
