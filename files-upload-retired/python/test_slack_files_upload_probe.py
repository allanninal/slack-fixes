from slack_files_upload_probe import SUNSET, upload_activity, verdict


def test_method_deprecated_is_the_finding():
    state, detail = verdict({"ok": False, "error": "method_deprecated"})
    assert state == "retired"
    assert "2025-11-12" in detail


def test_deprecated_endpoint_is_the_same_finding():
    assert verdict({"ok": False, "error": "deprecated_endpoint"})[0] == "retired"


def test_missing_scope_proves_nothing_about_the_method():
    state, detail = verdict({"ok": False, "error": "missing_scope", "needed": "files:write"})
    assert state == "unknown"
    assert "files:write" in detail


def test_a_parsed_call_means_the_method_still_answers():
    assert verdict({"ok": False, "error": "no_file_data"})[0] == "still-answering"


def test_a_credential_error_is_not_a_deprecation():
    assert verdict({"ok": False, "error": "invalid_auth"})[0] == "auth"


def test_non_json_body_is_not_an_answer():
    assert verdict("<html>proxy</html>")[0] == "unreadable"


def test_history_ending_before_the_cutover_is_a_silent_outage():
    files = [{"created": SUNSET - 86400 * 30}, {"created": SUNSET - 86400 * 400}]
    state, detail = upload_activity(files, now=SUNSET + 86400 * 10)
    assert state == "silent-since-sunset"
    assert "40 day(s)" in detail


def test_an_upload_after_the_cutover_clears_the_history_check():
    files = [{"created": SUNSET - 10}, {"created": SUNSET + 10}]
    assert upload_activity(files, now=SUNSET + 86400)[0] == "uploading"


def test_no_files_is_not_evidence_either_way():
    assert upload_activity([], now=SUNSET)[0] == "no-uploads"
