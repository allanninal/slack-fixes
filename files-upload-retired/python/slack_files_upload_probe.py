"""Confirm whether files.upload is dead for this app, and whether it was noticed.

Read only. The probe calls files.upload with no arguments, which cannot create
anything: it exists to be refused, and the refusal is the finding. The migration
is printed, never performed.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("slack_files_upload_probe")

API = "https://slack.com/api/"

# 12 November 2025, 00:00 UTC: the day files.upload was sunset for all apps.
# The date was announced for 11 March 2025 and moved once.
SUNSET = 1762905600

DEAD = {"method_deprecated", "deprecated_endpoint"}
# Errors that mean the method answered rather than refused to exist.
ALIVE = {"no_file_data", "no_file_or_content", "invalid_arguments", "posting_to_general_channel_denied"}


def verdict(body):
    """Classify the argument-free files.upload probe. Pure, so it runs offline.

    The probe's whole job is to distinguish "this method no longer exists" from
    "this method exists and you called it wrong", and both arrive as HTTP 200.
    """
    if not isinstance(body, dict):
        return ("unreadable",
                "the probe got a body that is not JSON, so something other than "
                "Slack answered. Nothing can be concluded about the method.")
    error = body.get("error")
    if body.get("ok") is True:
        return ("unexpected",
                "ok: true from a call with no file. Read the response by hand "
                "before trusting anything else here.")
    if error in DEAD:
        return ("retired",
                "files.upload answered %s. The method was sunset for all apps on "
                "2025-11-12 and will not come back." % error)
    if error == "missing_scope":
        return ("unknown",
                "missing_scope: needed=%s. The probe never reached the method, so "
                "this says nothing about whether it is alive. Migrate anyway."
                % (body.get("needed") or "?"))
    if error in ("invalid_auth", "not_authed", "token_revoked", "account_inactive"):
        return ("auth",
                "error=%s. That is the token, not the method. Fix the credential "
                "and re-run before concluding anything." % error)
    if error in ALIVE:
        return ("still-answering",
                "error=%s, which means the method parsed the call rather than "
                "refusing to exist. Unexpected after the sunset, and still not a "
                "reason to stay on it." % error)
    return ("other",
            "error=%s. Not a deprecation answer; read it before acting."
            % (error or "<no error field>"))


def upload_activity(files, now=None, sunset=SUNSET):
    """Classify this app's own upload history against the cutover. Pure.

    `files` is the files.list array, restricted to files this bot uploaded.
    A fleet that has been failing since the sunset has no files after it.
    """
    stamps = sorted(int(f.get("created") or 0) for f in files)
    if not stamps:
        return ("no-uploads",
                "this app has uploaded no files the token can see, so there is "
                "no history to date the breakage from.")
    newest = stamps[-1]
    after = [s for s in stamps if s >= sunset]
    if after:
        return ("uploading",
                "%d file(s) uploaded after the 2025-11-12 cutover, so some caller "
                "already speaks the replacement flow." % len(after))
    days = int(((now or time.time()) - newest) / 86400)
    return ("silent-since-sunset",
            "newest upload is %d day(s) old and predates the cutover. Every "
            "caller has been failing since, quietly, at HTTP 200." % days)


def get(session, method, **params):
    r = session.get(API + method, params=params, timeout=30)
    try:
        return r.json()
    except ValueError:
        return r.text


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--count", type=int, default=100,
                    help="how many of the app's own files to read (default 100)")
    args = ap.parse_args()

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        log.error("set SLACK_BOT_TOKEN (files:read is enough for the corroboration)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + token})

    state, detail = verdict(get(s, "files.upload"))
    bad = 0
    if state == "retired":
        bad += 1
        log.warning("%-19s %s", state, detail)
        log.warning("  repair: files.getUploadURLExternal(filename, length) -> upload the "
                    "raw bytes to upload_url -> files.completeUploadExternal(files, channel_id)")
        log.warning("  or use the SDK helper: client.files_upload_v2(...) / "
                    "client.filesUploadV2({...})")
    elif state in ("still-answering", "unknown", "auth", "unreadable", "unexpected", "other"):
        log.warning("%-19s %s", state, detail)
    else:
        log.info("%-19s %s", state, detail)

    me = get(s, "auth.test")
    if isinstance(me, dict) and me.get("ok") is True:
        listing = get(s, "files.list", user=me.get("user_id"), count=str(args.count))
        if isinstance(listing, dict) and listing.get("ok") is True:
            hstate, hdetail = upload_activity(listing.get("files") or [])
            if hstate == "silent-since-sunset":
                bad += 1
                log.warning("%-19s %s", hstate, hdetail)
            else:
                log.info("%-19s %s", hstate, hdetail)
        else:
            log.info("%-19s files.list did not answer ok: true (%s); the probe "
                     "above stands on its own", "no-history",
                     isinstance(listing, dict) and listing.get("error") or "?")
    else:
        log.info("%-19s auth.test did not answer ok: true, so the history check "
                 "was skipped", "no-history")

    log.info("1 method probed, %d finding(s)", bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
