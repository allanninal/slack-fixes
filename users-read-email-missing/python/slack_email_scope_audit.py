"""Decide whether Slack profiles have no email, or the token may not see it.

Read only. GET requests and nothing else: users:read is enough to run this, and
whether users:read.email is present is the thing being measured. The repair is a
scope change and a reinstall, and is printed rather than performed.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slack_email_scope_audit")

API = "https://slack.com/api/"
EMAIL_SCOPE = "users:read.email"


def parse_scopes(header):
    """Turn an X-OAuth-Scopes header into a set. Pure.

    Slack sends a comma separated list, occasionally with spaces after the
    commas and occasionally absent altogether on a cached or proxied response.
    """
    if not header:
        return set()
    return {s.strip() for s in header.split(",") if s.strip()}


def verdict(members, scopes):
    """Census the members and decide what the missing emails mean. Pure.

    `members` is the users.list array, `scopes` the set from X-OAuth-Scopes.
    Bots and deactivated accounts are excluded from the denominator: they have
    no email to show, and counting them turns a clean finding into a ratio.
    """
    humans = [m for m in members
              if not m.get("deleted") and not m.get("is_bot")
              and m.get("id") != "USLACKBOT"]
    total = len(humans)
    if not total:
        return ("no-humans",
                "no active human members in the page(s) read, so there is nothing "
                "to census. Page further before concluding anything.")

    with_email = sum(1 for m in humans if (m.get("profile") or {}).get("email"))
    granted = EMAIL_SCOPE in scopes

    if with_email == 0 and not granted:
        return ("scope-missing",
                "0 of %d humans have an email and %s is not on this token. The "
                "field is withheld, not absent: nothing errored because nothing "
                "was refused." % (total, EMAIL_SCOPE))
    if with_email == 0:
        return ("scope-granted-none-visible",
                "0 of %d humans have an email even though %s is granted. That is "
                "admin policy or Grid restriction, not the scope, and no reinstall "
                "will change it." % (total, EMAIL_SCOPE))
    if with_email < total:
        return ("partial",
                "%d of %d humans have an email%s. Guests, unconfirmed accounts and "
                "admin-hidden addresses look exactly like this, so assert per "
                "member rather than per run."
                % (with_email, total,
                   "" if granted else "; note %s is absent, so something other "
                   "than this token supplied them" % EMAIL_SCOPE))
    return ("complete",
            "%d of %d humans have an email; %s is granted"
            % (with_email, total, EMAIL_SCOPE))


def page_users(session, limit, max_pages):
    """Walk users.list, keeping the scope header from the last response."""
    members, cursor, scopes, pages = [], "", set(), 0
    while pages < max_pages:
        params = {"limit": str(limit)}
        if cursor:
            params["cursor"] = cursor
        r = session.get(API + "users.list", params=params, timeout=60)
        scopes = parse_scopes(r.headers.get("X-OAuth-Scopes"))
        body = r.json()
        if body.get("ok") is not True:
            return members, scopes, body
        members.extend(body.get("members") or [])
        cursor = ((body.get("response_metadata") or {}).get("next_cursor") or "").strip()
        pages += 1
        if not cursor:
            break
    return members, scopes, {"ok": True}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=200, help="page size (default 200)")
    ap.add_argument("--max-pages", type=int, default=20,
                    help="stop after this many pages (default 20)")
    args = ap.parse_args()

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        log.error("set SLACK_BOT_TOKEN (users:read is enough to run the census)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + token})

    members, scopes, last = page_users(s, args.limit, args.max_pages)
    if last.get("ok") is not True:
        log.error("users.list answered 200 with ok: false, error=%s", last.get("error"))
        return 2

    state, detail = verdict(members, scopes)
    if state in ("complete", "no-humans"):
        log.info("%-26s %s", state, detail)
    else:
        log.warning("%-26s %s", state, detail)

    if state == "scope-missing":
        log.warning("  granted: %s", ", ".join(sorted(scopes)) or "<no header on the response>")
        log.warning("  repair: add %s to Bot Token Scopes, reinstall the app, and "
                    "replace the deployed token", EMAIL_SCOPE)
        log.warning("  the token in production keeps the grant it was minted with; "
                    "editing the app config alone changes nothing")
    elif state == "scope-granted-none-visible":
        log.warning("  repair: ask a workspace admin whether email visibility is "
                    "restricted; the scope is already there")
    elif state == "partial":
        log.warning("  repair: none at the scope level. Handle a missing email "
                    "per member rather than failing the run")

    log.info("%d member(s) read, verdict %s", len(members), state)
    return 1 if state in ("scope-missing", "scope-granted-none-visible") else 0


if __name__ == "__main__":
    sys.exit(main())
