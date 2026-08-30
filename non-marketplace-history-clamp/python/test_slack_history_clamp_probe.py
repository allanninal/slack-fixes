from slack_history_clamp_probe import verdict


def test_a_full_page_is_unclamped():
    state, detail = verdict({"requested": 200, "returned": 200,
                             "next_cursor": "dXNlcjpV"})
    assert state == "unclamped"
    assert "Tier 3" in detail


def test_exactly_fifteen_with_a_cursor_is_the_clamp():
    state, _ = verdict({"requested": 200, "returned": 15,
                        "next_cursor": "dXNlcjpV"})
    assert state == "clamped"


def test_a_refused_second_call_confirms_it():
    state, detail = verdict({"requested": 200, "returned": 15,
                             "next_cursor": "dXNlcjpV",
                             "second_call_error": "ratelimited"})
    assert state == "clamped-confirmed"
    assert "ratelimited" in detail


def test_exactly_fifteen_with_no_cursor_is_not_a_finding():
    # A channel that has fifteen messages left looks identical to a clamped
    # page. Calling this clamped is the expensive mistake.
    state, detail = verdict({"requested": 200, "returned": 15, "next_cursor": ""})
    assert state == "inconclusive"
    assert "busier channel" in detail


def test_asking_for_fifteen_proves_nothing():
    state, _ = verdict({"requested": 15, "returned": 15, "next_cursor": "abc"})
    assert state == "not-probed"


def test_a_short_quiet_channel_is_not_clamped():
    state, _ = verdict({"requested": 200, "returned": 4, "next_cursor": ""})
    assert state == "small-channel"


def test_fewer_than_the_cap_with_a_cursor_is_something_else():
    state, _ = verdict({"requested": 200, "returned": 9, "next_cursor": "abc"})
    assert state == "short-page"
