from slack_scope_audit import parse_scopes, verdict


def test_scope_header_is_split_and_trimmed():
    assert parse_scopes("channels:read, users:read ,chat:write") == (
        "channels:read", "chat:write", "users:read")


def test_absent_scope_header_is_empty_not_a_crash():
    assert parse_scopes(None) == ()
    assert parse_scopes("") == ()


def test_a_successful_call_needs_nothing():
    state, _ = verdict(("channels:read",), {"ok": True})
    assert state == "ok"


def test_missing_scope_names_the_alternatives_as_a_choice():
    body = {"ok": False, "error": "missing_scope",
            "needed": "channels:history,groups:history",
            "provided": "chat:write,users:read"}
    state, detail = verdict(("chat:write", "users:read"), body)
    assert state == "missing-scope"
    assert "any one of" in detail
    assert "channels:history" in detail
    assert "reinstalled" in detail


def test_credential_errors_are_not_scope_errors():
    state, detail = verdict((), {"ok": False, "error": "not_allowed_token_type"})
    assert state == "wrong-token"
    assert "will not change it" in detail


def test_unrelated_errors_do_not_become_scope_findings():
    state, _ = verdict(("channels:read",), {"ok": False, "error": "channel_not_found"})
    assert state == "other"


def test_missing_scope_without_a_needed_field_still_reports():
    state, detail = verdict((), {"ok": False, "error": "missing_scope"})
    assert state == "missing-scope"
    assert "did not name one" in detail


def test_a_granted_list_that_contradicts_the_response_is_its_own_state():
    body = {"ok": False, "error": "missing_scope", "needed": "channels:history"}
    state, detail = verdict(("channels:history",), body)
    assert state == "scope-list-mismatch"
    assert "X-OAuth-Scopes" in detail
