from slack_ok_false_audit import verdict


def test_two_hundred_with_ok_false_is_a_failure():
    state, detail = verdict(200, {"ok": False, "error": "not_in_channel"})
    assert state == "ok-false"
    assert "not_in_channel" in detail


def test_two_hundred_with_ok_true_is_the_only_success():
    state, _ = verdict(200, {"ok": True})
    assert state == "ok"


def test_missing_ok_field_is_not_silently_a_success():
    # A proxy error page that happens to parse as JSON lands here.
    state, detail = verdict(200, {"channels": []})
    assert state == "ok-false"
    assert "no error field" in detail


def test_warning_on_a_successful_call_is_its_own_state():
    state, detail = verdict(200, {"ok": True, "warning": "missing_charset"})
    assert state == "warned"
    assert "missing_charset" in detail


def test_response_metadata_warnings_are_read_too():
    body = {"ok": True, "response_metadata": {"warnings": ["superfluous_charset"]}}
    assert verdict(200, body)[0] == "warned"


def test_non_json_body_is_not_a_slack_answer():
    assert verdict(200, "<html>proxy error</html>")[0] == "unreadable"


def test_real_status_codes_are_still_real():
    state, detail = verdict(429, {"ok": False, "error": "ratelimited"})
    assert state == "transport"
    assert "429" in detail
