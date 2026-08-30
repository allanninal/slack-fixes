from slack_public_files_audit import verdict


def test_a_public_url_is_an_exposure():
    state, detail = verdict({"public_url_shared": True, "channels": ["C1"]})
    assert state == "exposed"
    assert "no login" in detail


def test_a_public_url_on_a_file_in_no_channel_is_worse():
    state, detail = verdict({"public_url_shared": True,
                             "channels": [], "groups": [], "ims": []})
    assert state == "exposed-orphan"
    assert "no channel" in detail


def test_is_public_alone_is_not_an_exposure():
    # A screenshot in #general. Slack login still required.
    state, detail = verdict({"is_public": True, "channels": ["C1"]})
    assert state == "workspace-visible"
    assert "Not an exposure" in detail


def test_a_private_file_is_private():
    assert verdict({"channels": ["C1"]})[0] == "private"


def test_an_external_file_is_not_judged_by_slack_flags():
    state, _ = verdict({"is_external": True, "public_url_shared": True})
    assert state == "external"


def test_a_file_with_no_flags_at_all_is_private():
    assert verdict({})[0] == "private"
