/**
 * Find Slack calls that returned HTTP 200 and failed anyway.
 *
 * Read only. GET requests and nothing else: give this a bot token with read
 * scopes. The repair is printed, never performed.
 */
const API = 'https://slack.com/api/';

// Read methods that are safe to probe and cheap to answer. Every one of them
// returns 200 whether it worked or not, which is the entire point.
const PROBES = [
  ['auth.test', {}],
  ['team.info', {}],
  ['conversations.list', { limit: '1', types: 'public_channel' }],
  ['users.list', { limit: '1' }],
  ['emoji.list', {}],
];

/**
 * Classify one Slack response. Pure, so the rule is testable offline.
 * A 200 proves the request reached Slack and nothing more.
 */
export function verdict(status, body) {
  if (status !== 200) {
    return ['transport',
      `HTTP ${status}. Slack keeps non-2xx for transport level failures, so this ` +
      'one means what it says: a proxy, a bad host, or a real 429.'];
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return ['unreadable',
      '200 with a body that is not JSON. Every Web API method answers JSON, so ' +
      'something other than Slack replied.'];
  }
  if (body.ok !== true) {
    return ['ok-false',
      `200 OK carrying error=${body.error ?? '<no error field>'}. The status line ` +
      'said success and the body did not.'];
  }
  const warnings = [...(body.response_metadata?.warnings ?? [])];
  if (body.warning) warnings.unshift(body.warning);
  if (warnings.length) {
    return ['warned',
      `ok is true, with warning=${warnings.join(',')}. Not fatal, and invisible ` +
      'to code that reads only ok.'];
  }
  return ['ok', 'ok: true, no warnings'];
}

async function probe(token, method, params) {
  const url = new URL(API + method);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function main() {
  const token = (process.env.SLACK_BOT_TOKEN || "dummy-slack-bot-token");
  if (!token) {
    console.error('set SLACK_BOT_TOKEN (a bot token with read scopes is enough)');
    process.exitCode = 2;
    return;
  }

  const args = process.argv.slice(2);
  const only = args.filter((a) => !a.startsWith('-')).map((m) => [m, {}]);
  const probes = only.length ? only : PROBES;

  let bad = 0;
  for (const [method, params] of probes) {
    const { status, body } = await probe(token, method, params);
    const [state, detail] = verdict(status, body);
    const line = `${state.padEnd(10)} ${method.padEnd(20)} ${detail}`;
    if (state === 'ok') { console.log(line); continue; }
    if (state === 'warned') { console.warn(line); continue; }
    bad += 1;
    console.warn(line);
    if (body?.needed) console.warn(`  needed=${body.needed} provided=${body.provided}`);
    console.warn('  repair: raise when body.ok is not true, at the transport layer, ' +
                 'for every Slack call');
  }

  console.log(`${probes.length} method(s) probed, ${bad} answered 200 without ok: true`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing token, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
