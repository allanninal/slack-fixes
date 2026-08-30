/**
 * Audit which Slack read methods this token's scopes actually allow.
 *
 * Read only. GET requests and nothing else: give this the bot token you deploy,
 * so the answer is about the credential in production. The repair is printed,
 * never performed.
 */
const API = 'https://slack.com/api/';

// Cheap read probes. Each one is refused by a different scope, so the set
// doubles as a map of what the token can reach.
const PROBES = [
  ['auth.test', {}],
  ['conversations.list', { limit: '1', types: 'public_channel' }],
  ['users.list', { limit: '1' }],
  ['emoji.list', {}],
  ['usergroups.list', {}],
  ['team.info', {}],
];

// Refusals that are about the credential rather than the grant. Adding a scope
// and reinstalling does nothing for any of these.
const CREDENTIAL_ERRORS = new Set([
  'invalid_auth', 'not_authed', 'token_revoked', 'token_expired',
  'account_inactive', 'not_allowed_token_type',
]);

/**
 * Split an X-OAuth-Scopes header into a sorted array. Pure.
 * The header is absent from some proxied responses, so missing means unknown.
 */
export function parseScopes(header) {
  if (!header) return [];
  const set = new Set(header.split(',').map((s) => s.trim()).filter(Boolean));
  return [...set].sort();
}

/**
 * Classify one probed method against a granted scope list. Pure.
 */
export function verdict(granted, body) {
  if (body.ok === true) {
    return ['ok', `allowed by the ${granted.length} scope(s) this token holds`];
  }

  const error = body.error ?? '<no error field>';
  if (CREDENTIAL_ERRORS.has(error)) {
    return ['wrong-token',
      `error=${error}. This is the credential, not the grant: adding a scope and ` +
      'reinstalling will not change it.'];
  }
  if (error !== 'missing_scope') {
    return ['other',
      `error=${error}, which is not a permission problem. Fix it before ` +
      'concluding anything about scopes.'];
  }

  const needed = (body.needed ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (needed.length === 0) {
    return ['missing-scope',
      'missing_scope, and the response did not name one. Read the method ' +
      'reference for its scope list.'];
  }
  const already = needed.filter((s) => granted.includes(s));
  if (already.length) {
    return ['scope-list-mismatch',
      `missing_scope while the granted list already contains ${already.join(', ')}. ` +
      'The list and the token are not the same token: read X-OAuth-Scopes off ' +
      'this very response.'];
  }
  return ['missing-scope',
    `add any one of: ${needed.join(', ')}. needed is an OR list, so one suffices, ` +
    'and the app must be reinstalled before the token carries it.'];
}

async function probe(token, method, params) {
  const url = new URL(API + method);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return { header: res.headers.get('x-oauth-scopes'), body: await res.json() };
}

async function main() {
  const token = (process.env.SLACK_BOT_TOKEN || "dummy-slack-bot-token");
  if (!token) {
    console.error('set SLACK_BOT_TOKEN (use the token the app actually deploys with)');
    process.exitCode = 2;
    return;
  }

  const extra = process.argv.slice(2).filter((a) => !a.startsWith('-')).map((m) => [m, {}]);
  const probes = [...PROBES, ...extra];

  let blocked = 0;
  for (const [method, params] of probes) {
    const { header, body } = await probe(token, method, params);
    const granted = parseScopes(header);
    const [state, detail] = verdict(granted, body);
    if (method === probes[0][0]) {
      console.log(`granted: ${granted.length} scope(s) on this token: ` +
                  `${granted.join(', ') || '<header absent>'}`);
    }
    const line = `${state.padEnd(19)} ${method.padEnd(20)} ${detail}`;
    if (state === 'ok') { console.log(line); continue; }
    blocked += 1;
    console.warn(line);
    if (state === 'missing-scope') {
      console.warn(`  provided=${body.provided ?? '?'}`);
      console.warn('  repair: OAuth & Permissions -> Bot Token Scopes, add the scope, ' +
                   'reinstall the app, replace the stored token');
    }
  }

  console.log(`${probes.length} method(s) probed, ${blocked} refused`);
  process.exitCode = blocked ? 1 : 0;
}

// Only run when invoked directly, so importing this module from the test file
// does not execute main() and fail the suite on a missing token.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
