/**
 * Audit a Slack installation store for keys that collide on Enterprise Grid.
 *
 * Read only. GET requests and nothing else, because this script is handed one
 * token per tenant and a mistake here is a cross-tenant one. The repair is a
 * store migration; it is printed for a human to run.
 */
import { readFile } from 'node:fs/promises';

const API = 'https://slack.com/api/';

/**
 * Compare one stored installation row against what its token says it is.
 * Pure, so the whole truth table runs offline.
 */
export function verdict(stored, identity) {
  if (identity?.ok !== true) {
    return ['unusable',
      `auth.test answered ok: false, error=${identity?.error ?? '<no error field>'}. ` +
      'The row cannot be checked, and a token that no longer authenticates is its ' +
      'own finding.'];
  }

  const liveTeam = identity.team_id;
  const liveEnt = identity.enterprise_id;
  const orgInstall = identity.is_enterprise_install === true;
  const key = String(stored.key ?? '');
  const storedEnt = stored.enterprise_id;
  const storedOrg = stored.is_enterprise_install === true;

  if (liveEnt && !storedEnt) {
    return ['enterprise-id-dropped',
      `live install is in org ${liveEnt} and the row kept no enterprise_id. Two ` +
      'workspaces in different orgs can now be filed under one key, and the ' +
      'second write wins.'];
  }
  if (liveEnt && storedEnt !== liveEnt) {
    return ['enterprise-id-wrong',
      `row says org ${storedEnt}, the token says ${liveEnt}. A lookup on this row ` +
      'hands out a credential belonging to another organisation.'];
  }
  if (orgInstall && !storedOrg) {
    return ['org-install-under-team-key',
      `is_enterprise_install is true but the row is filed as a workspace install ` +
      `under ${JSON.stringify(key)}. The grant covers every workspace in the org, ` +
      'including ones with no row at all.'];
  }
  if (storedOrg && !orgInstall) {
    return ['workspace-install-flagged-org',
      `the row claims an org-wide install and the token is scoped to workspace ` +
      `${liveTeam}. Lookups for sibling workspaces will match this row and use a ` +
      'token that cannot serve them.'];
  }
  if (liveTeam && key !== liveTeam && key !== `${liveEnt}.${liveTeam}`) {
    return ['key-drift',
      `row is filed under ${JSON.stringify(key)} and the token reports team ` +
      `${liveTeam}. The key does not round-trip, so whatever wrote it is not what ` +
      'reads it.'];
  }
  if (liveEnt) {
    return ['grid-keyed',
      `org ${liveEnt}, team ${liveTeam}, org-wide=${orgInstall}, all three persisted`];
  }
  return ['single-workspace',
    `team ${liveTeam}, not on Grid. team_id alone is adequate today and stops being ` +
    'adequate the day this customer migrates to an org.'];
}

/**
 * Find cross-row collisions. Pure. Returns [teamCollisions, keyCollisions]:
 * team ids filed under more than one organisation, and store keys that resolve
 * to more than one live identity.
 */
export function collisions(seen) {
  const byTeam = new Map();
  const byKey = new Map();
  for (const row of seen) {
    const team = row.team_id;
    if (team) {
      if (!byTeam.has(team)) byTeam.set(team, new Set());
      byTeam.get(team).add(row.enterprise_id ?? '');
    }
    const key = String(row.key ?? '');
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(`${row.enterprise_id ?? ''}|${team ?? ''}`);
  }
  const teamCollisions = [...byTeam.entries()]
    .filter(([, orgs]) => orgs.size > 1).map(([t]) => t).sort();
  const keyCollisions = [...byKey.entries()]
    .filter(([, ids]) => ids.size > 1).map(([k]) => k).sort();
  return [teamCollisions, keyCollisions];
}

async function authTest(token) {
  const res = await fetch(API + 'auth.test', {
    headers: { Authorization: `Bearer ${token}` },
  });
  try {
    return await res.json();
  } catch {
    return { ok: false, error: 'unparseable_body' };
  }
}

async function loadRows(path) {
  if (path) return JSON.parse(await readFile(path, 'utf8'));
  return [{ key: (process.env.SLACK_TEAM_ID || "dummy-slack-team-id") ?? '<the only row>', token_env: 'SLACK_BOT_TOKEN' }];
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--store');
  const store = i === -1 ? null : args[i + 1];

  if (!store && !(process.env.SLACK_BOT_TOKEN || "dummy-slack-bot-token")) {
    console.error('set SLACK_BOT_TOKEN, or pass --store with one token_env per row');
    process.exitCode = 2;
    return;
  }

  const rows = await loadRows(store);
  const seen = [];
  let bad = 0;

  for (const row of rows) {
    const token = process.env[row.token_env ?? 'SLACK_BOT_TOKEN'];
    if (!token) {
      console.warn(`${'no-token'.padEnd(28)} row ${JSON.stringify(row.key)} names ` +
                   `${row.token_env} and it is unset`);
      bad += 1;
      continue;
    }
    const identity = await authTest(token);
    const [state, detail] = verdict(row, identity);
    const line = `${state.padEnd(28)} ${String(row.key).padEnd(18)} ${detail}`;
    if (state === 'grid-keyed' || state === 'single-workspace') {
      console.log(line);
    } else {
      bad += 1;
      console.warn(line);
      console.warn('  repair: key this store on (enterprise_id, team_id, ' +
                   'is_enterprise_install), enterprise_id nullable');
    }
    if (identity?.ok === true) {
      seen.push({ key: row.key, team_id: identity.team_id, enterprise_id: identity.enterprise_id });
    }
  }

  const [teamCollisions, keyCollisions] = collisions(seen);
  for (const team of teamCollisions) {
    bad += 1;
    console.warn(`${'team-id-in-two-orgs'.padEnd(28)} team ${team} is filed under ` +
                 'more than one enterprise_id');
  }
  for (const key of keyCollisions) {
    bad += 1;
    console.warn(`${'key-serves-two-installs'.padEnd(28)} store key ` +
                 `${JSON.stringify(key)} resolves to more than one live identity`);
  }
  if (teamCollisions.length || keyCollisions.length) {
    console.warn('  repair: migrate before the next uninstall. A delete keyed on ' +
                 'team_id alone removes another tenant\'s row');
  }

  console.log(`${rows.length} install(s) checked, ${bad} keyed in a way that can collide`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly, so importing this module in the tests does not
// execute main() and fail the file on a missing token.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
