/**
 * Detect Slack's non-Marketplace clamp on conversations.history.
 *
 * Read only, and detect-only: there is no setting that lifts this clamp, so the
 * script reports what it found and prints the three real remedies. A bot token
 * with channels:read and channels:history is enough.
 */
const API = 'https://slack.com/api';

// The documented ceiling for a non-Marketplace app on conversations.history and
// conversations.replies since 29 May 2025: 15 objects, one request per minute.
export const CAP = 15;

/**
 * Name the state of one history probe. Pure, so the rule is testable offline.
 *
 * Two of the states exist to say the probe cannot tell: asking for 15 or fewer
 * proves nothing, and a page of exactly 15 with no cursor is a channel that ran
 * out of messages rather than a clamp. Reporting either as clamped sends
 * somebody to the Marketplace over a quiet channel.
 */
export function verdict(probe, { cap = CAP } = {}) {
  const requested = Number(probe.requested ?? 0);
  const returned = Number(probe.returned ?? 0);
  const cursor = String(probe.next_cursor ?? '').trim();
  const throttled = String(probe.second_call_error ?? '').trim() === 'ratelimited';

  if (requested <= cap) {
    return ['not-probed',
      `asked for ${requested}, which is at or below the ${cap}-object cap. ` +
      `Ask for more than ${cap} or the answer means nothing.`];
  }

  if (returned > cap) {
    return ['unclamped', `asked for ${requested}, got ${returned}. Tier 3 limits intact.`];
  }

  if (returned === cap && cursor && throttled) {
    return ['clamped-confirmed',
      `asked for ${requested}, got exactly ${cap} with more pages waiting, and ` +
      'the second call inside the minute was refused with ratelimited. That is ' +
      'the non-Marketplace clamp.'];
  }

  if (returned === cap && cursor) {
    return ['clamped',
      `asked for ${requested}, got exactly ${cap} and a cursor, so Slack has ` +
      `more and is handing over ${cap}. The second call was not refused; ` +
      'repeat the probe to confirm the 1-per-minute half.'];
  }

  if (returned === cap) {
    return ['inconclusive',
      `got exactly ${cap} with no cursor. A clamped page and a channel with ` +
      `${cap} messages left look identical here. Probe a busier channel.`];
  }

  if (cursor) {
    return ['short-page',
      `got ${returned} of ${requested} with a cursor still set. Fewer than the ` +
      'clamp would give, so this is not it: look at the channel, the ' +
      'oldest/latest window, or a shared quota.'];
  }

  return ['small-channel',
    `got ${returned} of ${requested} and no cursor. The channel simply has ` +
    'that many messages; nothing is clamped.'];
}

/**
 * One Web API read. Returns { body, retryAfter }. A ratelimited answer is the
 * finding here rather than an error, so it is returned instead of thrown, and
 * Slack sends it both as a real 429 and as a 200 carrying ok false.
 */
async function call(token, method, params = {}) {
  const url = new URL(`${API}/${method}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const retryAfter = res.headers.get('retry-after');
  if (res.status === 429) return { body: { ok: false, error: 'ratelimited' }, retryAfter };
  if (!res.ok) throw new Error(`${res.status} from ${method}`);
  const body = await res.json();
  if (!body.ok && body.error !== 'ratelimited') {
    throw new Error(`${method}: ${body.error} (needed=${body.needed} ` +
                    `provided=${body.provided})`);
  }
  return { body, retryAfter };
}

async function main() {
  const token = (process.env.SLACK_BOT_TOKEN || "dummy-slack-bot-token");
  if (!token) {
    console.error('set SLACK_BOT_TOKEN (channels:read and channels:history)');
    process.exitCode = 2;
    return;
  }

  const limit = 200;
  const { body: me } = await call(token, 'auth.test');
  console.log(`authenticated as ${me.user} in ${me.team}`);

  let channel = process.argv.slice(2).find((a) => !a.startsWith('-'));
  if (!channel) {
    const { body } = await call(token, 'users.conversations',
      { limit: 200, types: 'public_channel' });
    const channels = [...(body.channels ?? [])]
      .sort((a, b) => Number(b.num_members ?? 0) - Number(a.num_members ?? 0));
    if (channels.length === 0) {
      console.error('no channels available; pass a channel id');
      process.exitCode = 2;
      return;
    }
    channel = channels[0].id;
    console.log(`probing #${channels[0].name} (${channel})`);
  }

  const { body: first } = await call(token, 'conversations.history', { channel, limit });
  if (!first.ok) {
    console.error('first call was already ratelimited; wait a minute and retry');
    process.exitCode = 2;
    return;
  }

  const { body: second, retryAfter } = await call(token, 'conversations.history',
    { channel, limit });

  const [state, detail] = verdict({
    requested: limit,
    returned: (first.messages ?? []).length,
    next_cursor: first.response_metadata?.next_cursor,
    second_call_error: second.error,
  });

  console.log(`${state.padEnd(18)} ${channel}  ${detail}`);
  if (retryAfter) console.log(`  Retry-After on the second call: ${retryAfter}`);

  const { body: control } = await call(token, 'conversations.list',
    { limit: 200, exclude_archived: 'true' });
  console.log(`  control: conversations.list?limit=200 returned ` +
              `${(control.channels ?? []).length}`);

  if (state.startsWith('clamped')) {
    console.warn('  no setting lifts this. The three real remedies:');
    console.warn('   1. get the app approved for the Slack Marketplace, which ' +
                 'restores Tier 3');
    console.warn('   2. if it runs inside one organisation only, reclassify it ' +
                 'as an internal customer-built app, which is exempt');
    console.warn('   3. stop polling history: subscribe to message.channels and ' +
                 'message.groups, keep your own store, and let history become a ' +
                 'rare backfill');
    console.warn(`  meanwhile drop any hardcoded limit=1000 to ${CAP} so ` +
                 'pagination stops assuming pages it will not get');
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and
// without the guard main() would run there too, fail on the missing token, and
// set a non-zero exit code that fails the whole test file even as every test
// passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
