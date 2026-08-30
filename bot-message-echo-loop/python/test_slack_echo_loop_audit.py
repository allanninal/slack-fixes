from slack_echo_loop_audit import is_self, verdict

ME = {"bot_id": "B111", "user_id": "U111"}


def msg(ts, *, bot=None, user=None):
    m = {"ts": str(ts)}
    if bot:
        m["bot_id"] = bot
    if user:
        m["user"] = user
    return m


def test_another_apps_bot_message_is_not_ours():
    assert is_self(msg(1, bot="B999"), ME) is False


def test_our_bot_id_and_our_user_id_both_count():
    assert is_self(msg(1, bot="B111"), ME) is True
    assert is_self(msg(2, user="U111"), ME) is True


def test_replies_interleaved_with_humans_are_quiet():
    messages = [msg(1, user="U777"), msg(2, bot="B111"),
                msg(3, user="U777"), msg(4, bot="B111")]
    state, _ = verdict(messages, ME)
    assert state == "quiet"


def test_a_fast_unbroken_run_is_the_loop():
    messages = [msg(1000 + i * 0.3, bot="B111") for i in range(12)]
    state, detail = verdict(messages, ME)
    assert state == "echo-loop"
    assert "12" in detail


def test_a_slow_long_run_is_a_batch_not_a_loop():
    # A digest posting one message every five seconds. Reporting this is how
    # the check gets switched off.
    messages = [msg(1000 + i * 5.0, bot="B111") for i in range(12)]
    state, _ = verdict(messages, ME)
    assert state == "batch"


def test_history_arriving_newest_first_is_still_measured_correctly():
    newest_first = [msg(1000 + i * 0.3, bot="B111") for i in range(9)][::-1]
    assert verdict(newest_first, ME)[0] == "echo-loop"


def test_two_in_a_row_is_a_short_run():
    messages = [msg(1, user="U777"), msg(2, bot="B111"), msg(2.4, bot="B111")]
    state, _ = verdict(messages, ME)
    assert state == "short-run"
