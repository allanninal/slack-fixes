"""Detect Slack's non-Marketplace clamp on conversations.history.

Read only, and detect-only: there is no setting that lifts this clamp, so the
script reports what it found and prints the three real remedies. A bot token
with channels:read and channels:history is enough.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slack_history_clamp_probe")

API = "https://slack.com/api"

# The documented ceiling for a non-Marketplace app on conversations.history and
# conversations.replies since 29 May 2025: 15 objects, one request per minute.
CAP = 15


def verdict(probe, *, cap=CAP):
    """Name the state of one history probe. Pure, so the rule is testable
    offline.

    `probe` carries what the two calls observed:
        requested          the limit that was asked for
        returned           how many messages came back
        next_cursor        response_metadata.next_cursor, or ""
        second_call_error  body.error from an immediate repeat call, or ""

    Returns (state, detail). Two of the states exist to say the probe cannot
    tell: asking for 15 or fewer proves nothing, and a page of exactly 15 with
    no cursor is a channel that ran out of messages, not a clamp. Reporting
    either as clamped sends somebody to the Marketplace over a quiet channel.
    """
    requested = int(probe.get("requested") or 0)
    returned = int(probe.get("returned") or 0)
    cursor = str(probe.get("next_cursor") or "").strip()
    throttled = str(probe.get("second_call_error") or "").strip() == "ratelimited"

    if requested <= cap:
        return ("not-probed",
                "asked for %d, which is at or below the %d-object cap. Ask for "
                "more than %d or the answer means nothing."
                % (requested, cap, cap))

    if returned > cap:
        return ("unclamped",
                "asked for %d, got %d. Tier 3 limits intact."
                % (requested, returned))

    if returned == cap and cursor and throttled:
        return ("clamped-confirmed",
                "asked for %d, got exactly %d with more pages waiting, and the "
                "second call inside the minute was refused with ratelimited. "
                "That is the non-Marketplace clamp." % (requested, cap))

    if returned == cap and cursor:
        return ("clamped",
                "asked for %d, got exactly %d and a cursor, so Slack has more "
                "and is handing over %d. The second call was not refused; "
                "repeat the probe to confirm the 1-per-minute half."
                % (requested, cap, cap))

    if returned == cap:
        return ("inconclusive",
                "got exactly %d with no cursor. A clamped page and a channel "
                "with %d messages left look identical here. Probe a busier "
                "channel." % (cap, cap))

    if cursor:
        return ("short-page",
                "got %d of %d with a cursor still set. Fewer than the clamp "
                "would give, so this is not it: look at the channel, the "
                "oldest/latest window, or a shared quota."
                % (returned, requested))

    return ("small-channel",
            "got %d of %d and no cursor. The channel simply has that many "
            "messages; nothing is clamped." % (returned, requested))


def call(session, method, **params):
    """One Web API read. Returns (body, retry_after). Unlike the other scripts
    in this section, a ratelimited answer here is the finding rather than an
    error, so it is returned instead of raised. Slack sends it both as a real
    429 with a Retry-After header and as a 200 carrying ok false, so both are
    handled."""
    r = session.get("%s/%s" % (API, method), params=params, timeout=30)
    retry_after = r.headers.get("Retry-After")
    if r.status_code == 429:
        return ({"ok": False, "error": "ratelimited"}, retry_after)
    r.raise_for_status()
    body = r.json()
    if not body.get("ok") and body.get("error") != "ratelimited":
        raise SystemExit("%s: %s (needed=%s provided=%s)"
                         % (method, body.get("error"), body.get("needed"),
                            body.get("provided")))
    return (body, retry_after)


def pick_channel(session):
    body, _ = call(session, "users.conversations", limit=200,
                   types="public_channel")
    channels = body.get("channels") or []
    if not channels:
        return None
    # The busiest channel available is the one least likely to give an
    # inconclusive answer, and message count is the closest proxy on hand.
    channels.sort(key=lambda c: int(c.get("num_members") or 0), reverse=True)
    return channels[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--channel", help="channel id to probe. Default: the "
                                      "largest channel the bot is a member of")
    ap.add_argument("--limit", type=int, default=200,
                    help="page size to ask for; must exceed 15 to mean anything")
    args = ap.parse_args()

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        log.error("set SLACK_BOT_TOKEN (channels:read and channels:history)")
        return 2

    session = requests.Session()
    session.headers.update({"Authorization": "Bearer " + token})

    me, _ = call(session, "auth.test")
    log.info("authenticated as %s in %s", me.get("user"), me.get("team"))

    channel = args.channel
    if not channel:
        picked = pick_channel(session)
        if not picked:
            log.error("no channels available; pass --channel")
            return 2
        channel = picked["id"]
        log.info("probing #%s (%s)", picked.get("name"), channel)

    first, _ = call(session, "conversations.history", channel=channel,
                    limit=args.limit)
    if not first.get("ok"):
        log.error("first call was already ratelimited; wait a minute and retry")
        return 2

    second, retry_after = call(session, "conversations.history",
                               channel=channel, limit=args.limit)

    state, detail = verdict({
        "requested": args.limit,
        "returned": len(first.get("messages") or []),
        "next_cursor": (first.get("response_metadata") or {}).get("next_cursor"),
        "second_call_error": second.get("error"),
    })

    log.info("%-18s %s  %s", state, channel, detail)
    if retry_after:
        log.info("  Retry-After on the second call: %s", retry_after)

    control, _ = call(session, "conversations.list", limit=200,
                      exclude_archived="true")
    n = len(control.get("channels") or [])
    log.info("  control: conversations.list?limit=200 returned %d", n)
    if n <= CAP and state.startswith("clamped"):
        log.warning("  the control is short too, so this may be a wider "
                    "throttle rather than the history clamp alone")

    if state.startswith("clamped"):
        log.warning("  no setting lifts this. The three real remedies:")
        log.warning("   1. get the app approved for the Slack Marketplace, "
                    "which restores Tier 3")
        log.warning("   2. if it runs inside one organisation only, reclassify "
                    "it as an internal customer-built app, which is exempt")
        log.warning("   3. stop polling history: subscribe to message.channels "
                    "and message.groups, keep your own store, and let history "
                    "become a rare backfill")
        log.warning("  meanwhile drop any hardcoded limit=1000 to %d so "
                    "pagination stops assuming pages it will not get", CAP)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
