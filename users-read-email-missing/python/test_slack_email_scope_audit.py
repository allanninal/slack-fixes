from slack_email_scope_audit import parse_scopes, verdict


def human(uid, email=None):
    profile = {"real_name": "A Person"}
    if email:
        profile["email"] = email
    return {"id": uid, "deleted": False, "is_bot": False, "profile": profile}


def test_no_emails_and_no_scope_is_the_finding():
    members = [human("U1"), human("U2")]
    state, detail = verdict(members, {"users:read"})
    assert state == "scope-missing"
    assert "0 of 2" in detail


def test_no_emails_with_the_scope_is_not_a_scope_problem():
    members = [human("U1"), human("U2")]
    state, detail = verdict(members, {"users:read", "users:read.email"})
    assert state == "scope-granted-none-visible"
    assert "admin policy" in detail


def test_a_few_missing_is_ordinary_and_says_so():
    members = [human("U1", "a@example.com"), human("U2")]
    state, detail = verdict(members, {"users:read", "users:read.email"})
    assert state == "partial"
    assert "per member" in detail


def test_every_human_with_an_email_is_complete():
    members = [human("U1", "a@example.com"), human("U2", "b@example.com")]
    assert verdict(members, {"users:read.email"})[0] == "complete"


def test_bots_and_deactivated_accounts_are_not_in_the_denominator():
    members = [
        human("U1", "a@example.com"),
        {"id": "U2", "deleted": True, "is_bot": False, "profile": {}},
        {"id": "B1", "deleted": False, "is_bot": True, "profile": {}},
        {"id": "USLACKBOT", "deleted": False, "is_bot": False, "profile": {}},
    ]
    state, detail = verdict(members, {"users:read.email"})
    assert state == "complete"
    assert "1 of 1" in detail


def test_a_page_of_only_bots_yields_no_verdict():
    members = [{"id": "B1", "deleted": False, "is_bot": True, "profile": {}}]
    assert verdict(members, set())[0] == "no-humans"


def test_scope_header_parsing_survives_spaces_and_absence():
    assert parse_scopes("users:read, users:read.email ,team:read") == {
        "users:read", "users:read.email", "team:read"}
    assert parse_scopes(None) == set()
    assert parse_scopes("") == set()
