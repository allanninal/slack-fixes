"""Report Slack channels the bot cannot post to, and why.

Read only. GET requests and nothing else: give this a bot token with
channels:read and groups:read. The repair is printed, never performed, because
this token can post into your workspace.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slack_channel_membership")

API = "https://slack.com/api/"


def verdict(body):
    """Classify one conversations.info response. Pure, so it runs offline.

    Order matters: an archived channel refuses everyone, so it outranks
    membership, and ok: false outranks both because there is no channel object
    to read at all.
    """
    if body.get("ok") is not True:
        error = body.get("error") or "<no error field>"
        if error == "channel_not_found":
            return ("not-found",
                    "channel_not_found. Either the ID is wrong, or it is a private "
                    "channel this token cannot see. Those are indistinguishable "
                    "without groups:read.")
        if error == "missing_scope":
            return ("scope",
                    "missing_scope: needed=%s. Membership is unknown until the "
                    "token can read the channel." % (body.get("needed") or "?"))
        return ("error", "ok: false, error=%s" % error)

    channel = body.get("channel") or {}
    if channel.get("is_archived"):
        return ("archived",
                "archived. Membership is beside the point: an archived channel "
                "accepts nothing from anyone until it is unarchived.")
    if channel.get("is_member"):
        return ("member", "the bot is in this channel")
    if channel.get("is_private"):
        return ("not-member-private",
                "not a member, and private. No API call joins a private channel: "
                "a human member has to invite the app.")
    return ("not-member-public",
            "not a member. Public, so the app can join itself with channels:join, "
            "or somebody can invite it.")


def get(session, method, **params):
    r = session.get(API + method, params=params, timeout=30)
    body = r.json()
    return body


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("channels", nargs="+", help="channel IDs the app targets (C..., G...)")
    args = ap.parse_args()

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        log.error("set SLACK_BOT_TOKEN (channels:read and groups:read are enough)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + token})

    me = get(s, "auth.test")
    if me.get("ok") is not True:
        log.error("auth.test answered 200 with ok: false, error=%s", me.get("error"))
        return 2
    bot = me.get("user_id")
    log.info("token acts as %s (%s) in %s", me.get("user"), bot, me.get("team"))

    bad = 0
    for cid in args.channels:
        body = get(s, "conversations.info", channel=cid)
        state, detail = verdict(body)
        name = (body.get("channel") or {}).get("name", "?")
        line = "%-19s %-12s #%s  %s" % (state, cid, name, detail)
        if state == "member":
            log.info(line)
            continue
        bad += 1
        log.warning(line)
        if state == "not-member-public":
            log.warning("  repair: /invite @YourApp in #%s, or call conversations.join "
                        "with channels:join", name)
            log.warning("  in a pipeline: conversations.invite channel=%s users=%s",
                        cid, bot)
        elif state == "not-member-private":
            log.warning("  repair: a member of the private channel runs /invite @YourApp; "
                        "the app cannot let itself in")
        elif state == "archived":
            log.warning("  repair: unarchive the channel, or point the app at a live one")
        elif state == "not-found":
            log.warning("  repair: check the ID, then add groups:read and reinstall "
                        "if the channel is private")

    log.info("%d channel(s) checked, %d the bot cannot post to", len(args.channels), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
