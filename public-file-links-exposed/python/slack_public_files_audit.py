"""Report Slack files that are readable without a Slack login.

Read only. One paginated GET and no writes: a bot token with files:read is
enough, and the revocation that repairs this needs files:write, which this
script deliberately does not use. The repair is printed for a human to run.
"""
import argparse
import datetime as dt
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slack_public_files_audit")

API = "https://slack.com/api"


def verdict(f):
    """Classify one file by which visibility flag is set. Pure, so the rule can
    be tested without a network.

    The distinction this function exists to protect: `is_public` means the file
    is shared into a public channel and a Slack login is still required, while
    `public_url_shared` means a permalink_public exists that serves the bytes to
    anyone on the internet. Only the second is a data exposure. Conflating them
    reports every screenshot ever posted in #general and buries the finding.

    Returns (state, detail).
    """
    if f.get("is_external"):
        return ("external",
                "hosted outside Slack, so Slack's flags do not govern who can "
                "read it. Check the origin instead.")

    public_link = bool(f.get("public_url_shared"))
    shared = bool(f.get("channels") or f.get("groups") or f.get("ims"))

    if public_link and not shared:
        return ("exposed-orphan",
                "public URL live and the file is in no channel, group or DM. "
                "Nobody inside Slack can see it to report it, and the link "
                "still serves.")

    if public_link:
        return ("exposed",
                "public URL live. Readable by anyone holding the link: no "
                "login, no expiry, no access log.")

    if f.get("is_public"):
        return ("workspace-visible",
                "shared into a public channel. Visible to members, still gated "
                "behind a Slack login. Not an exposure.")

    return ("private", "no public URL, not in a public channel")


def human_size(n):
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return "%.0f%s" % (n, unit)
        n /= 1024


def call(session, method, **params):
    """One Web API read. Slack answers almost every failure with HTTP 200 and
    puts the error in the body, so the body is what gets asserted on."""
    r = session.get("%s/%s" % (API, method), params=params, timeout=30)
    r.raise_for_status()
    body = r.json()
    if not body.get("ok"):
        raise SystemExit("%s: %s (needed=%s provided=%s)"
                         % (method, body.get("error"), body.get("needed"),
                            body.get("provided")))
    return body


def list_files(session, limit):
    """Page files.list. This resource uses page numbers rather than cursors, and
    a first-page-only read is how this check reports zero findings on a
    workspace with hundreds: the exposures are usually old."""
    out, page = [], 1
    while len(out) < limit:
        body = call(session, "files.list", count=200, page=page, types="all")
        out.extend(body.get("files", []))
        pages = int((body.get("paging") or {}).get("pages") or 1)
        if page >= pages:
            break
        page += 1
    return out[:limit]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-files", type=int, default=5000,
                    help="stop paging after this many files")
    ap.add_argument("--show-workspace-visible", action="store_true",
                    help="also list files that are in public channels but still "
                         "require a Slack login")
    args = ap.parse_args()

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        log.error("set SLACK_BOT_TOKEN (a bot token with files:read is enough)")
        return 2

    session = requests.Session()
    session.headers.update({"Authorization": "Bearer " + token})

    me = call(session, "auth.test")
    log.info("authenticated as %s in %s", me.get("user"), me.get("team"))

    files = list_files(session, args.max_files)
    if not files:
        log.info("no files visible to this token")
        return 0

    exposed = orphaned = 0
    # Newest and largest first: a recent export is a more urgent conversation
    # than a four-year-old screenshot.
    for f in sorted(files, key=lambda x: (int(x.get("created") or 0),
                                          int(x.get("size") or 0)), reverse=True):
        state, detail = verdict(f)
        if state == "private":
            continue
        if state == "workspace-visible" and not args.show_workspace_visible:
            continue

        created = dt.datetime.utcfromtimestamp(int(f.get("created") or 0)).date()
        line = "%-17s %s  %s  %s  %s" % (state, f.get("id"), created,
                                         human_size(f.get("size")),
                                         (f.get("name") or "")[:48])
        if state in ("exposed", "exposed-orphan"):
            exposed += 1
            orphaned += 1 if state == "exposed-orphan" else 0
            log.warning(line)
            log.warning("  %s", detail)
            log.warning("  public link: %s", f.get("permalink_public"))
            log.warning("  repair: files.revokePublicURL?file=%s (needs "
                        "files:write, which this script does not hold)",
                        f.get("id"))
        else:
            log.info("%s  %s", line, detail)

    log.info("%d file(s), %d exposed, %d exposed and unreachable in Slack",
             len(files), exposed, orphaned)
    if exposed:
        log.warning("stop minting public URLs for Block Kit images: host them "
                    "yourself, or reference the uploaded file so channel "
                    "permissions apply. An admin can disable public file "
                    "sharing workspace-wide.")
    return 1 if exposed else 0


if __name__ == "__main__":
    sys.exit(main())
