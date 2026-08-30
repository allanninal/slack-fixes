/**
 * Decide whether Slack profiles have no email, or the token may not see it.
 *
 * Read only. GET requests and nothing else: users:read is enough to run this,
 * and whether users:read.email is present is the thing being measured. The
 * repair is a scope change and a reinstall, and is printed rather than done.
 */
const API = 'https://slack.com/api/';
export const EMAIL_SCOPE = 'users:read.email';

/**
 * Turn an X-OAuth-Scopes header into a Set. Pure. Slack sends a comma separated
 * list, sometimes with spaces, and sometimes not at all on a proxied response.
 */
export function parseScopes(header) {
  if (!header) return new Set();
  return new Set(header.split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * Census the members and decide what the missing emails mean. Pure.
 * Bots and deactivated accounts are excluded from the denominator: they have no
 * email to show, and counting them turns a clean finding into a ratio.
 */
export function verdict(members, scopes) {
  const humans = members.filter(
    (m) => !m.deleted && !m.is_bot && m.id !== 'USLACKBOT');
  const total = humans.length;
  if (!total) {
    return ['no-humans',
      'no active human members in the page(s) read, so there is nothing to ' +
      'census. Page further before concluding anything.'];
  }

  const withEmail = humans.filter((m) => m.profile?.email).length;
  const granted = scopes.has(EMAIL_SCOPE);

  if (withEmail === 0 && !granted) {
    return ['scope-missing',
      `0 of ${total} humans have an email and ${EMAIL_SCOPE} is not on this ` +
      'token. The field is withheld, not absent: nothing errored because ' +
      'nothing was refused.'];
  }
  if (withEmail === 0) {
    return ['scope-granted-none-visible',
      `0 of ${total} humans have an email even though ${EMAIL_SCOPE} is granted. ` +
      'That is admin policy or Grid restriction, not the scope, and no reinstall ' +
      'will change it.'];
  }
  if (withEmail < total) {
    const note = granted ? ''
      : `; note ${EMAIL_SCOPE} is absent, so something other than this token supplied them`;
    return ['partial',
      `${withEmail} of ${total} humans have an email${note}. Guests, unconfirmed ` +
      'accounts and admin-hidden addresses look exactly like this, so assert per ' +
      'member rather than per run.'];
  }
  return ['complete',
    `${withEmail} of ${total} humans have an email; ${EMAIL_SCOPE} is granted`];
}

async function pageUsers(token, limit, maxPages) {
  const members = [];
  let cursor = '';
  let scopes = new Set();
  let pages = 0;
  while (pages < maxPages) {
    const url = new URL(API + 'users.list');
    url.searchParams.set('limit', String(limit));
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    scopes = parseScopes(res.headers.get('x-oauth-scopes'));
    const body = await res.json();
    if (body.ok !== true) return { members, scopes, last: body };
    members.push(...(body.members ?? []));
    cursor = (body.response_metadata?.next_cursor ?? '').trim();
    pages += 1;
    if (!cursor) break;
  }
  return { members, scopes, last: { ok: true } };
}

async function main() {
  const token = (process.env.SLACK_BOT_TOKEN || "dummy-slack-bot-token");
  if (!token) {
    console.error('set SLACK_BOT_TOKEN (users:read is enough to run the census)');
    process.exitCode = 2;
    return;
  }

  const args = process.argv.slice(2);
  const li = args.indexOf('--limit');
  const pi = args.indexOf('--max-pages');
  const limit = li === -1 ? 200 : Number(args[li + 1]);
  const maxPages = pi === -1 ? 20 : Number(args[pi + 1]);

  const { members, scopes, last } = await pageUsers(token, limit, maxPages);
  if (last.ok !== true) {
    console.error(`users.list answered 200 with ok: false, error=${last.error}`);
    process.exitCode = 2;
    return;
  }

  const [state, detail] = verdict(members, scopes);
  if (state === 'complete' || state === 'no-humans') {
    console.log(`${state.padEnd(26)} ${detail}`);
  } else {
    console.warn(`${state.padEnd(26)} ${detail}`);
  }

  if (state === 'scope-missing') {
    console.warn(`  granted: ${[...scopes].sort().join(', ') || '<no header on the response>'}`);
    console.warn(`  repair: add ${EMAIL_SCOPE} to Bot Token Scopes, reinstall the app, ` +
                 'and replace the deployed token');
    console.warn('  the token in production keeps the grant it was minted with; ' +
                 'editing the app config alone changes nothing');
  } else if (state === 'scope-granted-none-visible') {
    console.warn('  repair: ask a workspace admin whether email visibility is ' +
                 'restricted; the scope is already there');
  } else if (state === 'partial') {
    console.warn('  repair: none at the scope level. Handle a missing email per ' +
                 'member rather than failing the run');
  }

  console.log(`${members.length} member(s) read, verdict ${state}`);
  process.exitCode = ['scope-missing', 'scope-granted-none-visible'].includes(state) ? 1 : 0;
}

// Only run when invoked directly, so importing this module in the tests does not
// execute main() and fail the file on a missing token.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
