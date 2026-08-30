"""Find Slack calls that returned HTTP 200 and failed anyway.

Read only. GET requests and nothing else: give this a bot token with read scopes.
The repair is printed, never performed, because a Slack bot token can post into
your workspace.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slack_ok_false_audit")

API = "https://slack.com/api/"

# Read methods that are safe to probe and cheap to answer. Every one of them
# returns 200 whether it worked or not, which is the entire point.
PROBES = [
    ("auth.test", {}),
    ("team.info", {}),
    ("conversations.list", {"limit": "1", "types": "public_channel"}),
    ("users.list", {"limit": "1"}),
    ("emoji.list", {}),
]


def verdict(status, body):
    """Classify one Slack response. Pure, so the rule is testable offline.

    `status` is the HTTP status code, `body` the parsed JSON (or the raw text if
    it did not parse). A 200 proves the request reached Slack and nothing more.
    """
    if status != 200:
        return ("transport",
                "HTTP %s. Slack keeps non-2xx for transport level failures, so "
                "this one means what it says: a proxy, a bad host, or a real 429."
                % status)
    if not isinstance(body, dict):
        return ("unreadable",
                "200 with a body that is not JSON. Every Web API method answers "
                "JSON, so something other than Slack replied.")
    if body.get("ok") is not True:
        return ("ok-false",
                "200 OK carrying error=%s. The status line said success and the "
                "body did not." % (body.get("error") or "<no error field>"))
    warnings = [w for w in (body.get("response_metadata") or {}).get("warnings", []) or []]
    if body.get("warning"):
        warnings.insert(0, body["warning"])
    if warnings:
        return ("warned",
                "ok is true, with warning=%s. Not fatal, and invisible to code "
                "that reads only ok." % ",".join(warnings))
    return ("ok", "ok: true, no warnings")


def probe(session, method, params):
    r = session.get(API + method, params=params, timeout=30)
    try:
        body = r.json()
    except ValueError:
        body = r.text
    return r.status_code, body


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--method", action="append", default=[],
                    help="probe this read method instead of the default set; repeatable")
    args = ap.parse_args()

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        log.error("set SLACK_BOT_TOKEN (a bot token with read scopes is enough)")
        return 2

    probes = [(m, {}) for m in args.method] or PROBES
    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + token})

    bad = 0
    for method, params in probes:
        status, body = probe(s, method, params)
        state, detail = verdict(status, body)
        line = "%-10s %-20s %s" % (state, method, detail)
        if state == "ok":
            log.info(line)
            continue
        if state == "warned":
            log.warning(line)
            continue
        bad += 1
        log.warning(line)
        if isinstance(body, dict) and body.get("needed"):
            log.warning("  needed=%s provided=%s", body["needed"], body.get("provided"))
        log.warning("  repair: raise when body.ok is not true, at the transport "
                    "layer, for every Slack call")

    log.info("%d method(s) probed, %d answered 200 without ok: true", len(probes), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
