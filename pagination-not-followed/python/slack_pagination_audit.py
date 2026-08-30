"""Report Slack list calls whose first page is not the whole answer.

Read only. GET requests and nothing else: give this a bot token with read
scopes. The repair is printed, never performed, because this token can post into
your workspace.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slack_pagination_audit")

API = "https://slack.com/api/"

# (method, params, key holding the items). Every one of these is cursor
# paginated and every one of them defaults to 100 items per page.
PAGED = [
    ("conversations.list", {"types": "public_channel,private_channel"}, "channels"),
    ("users.list", {}, "members"),
    ("users.conversations", {"types": "public_channel,private_channel"}, "channels"),
]


def cursor_of(body):
    """The continuation token, or "" when this page is the last one. Pure.

    Absent response_metadata, a null cursor and an empty string all mean the
    same thing, and only one of the three is obvious.
    """
    meta = body.get("response_metadata") or {}
    return (meta.get("next_cursor") or "").strip()


def verdict(count, limit, cursor, total=None):
    """Classify one first page. Pure, so it runs offline.

    `count` is the length of the first page, `limit` the page size the
    application asked for, `cursor` the value cursor_of() returned, and `total`
    the size of the full walk when one was performed.
    """
    delta = ""
    if total is not None:
        delta = (" Full walk: %d item(s), so a first-page-only read misses %d."
                 % (total, max(total - count, 0)))
    if cursor:
        if count >= limit:
            return ("truncated",
                    "a full page of %d with a cursor set. The application is "
                    "seeing %d of a larger number it never asked for.%s"
                    % (count, count, delta))
        return ("more-pages",
                "only %d item(s) but the cursor is set, so more pages follow. A "
                "short page is not the last page.%s" % (count, delta))
    if count >= limit:
        return ("complete-at-limit",
                "exactly %d item(s) and no cursor: complete today. Code that "
                "stops on a short page is right here by luck, and wrong on the "
                "next item added.%s" % (count, delta))
    return ("complete", "%d item(s), no cursor: this is the whole set.%s"
                        % (count, delta))


def get(session, method, params):
    r = session.get(API + method, params=params, timeout=30)
    return r.json()


def walk(session, method, params, key, max_pages, max_items):
    """Follow every cursor to the end, bounded twice."""
    total, cursor, pages = 0, "", 0
    while True:
        page = dict(params, limit="200")
        if cursor:
            page["cursor"] = cursor
        body = get(session, method, page)
        if body.get("ok") is not True:
            log.warning("  walk stopped: ok: false, error=%s", body.get("error"))
            return total
        total += len(body.get(key) or [])
        pages += 1
        cursor = cursor_of(body)
        if not cursor or pages >= max_pages or total >= max_items:
            return total


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=100,
                    help="the page size your application asks for (default 100)")
    ap.add_argument("--full", action="store_true",
                    help="follow every cursor and report how much is being missed")
    ap.add_argument("--max-pages", type=int, default=50, help="cap on the full walk")
    ap.add_argument("--max-items", type=int, default=10000, help="cap on the full walk")
    args = ap.parse_args()

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        log.error("set SLACK_BOT_TOKEN (a bot token with read scopes is enough)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + token})

    bad = 0
    for method, params, key in PAGED:
        body = get(s, method, dict(params, limit=str(args.limit)))
        if body.get("ok") is not True:
            log.warning("%-18s %-22s ok: false, error=%s", "unreadable", method,
                        body.get("error"))
            bad += 1
            continue
        count = len(body.get(key) or [])
        cursor = cursor_of(body)
        total = walk(s, method, params, key, args.max_pages, args.max_items) \
            if (args.full and cursor) else None
        state, detail = verdict(count, args.limit, cursor, total)
        line = "%-18s %-22s %s" % (state, method, detail)
        if state.startswith("complete"):
            log.info(line)
            continue
        bad += 1
        log.warning(line)
        log.warning("  repair: loop on response_metadata.next_cursor until it is "
                    "empty, or use the SDK paginator")

    log.info("%d list method(s) probed, %d truncated by a first-page-only read",
             len(PAGED), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
