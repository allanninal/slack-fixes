/**
 * Report Slack channels the bot cannot post to, and why.
 *
 * Read only. GET requests and nothing else: give this a bot token with
 * channels:read and groups:read. The repair is printed, never performed.
 */
const API = 'https://slack.com/api/';

/**
 * Classify one conversations.info response. Pure, so it runs offline.
 *
 * Order matters: an archived channel refuses everyone, so it outranks
 * membership, and ok: false outranks both because there is no channel object to
 * read at all.
 */
export function verdict(body) {
  if (body.ok !== true) {
    const error = body.error ?? '<no error field>';
    if (error === 'channel_not_found') {
      return ['not-found',
        'channel_not_found. Either the ID is wrong, or it is a private channel ' +
        'this token cannot see. Those are indistinguishable without groups:read.'];
    }
    if (error === 'missing_scope') {
      return ['scope',
        `missing_scope: needed=${body.needed ?? '?'}. Membership is unknown until ` +
        'the token can read the channel.'];
    }
    return ['error', `ok: false, error=${error}`];
  }

  const channel = body.channel ?? {};
  if (channel.is_archived) {
    return ['archived',
      'archived. Membership is beside the point: an archived channel accepts ' +
      'nothing from anyone until it is unarchived.'];
  }
  if (channel.is_member) return ['member', 'the bot is in this channel'];
  if (channel.is_private) {
    return ['not-member-private',
      'not a member, and private. No API call joins a private channel: a human ' +
      'member has to invite the app.'];
  }
  return ['not-member-public',
    'not a member. Public, so the app can join itself with channels:join, or ' +
    'somebody can invite it.'];
}

async function get(token, method, params = {}) {
  const url = new URL(API + method);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

async function main() {
  const token = (process.env.SLACK_BOT_TOKEN || "dummy-slack-bot-token");
  if (!token) {
    console.error('set SLACK_BOT_TOKEN (channels:read and groups:read are enough)');
    process.exitCode = 2;
    return;
  }
  const channels = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (channels.length === 0) {
    console.error('usage: node slack-channel-membership.mjs C0123ABCDEF [...]');
    process.exitCode = 2;
    return;
  }

  const me = await get(token, 'auth.test');
  if (me.ok !== true) {
    console.error(`auth.test answered 200 with ok: false, error=${me.error}`);
    process.exitCode = 2;
    return;
  }
  const bot = me.user_id;
  console.log(`token acts as ${me.user} (${bot}) in ${me.team}`);

  let bad = 0;
  for (const cid of channels) {
    const body = await get(token, 'conversations.info', { channel: cid });
    const [state, detail] = verdict(body);
    const name = body.channel?.name ?? '?';
    const line = `${state.padEnd(19)} ${cid.padEnd(12)} #${name}  ${detail}`;
    if (state === 'member') { console.log(line); continue; }
    bad += 1;
    console.warn(line);
    if (state === 'not-member-public') {
      console.warn(`  repair: /invite @YourApp in #${name}, or call conversations.join ` +
                   'with channels:join');
      console.warn(`  in a pipeline: conversations.invite channel=${cid} users=${bot}`);
    } else if (state === 'not-member-private') {
      console.warn('  repair: a member of the private channel runs /invite @YourApp; ' +
                   'the app cannot let itself in');
    } else if (state === 'archived') {
      console.warn('  repair: unarchive the channel, or point the app at a live one');
    } else if (state === 'not-found') {
      console.warn('  repair: check the ID, then add groups:read and reinstall if the ' +
                   'channel is private');
    }
  }

  console.log(`${channels.length} channel(s) checked, ${bad} the bot cannot post to`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly, so importing this module from the test file
// does not execute main() and fail the suite on a missing token.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
