"""Audit a Slack installation store for keys that collide on Enterprise Grid.

Read only. GET requests and nothing else, because this script is handed one
token per tenant and a mistake here is a cross-tenant one. The repair is a store
migration; it is printed for a human to run.
"""
import argparse
import json
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slack_install_key_audit")

API = "https://slack.com/api/"


def verdict(stored, identity):
    """Compare one stored installation row against what its token says it is.

    `stored` is the row as your store holds it: a `key`, and whatever else was
    persisted (`enterprise_id`, `is_enterprise_install`). `identity` is the
    parsed auth.test body for that row's token. Pure, so the whole truth table
    runs offline.
    """
    if identity.get("ok") is not True:
        return ("unusable",
                "auth.test answered ok: false, error=%s. The row cannot be "
                "checked, and a token that no longer authenticates is its own "
                "finding." % (identity.get("error") or "<no error field>"))

    live_team = identity.get("team_id")
    live_ent = identity.get("enterprise_id")
    org_install = identity.get("is_enterprise_install") is True
    key = str(stored.get("key", ""))
    stored_ent = stored.get("enterprise_id")
    stored_org = stored.get("is_enterprise_install") is True

    if live_ent and not stored_ent:
        return ("enterprise-id-dropped",
                "live install is in org %s and the row kept no enterprise_id. "
                "Two workspaces in different orgs can now be filed under one "
                "key, and the second write wins." % live_ent)
    if live_ent and stored_ent != live_ent:
        return ("enterprise-id-wrong",
                "row says org %s, the token says %s. A lookup on this row hands "
                "out a credential belonging to another organisation."
                % (stored_ent, live_ent))
    if org_install and not stored_org:
        return ("org-install-under-team-key",
                "is_enterprise_install is true but the row is filed as a "
                "workspace install under %r. The grant covers every workspace "
                "in the org, including ones with no row at all." % key)
    if stored_org and not org_install:
        return ("workspace-install-flagged-org",
                "the row claims an org-wide install and the token is scoped to "
                "workspace %s. Lookups for sibling workspaces will match this "
                "row and use a token that cannot serve them." % live_team)
    if live_team and key not in (live_team, "%s.%s" % (live_ent, live_team)):
        return ("key-drift",
                "row is filed under %r and the token reports team %s. The key "
                "does not round-trip, so whatever wrote it is not what reads it."
                % (key, live_team))
    if live_ent:
        return ("grid-keyed",
                "org %s, team %s, org-wide=%s, all three persisted"
                % (live_ent, live_team, org_install))
    return ("single-workspace",
            "team %s, not on Grid. team_id alone is adequate today and stops "
            "being adequate the day this customer migrates to an org."
            % live_team)


def collisions(seen):
    """Find cross-row collisions. Pure.

    `seen` is a list of dicts with `key`, `team_id` and `enterprise_id`. Returns
    (team_collisions, key_collisions): team ids that appear under more than one
    organisation, and store keys that resolve to more than one live identity.
    Neither is visible from a single row, and both are leakage in progress.
    """
    by_team = {}
    by_key = {}
    for row in seen:
        team = row.get("team_id")
        if team:
            by_team.setdefault(team, set()).add(row.get("enterprise_id") or "")
        by_key.setdefault(str(row.get("key", "")), set()).add(
            (row.get("enterprise_id") or "", team or ""))
    team_collisions = sorted(t for t, orgs in by_team.items() if len(orgs) > 1)
    key_collisions = sorted(k for k, ids in by_key.items() if len(ids) > 1)
    return team_collisions, key_collisions


def auth_test(session, token):
    r = session.get(API + "auth.test", headers={"Authorization": "Bearer " + token},
                    timeout=30)
    try:
        return r.json()
    except ValueError:
        return {"ok": False, "error": "unparseable_body"}


def load_rows(path):
    """Rows as the store holds them, not as it wishes it held them."""
    if path:
        return json.loads(open(path, encoding="utf-8").read())
    return [{"key": os.environ.get("SLACK_TEAM_ID", "<the only row>"),
             "token_env": "SLACK_BOT_TOKEN"}]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--store", help="JSON array of installation rows; each row needs "
                                    "key and token_env, plus whatever else you persist")
    args = ap.parse_args()

    if not args.store and not os.environ.get("SLACK_BOT_TOKEN"):
        log.error("set SLACK_BOT_TOKEN, or pass --store with one token_env per row")
        return 2

    rows = load_rows(args.store)
    s = requests.Session()

    seen = []
    bad = 0
    for row in rows:
        token = os.environ.get(row.get("token_env") or "SLACK_BOT_TOKEN")
        if not token:
            log.warning("%-28s %s", "no-token", "row %r names %s and it is unset"
                        % (row.get("key"), row.get("token_env")))
            bad += 1
            continue
        identity = auth_test(s, token)
        state, detail = verdict(row, identity)
        line = "%-28s %-18s %s" % (state, row.get("key"), detail)
        if state in ("grid-keyed", "single-workspace"):
            log.info(line)
        else:
            bad += 1
            log.warning(line)
            log.warning("  repair: key this store on (enterprise_id, team_id, "
                        "is_enterprise_install), enterprise_id nullable")
        if identity.get("ok") is True:
            seen.append({"key": row.get("key"),
                         "team_id": identity.get("team_id"),
                         "enterprise_id": identity.get("enterprise_id")})

    team_collisions, key_collisions = collisions(seen)
    for team in team_collisions:
        bad += 1
        log.warning("%-28s %s", "team-id-in-two-orgs",
                    "team %s is filed under more than one enterprise_id" % team)
    for key in key_collisions:
        bad += 1
        log.warning("%-28s %s", "key-serves-two-installs",
                    "store key %r resolves to more than one live identity" % key)
    if team_collisions or key_collisions:
        log.warning("  repair: migrate before the next uninstall. A delete keyed on "
                    "team_id alone removes another tenant's row")

    log.info("%d install(s) checked, %d keyed in a way that can collide",
             len(rows), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
