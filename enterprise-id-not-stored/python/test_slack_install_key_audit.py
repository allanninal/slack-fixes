from slack_install_key_audit import collisions, verdict


def test_grid_install_with_no_stored_enterprise_id_is_the_finding():
    stored = {"key": "T111"}
    live = {"ok": True, "team_id": "T111", "enterprise_id": "E999",
            "is_enterprise_install": False}
    state, detail = verdict(stored, live)
    assert state == "enterprise-id-dropped"
    assert "E999" in detail


def test_org_wide_install_filed_under_a_workspace_key():
    stored = {"key": "T111", "enterprise_id": "E999"}
    live = {"ok": True, "team_id": None, "enterprise_id": "E999",
            "is_enterprise_install": True}
    assert verdict(stored, live)[0] == "org-install-under-team-key"


def test_row_pointing_at_another_org_is_a_credential_handout():
    stored = {"key": "E1.T111", "enterprise_id": "E1"}
    live = {"ok": True, "team_id": "T111", "enterprise_id": "E2",
            "is_enterprise_install": False}
    state, detail = verdict(stored, live)
    assert state == "enterprise-id-wrong"
    assert "another organisation" in detail


def test_plain_workspace_install_is_not_reported():
    stored = {"key": "T111"}
    live = {"ok": True, "team_id": "T111", "enterprise_id": None,
            "is_enterprise_install": False}
    state, detail = verdict(stored, live)
    assert state == "single-workspace"
    assert "migrates to an org" in detail


def test_key_that_does_not_round_trip():
    stored = {"key": "T222"}
    live = {"ok": True, "team_id": "T111", "enterprise_id": None,
            "is_enterprise_install": False}
    assert verdict(stored, live)[0] == "key-drift"


def test_dead_token_is_reported_rather_than_guessed_at():
    assert verdict({"key": "T111"}, {"ok": False, "error": "token_revoked"})[0] == "unusable"


def test_same_team_under_two_orgs_is_a_cross_row_finding():
    seen = [{"key": "T111", "team_id": "T111", "enterprise_id": "E1"},
            {"key": "T111", "team_id": "T111", "enterprise_id": "E2"}]
    teams, keys = collisions(seen)
    assert teams == ["T111"]
    assert keys == ["T111"]


def test_distinct_installs_do_not_collide():
    seen = [{"key": "E1.T111", "team_id": "T111", "enterprise_id": "E1"},
            {"key": "E2.T222", "team_id": "T222", "enterprise_id": "E2"}]
    assert collisions(seen) == ([], [])
