/**
 * Report Slack list calls whose first page is not the whole answer.
 *
 * Read only. GET requests and nothing else: give this a bot token with read
 * scopes. The repair is printed, never performed.
 */
const API = 'https://slack.com/api/';

// [method, params, key holding the items]. Every one of these is cursor
// paginated and every one of them defaults to 100 items per page.
const PAGED = [
  ['conversations.list', { types: 'public_channel,private_channel' }, 'channels'],
  ['users.list', {}, 'members'],
  ['users.conversations', { types: 'public_channel,private_channel' }, 'channels'],
];

/**
 * The continuation token, or '' when this page is the last one. Pure.
 * Absent response_metadata, a null cursor and an empty string all mean the same
 * thing, and only one of the three is obvious.
 */
export function cursorOf(body) {
  return (body.response_metadata?.next_cursor ?? '').trim();
}

/**
 * Classify one first page. Pure, so it runs offline.
 */
export function verdict(count, limit, cursor, total = null) {
  const delta = total === null ? ''
    : ` Full walk: ${total} item(s), so a first-page-only read misses ` +
      `${Math.max(total - count, 0)}.`;
  if (cursor) {
    if (count >= limit) {
      return ['truncated',
        `a full page of ${count} with a cursor set. The application is seeing ` +
        `${count} of a larger number it never asked for.${delta}`];
    }
    return ['more-pages',
      `only ${count} item(s) but the cursor is set, so more pages follow. A short ` +
      `page is not the last page.${delta}`];
  }
  if (count >= limit) {
    return ['complete-at-limit',
      `exactly ${count} item(s) and no cursor: complete today. Code that stops on ` +
      `a short page is right here by luck, and wrong on the next item added.${delta}`];
  }
  return ['complete', `${count} item(s), no cursor: this is the whole set.${delta}`];
}

async function get(token, method, params) {
  const url = new URL(API + method);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

async function walk(token, method, params, key, maxPages, maxItems) {
  let total = 0; let cursor = ''; let pages = 0;
  for (;;) {
    const page = { ...params, limit: '200' };
    if (cursor) page.cursor = cursor;
    const body = await get(token, method, page);
    if (body.ok !== true) {
      console.warn(`  walk stopped: ok: false, error=${body.error}`);
      return total;
    }
    total += (body[key] ?? []).length;
    pages += 1;
    cursor = cursorOf(body);
    if (!cursor || pages >= maxPages || total >= maxItems) return total;
  }
}

async function main() {
  const token = (process.env.SLACK_BOT_TOKEN || "dummy-slack-bot-token");
  if (!token) {
    console.error('set SLACK_BOT_TOKEN (a bot token with read scopes is enough)');
    process.exitCode = 2;
    return;
  }
  const argv = process.argv.slice(2);
  const limit = Number(argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 100);
  const full = argv.includes('--full');
  const maxPages = 50;
  const maxItems = 10000;

  let bad = 0;
  for (const [method, params, key] of PAGED) {
    const body = await get(token, method, { ...params, limit: String(limit) });
    if (body.ok !== true) {
      console.warn(`unreadable         ${method.padEnd(22)} ok: false, error=${body.error}`);
      bad += 1;
      continue;
    }
    const count = (body[key] ?? []).length;
    const cursor = cursorOf(body);
    const total = (full && cursor)
      ? await walk(token, method, params, key, maxPages, maxItems) : null;
    const [state, detail] = verdict(count, limit, cursor, total);
    const line = `${state.padEnd(18)} ${method.padEnd(22)} ${detail}`;
    if (state.startsWith('complete')) { console.log(line); continue; }
    bad += 1;
    console.warn(line);
    console.warn('  repair: loop on response_metadata.next_cursor until it is empty, ' +
                 'or use the SDK paginator');
  }

  console.log(`${PAGED.length} list method(s) probed, ${bad} truncated by a ` +
              'first-page-only read');
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly, so importing this module from the test file
// does not execute main() and fail the suite on a missing token.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
