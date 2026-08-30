/**
 * Report Slack files that are readable without a Slack login.
 *
 * Read only. One paginated GET and no writes: a bot token with files:read is
 * enough, and the revocation that repairs this needs files:write, which this
 * script deliberately does not use. The repair is printed for a human to run.
 */
const API = 'https://slack.com/api';

/**
 * Classify one file by which visibility flag is set. Pure, so the rule can be
 * tested without a network.
 *
 * The distinction this function exists to protect: `is_public` means the file
 * is shared into a public channel and a Slack login is still required, while
 * `public_url_shared` means a permalink_public exists that serves the bytes to
 * anyone on the internet. Only the second is a data exposure.
 */
export function verdict(f) {
  if (f.is_external) {
    return ['external',
      "hosted outside Slack, so Slack's flags do not govern who can read it. " +
      'Check the origin instead.'];
  }

  const publicLink = Boolean(f.public_url_shared);
  const shared = Boolean((f.channels ?? []).length || (f.groups ?? []).length ||
                         (f.ims ?? []).length);

  if (publicLink && !shared) {
    return ['exposed-orphan',
      'public URL live and the file is in no channel, group or DM. Nobody ' +
      'inside Slack can see it to report it, and the link still serves.'];
  }

  if (publicLink) {
    return ['exposed',
      'public URL live. Readable by anyone holding the link: no login, no ' +
      'expiry, no access log.'];
  }

  if (f.is_public) {
    return ['workspace-visible',
      'shared into a public channel. Visible to members, still gated behind a ' +
      'Slack login. Not an exposure.'];
  }

  return ['private', 'no public URL, not in a public channel'];
}

export function humanSize(bytes) {
  let n = Number(bytes ?? 0);
  for (const unit of ['B', 'KB', 'MB', 'GB']) {
    if (n < 1024 || unit === 'GB') return `${n.toFixed(0)}${unit}`;
    n /= 1024;
  }
  return `${n}B`;
}

async function call(token, method, params = {}) {
  const url = new URL(`${API}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
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

async function listFiles(token, limit) {
  const out = [];
  let page = 1;
  while (out.length < limit) {
    const body = await call(token, 'files.list',
      { count: 200, page, types: 'all' });
    out.push(...(body.files ?? []));
    const pages = Number(body.paging?.pages ?? 1);
    if (page >= pages) break;
    page += 1;
  }
  return out.slice(0, limit);
}

async function main() {
  const token = (process.env.SLACK_BOT_TOKEN || "dummy-slack-bot-token");
  if (!token) {
    console.error('set SLACK_BOT_TOKEN (a bot token with files:read is enough)');
    process.exitCode = 2;
    return;
  }

  const me = await call(token, 'auth.test');
  console.log(`authenticated as ${me.user} in ${me.team}`);

  const files = await listFiles(token, 5000);
  if (files.length === 0) {
    console.log('no files visible to this token');
    return;
  }

  let exposed = 0;
  let orphaned = 0;
  const ordered = [...files].sort((a, b) =>
    Number(b.created ?? 0) - Number(a.created ?? 0));

  for (const f of ordered) {
    const [state, detail] = verdict(f);
    if (state !== 'exposed' && state !== 'exposed-orphan') continue;
    exposed += 1;
    if (state === 'exposed-orphan') orphaned += 1;
    const created = new Date(Number(f.created ?? 0) * 1000).toISOString().slice(0, 10);
    console.warn(`${state.padEnd(17)} ${f.id}  ${created}  ` +
                 `${humanSize(f.size)}  ${(f.name ?? '').slice(0, 48)}`);
    console.warn(`  ${detail}`);
    console.warn(`  public link: ${f.permalink_public}`);
    console.warn(`  repair: files.revokePublicURL?file=${f.id} (needs ` +
                 'files:write, which this script does not hold)');
  }

  console.log(`${files.length} file(s), ${exposed} exposed, ${orphaned} ` +
              'exposed and unreachable in Slack');
  if (exposed) {
    console.warn('stop minting public URLs for Block Kit images: host them ' +
                 'yourself, or reference the uploaded file so channel ' +
                 'permissions apply.');
  }
  process.exitCode = exposed ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and
// without the guard main() would run there too, fail on the missing token, and
// set a non-zero exit code that fails the whole test file even as every test
// passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
