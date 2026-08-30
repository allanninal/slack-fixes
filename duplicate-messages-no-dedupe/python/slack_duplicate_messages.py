"""Find app-authored Slack messages that were posted more than once.

Read only. Three GET methods and no writes: a bot token with channels:read and
channels:history is enough, and is what you should give it. The repair is
printed, never performed, because this token can post into your workspace.
"""
import argparse
import hashlib
import json
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slack_duplicate_messages")

API = "https://slack.com/api"

# Slack redelivers an event that was not acknowledged in three seconds, once at
# roughly a minute and again at roughly five. Those two numbers are the
# fingerprint of a handler that is not idempotent on event_id.
RETRY_GAPS = (60.0, 300.0)

# Two runs of the same cron job land far enough apart that nothing else explains
# them. Half an hour is deliberately conservative.
RERUN_GAP = 1800.0


def fingerprint(message):
    """Content hash for one message. Pure, so grouping is testable offline.

    Text alone is not enough. A Block Kit message usually carries a short
    fallback in `text` that is identical across every alert the app sends, so
    hashing that field on its own merges unrelated messages into one enormous
    false duplicate group. The serialized blocks go into the hash too. `ts` is
    deliberately excluded: it is the one field guaranteed to differ between two
    copies of the same message.
    """
    payload = json.dumps([message.get("text") or "", message.get("blocks") or []],
                         sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def near(gap, target, tolerance):
    """True when `gap` is within `tolerance` (a fraction) of `target`."""
    return abs(gap - target) <= target * tolerance


def classify(timestamps, *, tolerance=0.25):
    """Name the cause of one duplicate group from the spacing of its copies.

    Pure, so the thresholds are visible and testable rather than buried in a
    request loop. `timestamps` are Slack `ts` values, as strings or floats.

    Returns (state, detail). The states are the causes, because the repairs are
    different for each: a retry needs an event_id check, a double delivery needs
    a subscription removed, an overlapping cron needs a lock. A group whose
    spacing matches none of them is reported as unclassified rather than pushed
    into the nearest bucket.
    """
    ts = sorted(float(t) for t in timestamps)
    n = len(ts)
    if n < 2:
        return ("unique", "one message, nothing to explain")

    gaps = [b - a for a, b in zip(ts, ts[1:])]
    span = ts[-1] - ts[0]

    if max(gaps) < 1.0:
        return ("double-delivery",
                "%d copies inside %.2fs. Sub-second spacing is two delivery "
                "paths handling one event, not a retry: app_mention and "
                "message.channels both subscribed, or Socket Mode running "
                "alongside a live Request URL." % (n, span))

    if all(any(near(g, r, tolerance) for r in RETRY_GAPS) for g in gaps):
        return ("retry-duplicate",
                "%d copies spaced %s. That is Slack's retry schedule: the "
                "handler did not acknowledge inside three seconds and did the "
                "work again on redelivery."
                % (n, ", ".join("%.0fs" % g for g in gaps)))

    if min(gaps) >= RERUN_GAP:
        return ("rerun",
                "%d copies over %.1f hour(s). Too far apart for a retry: two "
                "scheduler runs, a redeployed worker replaying a queue, or a "
                "backfill run twice." % (n, span / 3600.0))

    return ("duplicated",
            "%d copies over %.1fs, spacing matches no known cause. Worth reading "
            "by hand before you change anything." % (n, span))


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


def channels(session, explicit):
    if explicit:
        return [{"id": c, "name": c} for c in explicit]
    out, cursor = [], ""
    while True:
        body = call(session, "users.conversations", limit=200,
                    types="public_channel,private_channel", cursor=cursor)
        out.extend(body.get("channels", []))
        cursor = (body.get("response_metadata") or {}).get("next_cursor") or ""
        if not cursor:
            return out


def history(session, channel_id, limit):
    out, cursor = [], ""
    while len(out) < limit:
        body = call(session, "conversations.history", channel=channel_id,
                    limit=min(200, limit - len(out)), cursor=cursor)
        out.extend(body.get("messages", []))
        cursor = (body.get("response_metadata") or {}).get("next_cursor") or ""
        if not cursor:
            break
    return out[:limit]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--channel", action="append", default=[],
                    help="channel id to read; repeatable. Default: every channel "
                         "the bot is a member of")
    ap.add_argument("--limit", type=int, default=200,
                    help="messages to read per channel")
    ap.add_argument("--tolerance", type=float, default=0.25,
                    help="how far a gap may sit from 60s or 300s and still count "
                         "as a Slack retry")
    args = ap.parse_args()

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        log.error("set SLACK_BOT_TOKEN (a bot token with channels:read and "
                  "channels:history is enough)")
        return 2

    session = requests.Session()
    session.headers.update({"Authorization": "Bearer " + token})

    me = call(session, "auth.test")
    bot_id, user_id = me.get("bot_id"), me.get("user_id")
    log.info("authenticated as %s (bot_id=%s) in %s",
             me.get("user"), bot_id, me.get("team"))

    targets = channels(session, args.channel)
    if not targets:
        log.info("the bot is not a member of any conversation")
        return 0

    findings = authored = 0
    for ch in targets:
        messages = history(session, ch["id"], args.limit)
        mine = [m for m in messages
                if (bot_id and m.get("bot_id") == bot_id)
                or (user_id and m.get("user") == user_id)]
        authored += len(mine)

        groups = {}
        for m in mine:
            groups.setdefault(fingerprint(m), []).append(m)

        for key, group in sorted(groups.items()):
            state, detail = classify([m["ts"] for m in group],
                                     tolerance=args.tolerance)
            if state == "unique":
                continue
            findings += 1
            log.warning("%-16s #%s  %s", state, ch.get("name", ch["id"]), detail)
            log.warning("  first ts %s  fingerprint %s", group[0]["ts"], key)
            log.warning("  text: %.90s", (group[0].get("text") or "").replace("\n", " "))
            if state == "retry-duplicate":
                log.warning("  repair: acknowledge the event inside 3s and do the "
                            "work after; key on event.event_id in a short-TTL set "
                            "and return early on a repeat.")
            elif state == "double-delivery":
                log.warning("  repair: one delivery path per app. Drop either "
                            "app_mention or message.channels, and do not leave a "
                            "Request URL configured while Socket Mode is on.")
            elif state == "rerun":
                log.warning("  repair: take a per-job lock so overlapping runs "
                            "cannot both send, or post once and chat.update the "
                            "same ts as the state changes.")

    log.info("%d channel(s), %d app-authored message(s), %d duplicate group(s)",
             len(targets), authored, findings)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
