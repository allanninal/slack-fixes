/**
 * Find Slack channels where the app is replying to its own messages.
 *
 * Read only. Three GET methods and no writes: a bot token with channels:read
 * and channels:history is enough. The repair is printed, never performed.
 */
const API = 'https://slack.com/api';

/**
 * True when this message was authored by the app we authenticated as.
 *
 * Pure, and deliberately narrow: matching on "has a bot_id" would flag every
 * other integration in the channel. Both ids are checked because a modern
 * app-authored message carries bot_id while one posted with a user token
 * carries only `user`. This is the same predicate the repair puts in the
 * event handler.
 */
export function isSelf(message, identity) {
  if (identity.bot_id && message.bot_id === identity.bot_id) return true;
  if (identity.user_id && message.user === identity.user_id) return true;
  return false;
}

/**
 * Classify one channel by its longest run of self-authored messages.
 *
 * Pure, so the thresholds are visible and testable. Length alone is not the
 * signal: a digest job posting a dozen messages in a row is not a loop, so a
 * long run with wide internal gaps gets its own state.
 */
export function verdict(messages, identity, { minRun = 4, burst = 2.0 } = {}) {
  const ordered = [...messages].sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));

  let best = [];
  let bestGaps = [];
  let run = [];
  let gaps = [];
  for (const m of ordered) {
    if (isSelf(m, identity)) {
      if (run.length) gaps.push(Number(m.ts ?? 0) - Number(run[run.length - 1].ts ?? 0));
      run.push(m);
    } else {
      if (run.length > best.length) { best = run; bestGaps = gaps; }
      run = [];
      gaps = [];
    }
  }
  if (run.length > best.length) { best = run; bestGaps = gaps; }

  const n = best.length;
  if (n <= 1) {
    return ['quiet',
      `longest self-authored run is ${n}. Every reply is answering somebody else.`];
  }

  const widest = bestGaps.length ? Math.max(...bestGaps) : 0;

  if (n < minRun) {
    return ['short-run',
      `${n} in a row, ${widest.toFixed(1)}s apart at widest. A threaded reply ` +
      'or a two-part message, not a loop.'];
  }

  if (widest >= burst) {
    return ['batch',
      `${n} in a row but ${widest.toFixed(1)}s apart at widest. That is a ` +
      'poster, not a loop: a digest or a backlog being drained. Worth ' +
      'confirming it is deliberate.'];
  }

  return ['echo-loop',
    `${n} consecutive self-authored messages, none more than ` +
    `${widest.toFixed(2)}s apart, with no human message in the run. The ` +
    'handler is hearing itself.'];
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

async function main() {
  const token = (process.env.SLACK_BOT_TOKEN || "dummy-slack-bot-token");
  if (!token) {
    console.error('set SLACK_BOT_TOKEN (channels:read and channels:history)');
    process.exitCode = 2;
    return;
  }

  const explicit = process.argv.slice(2).filter((a) => !a.startsWith('-'));

  const me = await call(token, 'auth.test');
  const identity = { bot_id: me.bot_id, user_id: me.user_id };
  console.log(`authenticated as ${me.user} (bot_id=${me.bot_id}) in ${me.team}`);

  const targets = await channels(token, explicit);
  if (targets.length === 0) {
    console.log('the bot is not a member of any conversation');
    return;
  }

  let loops = 0;
  for (const ch of targets) {
    const body = await call(token, 'conversations.history',
      { channel: ch.id, limit: 200 });
    const [state, detail] = verdict(body.messages ?? [], identity);
    const name = ch.name ?? ch.id;
    if (state !== 'echo-loop') {
      console.log(`${state.padEnd(10)} #${name}  ${detail}`);
      continue;
    }
    loops += 1;
    console.warn(`${state.padEnd(10)} #${name}  ${detail}`);
    console.warn('  repair: in the handler, return early when event.bot_id is ' +
                 `set, when event.subtype is bot_message, or when event.user == ${identity.user_id}.`);
    console.warn('  better: subscribe to app_mention instead of ' +
                 'message.channels so your own posts never reach the handler.');
  }

  console.log(`${targets.length} channel(s) checked, ${loops} loop(s)`);
  process.exitCode = loops ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and
// without the guard main() would run there too, fail on the missing token, and
// set a non-zero exit code that fails the whole test file even as every test
// passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
