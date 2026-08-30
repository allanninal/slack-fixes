/**
 * Confirm whether files.upload is dead for this app, and whether it was noticed.
 *
 * Read only. The probe calls files.upload with no arguments, which cannot create
 * anything: it exists to be refused, and the refusal is the finding. The
 * migration is printed, never performed.
 */
const API = 'https://slack.com/api/';

// 12 November 2025, 00:00 UTC: the day files.upload was sunset for all apps.
// The date was announced for 11 March 2025 and moved once.
export const SUNSET = 1762905600;

const DEAD = new Set(['method_deprecated', 'deprecated_endpoint']);
// Errors that mean the method answered rather than refused to exist.
const ALIVE = new Set([
  'no_file_data', 'no_file_or_content', 'invalid_arguments',
  'posting_to_general_channel_denied',
]);

/**
 * Classify the argument-free files.upload probe. Pure, so it runs offline.
 * Its job is to separate "this method no longer exists" from "this method
 * exists and you called it wrong", both of which arrive as HTTP 200.
 */
export function verdict(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return ['unreadable',
      'the probe got a body that is not JSON, so something other than Slack ' +
      'answered. Nothing can be concluded about the method.'];
  }
  const error = body.error;
  if (body.ok === true) {
    return ['unexpected',
      'ok: true from a call with no file. Read the response by hand before ' +
      'trusting anything else here.'];
  }
  if (DEAD.has(error)) {
    return ['retired',
      `files.upload answered ${error}. The method was sunset for all apps on ` +
      '2025-11-12 and will not come back.'];
  }
  if (error === 'missing_scope') {
    return ['unknown',
      `missing_scope: needed=${body.needed ?? '?'}. The probe never reached the ` +
      'method, so this says nothing about whether it is alive. Migrate anyway.'];
  }
  if (['invalid_auth', 'not_authed', 'token_revoked', 'account_inactive'].includes(error)) {
    return ['auth',
      `error=${error}. That is the token, not the method. Fix the credential and ` +
      're-run before concluding anything.'];
  }
  if (ALIVE.has(error)) {
    return ['still-answering',
      `error=${error}, which means the method parsed the call rather than ` +
      'refusing to exist. Unexpected after the sunset, and still not a reason ' +
      'to stay on it.'];
  }
  return ['other',
    `error=${error ?? '<no error field>'}. Not a deprecation answer; read it ` +
    'before acting.'];
}

/**
 * Classify this app's own upload history against the cutover. Pure.
 * `files` is the files.list array restricted to files this bot uploaded.
 */
export function uploadActivity(files, now = null, sunset = SUNSET) {
  const stamps = files.map((f) => Number(f.created ?? 0)).sort((a, b) => a - b);
  if (!stamps.length) {
    return ['no-uploads',
      'this app has uploaded no files the token can see, so there is no history ' +
      'to date the breakage from.'];
  }
  const newest = stamps[stamps.length - 1];
  const after = stamps.filter((s) => s >= sunset);
  if (after.length) {
    return ['uploading',
      `${after.length} file(s) uploaded after the 2025-11-12 cutover, so some ` +
      'caller already speaks the replacement flow.'];
  }
  const days = Math.floor((((now ?? Date.now() / 1000)) - newest) / 86400);
  return ['silent-since-sunset',
    `newest upload is ${days} day(s) old and predates the cutover. Every caller ` +
    'has been failing since, quietly, at HTTP 200.'];
}

async function get(token, method, params = {}) {
  const url = new URL(API + method);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const token = (process.env.SLACK_BOT_TOKEN || "dummy-slack-bot-token");
  if (!token) {
    console.error('set SLACK_BOT_TOKEN (files:read is enough for the corroboration)');
    process.exitCode = 2;
    return;
  }

  const args = process.argv.slice(2);
  const i = args.indexOf('--count');
  const count = i === -1 ? '100' : args[i + 1];

  const [state, detail] = verdict(await get(token, 'files.upload'));
  let bad = 0;
  if (state === 'retired') {
    bad += 1;
    console.warn(`${state.padEnd(19)} ${detail}`);
    console.warn('  repair: files.getUploadURLExternal(filename, length) -> upload the ' +
                 'raw bytes to upload_url -> files.completeUploadExternal(files, channel_id)');
    console.warn('  or use the SDK helper: client.filesUploadV2({...}) / ' +
                 'client.files_upload_v2(...)');
  } else {
    console.warn(`${state.padEnd(19)} ${detail}`);
  }

  const me = await get(token, 'auth.test');
  if (me?.ok === true) {
    const listing = await get(token, 'files.list', { user: me.user_id, count });
    if (listing?.ok === true) {
      const [hstate, hdetail] = uploadActivity(listing.files ?? []);
      if (hstate === 'silent-since-sunset') {
        bad += 1;
        console.warn(`${hstate.padEnd(19)} ${hdetail}`);
      } else {
        console.log(`${hstate.padEnd(19)} ${hdetail}`);
      }
    } else {
      console.log(`${'no-history'.padEnd(19)} files.list did not answer ok: true ` +
                  `(${listing?.error ?? '?'}); the probe above stands on its own`);
    }
  } else {
    console.log(`${'no-history'.padEnd(19)} auth.test did not answer ok: true, so ` +
                'the history check was skipped');
  }

  console.log(`1 method probed, ${bad} finding(s)`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly, so importing this module in the tests does not
// execute main() and fail the file on a missing token.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
