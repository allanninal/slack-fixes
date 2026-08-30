/**
 * Find channels where a Slack app is addressed and has stopped answering.
 *
 * Read only. GET requests and nothing else: channels:history and membership are
 * enough. This detects the symptom of disabled event delivery, not the flag: no
 * read method reports whether Slack is delivering, so the repair ends at the app
 * configuration page and is printed, never performed.
 */
const API = 'https://slack.com/api/';

/**
 * Reduce one page of history to the four numbers that matter. Pure.
 * A trigger is a message mentioning the bot that the bot did not write; a reply
 * is any message carrying the app's own bot_id.
 */
export function scan(messages, botId, botUserId) {
  const mention = `<@${botUserId}>`;
  const replies = [];
  const triggers = [];
  for (const m of messages) {
    const ts = Number(m.ts ?? 0);
    if (m.bot_id === botId) replies.push(ts);
    else if ((m.text ?? '').includes(mention)) triggers.push(ts);
  }
  const lastReply = replies.length ? Math.max(...replies) : null;
  const lastTrigger = triggers.length ? Math.max(...triggers) : null;
  const unanswered = triggers.filter((t) => lastReply === null || t > lastReply).length;
  return {
    replies: replies.length, triggers: triggers.length,
    lastReply, lastTrigger, unanswered,
  };
}

/**
 * Decide whether the silence is evidence. Pure, and mostly a refusal.
 * Delivery disabled, the handler down and events never subscribed to all produce
 * this shape, so the states name the shape and not the cause.
 */
export function verdict(stats, minTriggers = 3) {
  if (!stats.triggers) {
    return ['no-triggers',
      'nothing addressed the app in this window, so there is no evidence either ' +
      'way. Silence is not a finding on its own.'];
  }
  if (!stats.unanswered) {
    return ['answering',
      `${stats.triggers} mention(s), and the app replied after the most recent one`];
  }
  if (!stats.replies) {
    return ['never-answered',
      `${stats.triggers} mention(s) and the app has never posted here. That points ` +
      'at subscriptions never configured or a Request URL that never verified, ' +
      'rather than at delivery being switched off.'];
  }
  if (stats.unanswered >= minTriggers) {
    const hours = (stats.lastTrigger - stats.lastReply) / 3600;
    return ['silent',
      `${stats.unanswered} mention(s) since the app last replied, spanning ` +
      `${hours.toFixed(1)} hour(s). It was answering and then stopped: check ` +
      'whether Slack disabled event delivery.'];
  }
  return ['too-little-evidence',
    `${stats.unanswered} unanswered mention(s), below the ${minTriggers} needed to ` +
    "call it. People type a bot's name without expecting an answer."];
}

async function get(token, method, params = {}) {
  const url = new URL(API + method);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  try {
    return await res.json();
  } catch {
    return { ok: false, error: 'unparseable_body' };
  }
}

async function main() {
  const token = (process.env.SLACK_BOT_TOKEN || "dummy-slack-bot-token");
  if (!token) {
    console.error('set SLACK_BOT_TOKEN (channels:history and membership are enough)');
    process.exitCode = 2;
    return;
  }

  const argv = process.argv.slice(2);
  const li = argv.indexOf('--limit');
  const mi = argv.indexOf('--min-triggers');
  const limit = li === -1 ? '200' : argv[li + 1];
  const minTriggers = mi === -1 ? 3 : Number(argv[mi + 1]);
  const channels = argv.filter((a, n) => !a.startsWith('--')
    && argv[n - 1] !== '--limit' && argv[n - 1] !== '--min-triggers');

  if (!channels.length) {
    console.error('usage: node slack-event-silence-audit.mjs C0123ABCDEF [C...]');
    process.exitCode = 2;
    return;
  }

  const me = await get(token, 'auth.test');
  if (me.ok !== true) {
    console.error(`auth.test answered 200 with ok: false, error=${me.error}`);
    process.exitCode = 2;
    return;
  }
  const botId = me.bot_id;
  const botUser = me.user_id;
  console.log(`app is ${me.user} (bot_id=${botId}, mentioned as <@${botUser}>)`);

  let bad = 0;
  for (const cid of channels) {
    const body = await get(token, 'conversations.history', { channel: cid, limit });
    if (body.ok !== true) {
      bad += 1;
      console.warn(`${'unreadable'.padEnd(20)} ${cid.padEnd(12)} history refused: ` +
                   `error=${body.error}. Membership and channels:history come ` +
                   'first; this audit assumes both');
      continue;
    }
    const stats = scan(body.messages ?? [], botId, botUser);
    const [state, detail] = verdict(stats, minTriggers);
    const line = `${state.padEnd(20)} ${cid.padEnd(12)} ${detail}`;
    if (state === 'silent' || state === 'never-answered') {
      bad += 1;
      console.warn(line);
      console.warn('  the Web API cannot tell you whether Slack disabled delivery: ' +
                   'open Event Subscriptions in the app config');
      console.warn('  repair: fix the endpoint, re-enable delivery by hand, then ' +
                   'alert on the Request URL before 95% of an hour fails');
    } else {
      console.log(line);
    }
  }

  console.log(`${channels.length} channel(s) checked, ${bad} where the app has gone quiet`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly, so importing this module in the tests does not
// execute main() and fail the file on a missing token.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
