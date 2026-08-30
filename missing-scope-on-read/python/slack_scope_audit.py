"""Audit which Slack read methods this token's scopes actually allow.

Read only. GET requests and nothing else: give this the bot token you deploy, so
the answer is about the credential in production. The repair is printed, never
performed, because this token can post into your workspace.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slack_scope_audit")

API = "https://slack.com/api/"

# Cheap read probes. Each one is refused by a different scope, so the set doubles
# as a map of what the token can reach.
PROBES = [
    ("auth.test", {}),
    ("conversations.list", {"limit": "1", "types": "public_channel"}),
    ("users.list", {"limit": "1"}),
    ("emoji.list", {}),
    ("usergroups.list", {}),
    ("team.info", {}),
]

# Refusals that are about the credential rather than the grant. Adding a scope
# and reinstalling does nothing for any of these.
CREDENTIAL_ERRORS = {
    "invalid_auth", "not_authed", "token_revoked", "token_expired",
    "account_inactive", "not_allowed_token_type",
}


def parse_scopes(header):
    """Split an X-OAuth-Scopes header into a sorted tuple. Pure.

    Slack sends one comma-joined string, and the header is absent from some
    proxied responses, so treat missing as "unknown" rather than "none".
    """
    if not header:
        return ()
    return tuple(sorted({s.strip() for s in header.split(",") if s.strip()}))


def verdict(granted, body):
    """Classify one probed method against a granted scope list. Pure.

    `granted` is what X-OAuth-Scopes reported; `body` is the parsed response.
    """
    if body.get("ok") is True:
        return ("ok", "allowed by the %d scope(s) this token holds" % len(granted))

    error = body.get("error") or "<no error field>"
    if error in CREDENTIAL_ERRORS:
        return ("wrong-token",
                "error=%s. This is the credential, not the grant: adding a scope "
                "and reinstalling will not change it." % error)
    if error != "missing_scope":
        return ("other",
                "error=%s, which is not a permission problem. Fix it before "
                "concluding anything about scopes." % error)

    needed = [s.strip() for s in (body.get("needed") or "").split(",") if s.strip()]
    if not needed:
        return ("missing-scope",
                "missing_scope, and the response did not name one. Read the "
                "method reference for its scope list.")
    already = [s for s in needed if s in granted]
    if already:
        return ("scope-list-mismatch",
                "missing_scope while the granted list already contains %s. The "
                "list and the token are not the same token: read X-OAuth-Scopes "
                "off this very response." % ", ".join(already))
    return ("missing-scope",
            "add any one of: %s. needed is an OR list, so one suffices, and the "
            "app must be reinstalled before the token carries it."
            % ", ".join(needed))


def probe(session, method, params):
    r = session.get(API + method, params=params, timeout=30)
    return r.headers.get("X-OAuth-Scopes"), r.json()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--method", action="append", default=[],
                    help="probe this read method as well as the default set; repeatable")
    args = ap.parse_args()

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        log.error("set SLACK_BOT_TOKEN (use the token the app actually deploys with)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + token})

    probes = PROBES + [(m, {}) for m in args.method]
    blocked = 0
    for method, params in probes:
        header, body = probe(s, method, params)
        granted = parse_scopes(header)
        state, detail = verdict(granted, body)
        if method == probes[0][0]:
            log.info("granted: %d scope(s) on this token: %s",
                     len(granted), ", ".join(granted) or "<header absent>")
        line = "%-19s %-20s %s" % (state, method, detail)
        if state == "ok":
            log.info(line)
            continue
        blocked += 1
        log.warning(line)
        if state == "missing-scope":
            log.warning("  provided=%s", body.get("provided") or "?")
            log.warning("  repair: OAuth & Permissions -> Bot Token Scopes, add the "
                        "scope, reinstall the app, replace the stored token")

    log.info("%d method(s) probed, %d refused", len(probes), blocked)
    return 1 if blocked else 0


if __name__ == "__main__":
    sys.exit(main())
