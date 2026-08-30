from slack_event_silence_audit import scan, verdict

BOT = "B123"
BOT_USER = "U999"


def msg(ts, text="hello", bot=False):
    m = {"ts": "%d.000100" % ts, "text": text}
    if bot:
        m["bot_id"] = BOT
    return m


def mention(ts):
    return msg(ts, "<@%s> please deploy" % BOT_USER)


def test_scan_separates_triggers_from_replies():
    messages = [mention(100), msg(110, "unrelated chatter"), msg(120, "done", bot=True)]
    stats = scan(messages, BOT, BOT_USER)
    assert stats["triggers"] == 1
    assert stats["replies"] == 1
    assert stats["unanswered"] == 0


def test_the_bots_own_mention_of_itself_is_not_a_trigger():
    messages = [msg(100, "<@%s> was asked" % BOT_USER, bot=True)]
    assert scan(messages, BOT, BOT_USER)["triggers"] == 0


def test_a_run_of_mentions_after_the_last_reply_is_the_finding():
    messages = [msg(1000, "on it", bot=True), mention(5000), mention(9000), mention(13000)]
    state, detail = verdict(scan(messages, BOT, BOT_USER))
    assert state == "silent"
    assert "3 mention(s)" in detail


def test_an_app_that_never_replied_is_a_different_diagnosis():
    messages = [mention(1000), mention(2000), mention(3000), mention(4000)]
    state, detail = verdict(scan(messages, BOT, BOT_USER))
    assert state == "never-answered"
    assert "never configured" in detail


def test_a_reply_after_the_last_mention_is_healthy():
    messages = [mention(1000), msg(1100, "done", bot=True)]
    assert verdict(scan(messages, BOT, BOT_USER))[0] == "answering"


def test_one_unanswered_mention_is_not_enough():
    messages = [msg(1000, "done", bot=True), mention(2000)]
    assert verdict(scan(messages, BOT, BOT_USER))[0] == "too-little-evidence"


def test_a_quiet_channel_is_not_evidence():
    messages = [msg(1000, "morning"), msg(2000, "morning")]
    assert verdict(scan(messages, BOT, BOT_USER))[0] == "no-triggers"


def test_the_threshold_is_adjustable():
    messages = [msg(1000, "done", bot=True), mention(2000), mention(3000)]
    assert verdict(scan(messages, BOT, BOT_USER), min_triggers=2)[0] == "silent"
