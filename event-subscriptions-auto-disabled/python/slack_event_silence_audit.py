"""Find channels where a Slack app is addressed and has stopped answering.

Read only. GET requests and nothing else: channels:history and membership are
enough. This detects the symptom of disabled event delivery, not the flag: no
read method reports whether Slack is delivering, so the repair ends at the app
configuration page and is printed, never performed.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slack_event_silence_audit")

API = "https://slack.com/api/"


def scan(messages, bot_id, bot_user_id):
    """Reduce one page of history to the four numbers that matter. Pure.

    A trigger is a message mentioning the bot that the bot did not write. A
    reply is any message carrying the app's own bot_id. `unanswered` counts the
    triggers that arrived after the app last said anything.
    """
    mention = "<@%s>" % bot_user_id
    replies, triggers = [], []
    for m in messages:
        ts = float(m.get("ts") or 0)
        if m.get("bot_id") == bot_id:
            replies.append(ts)
        elif mention in (m.get("text") or ""):
            triggers.append(ts)
    last_reply = max(replies) if replies else None
    last_trigger = max(triggers) if triggers else None
    unanswered = len([t for t in triggers if last_reply is None or t > last_reply])
    return {"replies": len(replies), "triggers": len(triggers),
            "last_reply": last_reply, "last_trigger": last_trigger,
            "unanswered": unanswered}


def verdict(stats, min_triggers=3):
    """Decide whether the silence is evidence. Pure, and mostly a refusal.

    Three different causes produce this shape - delivery disabled by Slack, the
    handler down, and events never subscribed to - and none of them can be told
    apart from inside the workspace. The states name the shape, not the cause.
    """
    if not stats["triggers"]:
        return ("no-triggers",
                "nothing addressed the app in this window, so there is no "
                "evidence either way. Silence is not a finding on its own.")
    if not stats["unanswered"]:
        return ("answering",
                "%d mention(s), and the app replied after the most recent one"
                % stats["triggers"])
    if not stats["replies"]:
        return ("never-answered",
                "%d mention(s) and the app has never posted here. That points at "
                "subscriptions never configured or a Request URL that never "
                "verified, rather than at delivery being switched off."
                % stats["triggers"])
    if stats["unanswered"] >= min_triggers:
        hours = (stats["last_trigger"] - stats["last_reply"]) / 3600.0
        return ("silent",
                "%d mention(s) since the app last replied, spanning %.1f hour(s). "
                "It was answering and then stopped: check whether Slack disabled "
                "event delivery." % (stats["unanswered"], hours))
    return ("too-little-evidence",
            "%d unanswered mention(s), below the %d needed to call it. People "
            "type a bot's name without expecting an answer."
            % (stats["unanswered"], min_triggers))


def get(session, method, **params):
    r = session.get(API + method, params=params, timeout=30)
    try:
        return r.json()
    except ValueError:
        return {"ok": False, "error": "unparseable_body"}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("channels", nargs="+", help="channel IDs the app serves (C...)")
    ap.add_argument("--limit", type=int, default=200,
                    help="messages of history per channel (default 200)")
    ap.add_argument("--min-triggers", type=int, default=3,
                    help="unanswered mentions before it counts (default 3)")
    args = ap.parse_args()

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        log.error("set SLACK_BOT_TOKEN (channels:history and membership are enough)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + token})

    me = get(s, "auth.test")
    if me.get("ok") is not True:
        log.error("auth.test answered 200 with ok: false, error=%s", me.get("error"))
        return 2
    bot_id, bot_user = me.get("bot_id"), me.get("user_id")
    log.info("app is %s (bot_id=%s, mentioned as <@%s>)", me.get("user"), bot_id, bot_user)

    bad = 0
    for cid in args.channels:
        body = get(s, "conversations.history", channel=cid, limit=str(args.limit))
        if body.get("ok") is not True:
            bad += 1
            log.warning("%-20s %-12s history refused: error=%s. Membership and "
                        "channels:history come first; this audit assumes both",
                        "unreadable", cid, body.get("error"))
            continue
        stats = scan(body.get("messages") or [], bot_id, bot_user)
        state, detail = verdict(stats, args.min_triggers)
        line = "%-20s %-12s %s" % (state, cid, detail)
        if state in ("silent", "never-answered"):
            bad += 1
            log.warning(line)
            log.warning("  the Web API cannot tell you whether Slack disabled "
                        "delivery: open Event Subscriptions in the app config")
            log.warning("  repair: fix the endpoint, re-enable delivery by hand, then "
                        "alert on the Request URL before 95%% of an hour fails")
        else:
            log.info(line)

    log.info("%d channel(s) checked, %d where the app has gone quiet",
             len(args.channels), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
