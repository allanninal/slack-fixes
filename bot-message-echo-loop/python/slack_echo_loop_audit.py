"""Find Slack channels where the app is replying to its own messages.

Read only. Three GET methods and no writes: a bot token with channels:read and
channels:history is enough. The repair is printed, never performed, because this
token can post into the same channels it is reading.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slack_echo_loop_audit")

API = "https://slack.com/api"


def is_self(message, identity):
    """True when this message was authored by the app we authenticated as.

    Pure, and deliberately narrow. Matching on "has a bot_id" would flag every
    other integration in the channel and report a busy alerts channel as a loop,
    so the comparison is against our own ids from auth.test. Both are checked
    because a modern app-authored message carries bot_id while a message posted
    with a user token carries only `user`.

    This is the same predicate the repair puts in the event handler.
    """
    bot_id = identity.get("bot_id")
    user_id = identity.get("user_id")
    if bot_id and message.get("bot_id") == bot_id:
        return True
    if user_id and message.get("user") == user_id:
        return True
    return False


def verdict(messages, identity, *, min_run=4, burst=2.0):
    """Classify one channel by its longest run of self-authored messages.

    Pure, so the thresholds are visible and testable rather than buried in a
    request loop. `messages` are history items in any order; they are sorted by
    ts here because a run is a property of posting order.

    Returns (state, detail). Length alone is not the signal: a digest job posting
    a dozen messages in a row is not a loop, so a long run whose internal gaps
    are wider than `burst` seconds gets its own state rather than being reported
    as one.
    """
    ordered = sorted(messages, key=lambda m: float(m.get("ts") or 0))

    best, best_gaps = [], []
    run, gaps = [], []
    for m in ordered:
        if is_self(m, identity):
            if run:
                gaps.append(float(m.get("ts") or 0) - float(run[-1].get("ts") or 0))
            run.append(m)
        else:
            if len(run) > len(best):
                best, best_gaps = run, gaps
            run, gaps = [], []
    if len(run) > len(best):
        best, best_gaps = run, gaps

    n = len(best)
    if n <= 1:
        return ("quiet",
                "longest self-authored run is %d. Every reply is answering "
                "somebody else." % n)

    widest = max(best_gaps) if best_gaps else 0.0

    if n < min_run:
        return ("short-run",
                "%d in a row, %.1fs apart at widest. A threaded reply or a "
                "two-part message, not a loop." % (n, widest))

    if widest >= burst:
        return ("batch",
                "%d in a row but %.1fs apart at widest. That is a poster, not a "
                "loop: a digest or a backlog being drained. Worth confirming it "
                "is deliberate." % (n, widest))

    return ("echo-loop",
            "%d consecutive self-authored messages, none more than %.2fs apart, "
            "with no human message in the run. The handler is hearing itself."
            % (n, widest))


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
    body = call(session, "conversations.history", channel=channel_id,
                limit=min(200, limit))
    return body.get("messages", [])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--channel", action="append", default=[],
                    help="channel id to read; repeatable. Default: every channel "
                         "the bot is a member of")
    ap.add_argument("--limit", type=int, default=200,
                    help="messages to read per channel")
    ap.add_argument("--min-run", type=int, default=4,
                    help="runs shorter than this are never reported as a loop")
    ap.add_argument("--burst", type=float, default=2.0,
                    help="seconds; a run spaced wider than this is a batch")
    args = ap.parse_args()

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        log.error("set SLACK_BOT_TOKEN (a bot token with channels:read and "
                  "channels:history is enough)")
        return 2

    session = requests.Session()
    session.headers.update({"Authorization": "Bearer " + token})

    me = call(session, "auth.test")
    identity = {"bot_id": me.get("bot_id"), "user_id": me.get("user_id")}
    log.info("authenticated as %s (bot_id=%s) in %s",
             me.get("user"), identity["bot_id"], me.get("team"))

    targets = channels(session, args.channel)
    if not targets:
        log.info("the bot is not a member of any conversation")
        return 0

    loops = longest = 0
    for ch in targets:
        messages = history(session, ch["id"], args.limit)
        state, detail = verdict(messages, identity,
                                min_run=args.min_run, burst=args.burst)
        name = ch.get("name", ch["id"])
        if state in ("quiet", "short-run"):
            log.info("%-10s #%s  %s", state, name, detail)
            continue
        if state == "batch":
            log.info("%-10s #%s  %s", state, name, detail)
            continue
        loops += 1
        log.warning("%-10s #%s  %s", state, name, detail)
        log.warning("  repair: in the handler, return early when event.bot_id is "
                    "set, when event.subtype is bot_message, or when event.user "
                    "== %s.", identity["user_id"])
        log.warning("  better: subscribe to app_mention instead of "
                    "message.channels so your own posts never reach the handler.")

    log.info("%d channel(s) checked, %d loop(s)", len(targets), loops)
    return 1 if loops else 0


if __name__ == "__main__":
    sys.exit(main())
