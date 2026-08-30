from slack_channel_membership import verdict


def ok(**channel):
    return {"ok": True, "channel": channel}


def test_member_of_a_live_channel_is_fine():
    state, _ = verdict(ok(name="alerts", is_member=True))
    assert state == "member"


def test_archived_outranks_membership():
    # A member of an archived channel still cannot post to it.
    state, detail = verdict(ok(name="old-alerts", is_member=True, is_archived=True))
    assert state == "archived"
    assert "unarchived" in detail


def test_public_channel_can_be_self_joined():
    state, detail = verdict(ok(name="general", is_member=False, is_private=False))
    assert state == "not-member-public"
    assert "channels:join" in detail


def test_private_channel_needs_a_human():
    state, detail = verdict(ok(name="secrets", is_member=False, is_private=True))
    assert state == "not-member-private"
    assert "invite" in detail


def test_channel_not_found_stays_ambiguous():
    state, detail = verdict({"ok": False, "error": "channel_not_found"})
    assert state == "not-found"
    assert "groups:read" in detail


def test_missing_scope_is_not_a_membership_answer():
    body = {"ok": False, "error": "missing_scope", "needed": "channels:read"}
    state, detail = verdict(body)
    assert state == "scope"
    assert "channels:read" in detail


def test_other_errors_are_not_reported_as_membership():
    assert verdict({"ok": False, "error": "invalid_auth"})[0] == "error"
