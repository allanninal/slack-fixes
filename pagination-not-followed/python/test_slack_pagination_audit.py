from slack_pagination_audit import cursor_of, verdict


def test_absent_response_metadata_means_the_end():
    assert cursor_of({"ok": True, "channels": []}) == ""


def test_null_and_empty_cursors_mean_the_end_too():
    assert cursor_of({"response_metadata": {"next_cursor": None}}) == ""
    assert cursor_of({"response_metadata": {"next_cursor": "   "}}) == ""


def test_a_real_cursor_survives():
    assert cursor_of({"response_metadata": {"next_cursor": "dGVhbTpDMDYx"}}) == "dGVhbTpDMDYx"


def test_full_page_with_a_cursor_is_the_truncation_signature():
    state, detail = verdict(100, 100, "dGVhbTpD")
    assert state == "truncated"
    assert "100" in detail


def test_short_page_with_a_cursor_still_has_more():
    state, detail = verdict(37, 100, "dGVhbTpD")
    assert state == "more-pages"
    assert "not the last page" in detail


def test_full_page_without_a_cursor_is_complete_but_not_reassuring():
    state, detail = verdict(100, 100, "")
    assert state == "complete-at-limit"
    assert "luck" in detail


def test_short_page_without_a_cursor_is_the_whole_set():
    state, _ = verdict(42, 100, "")
    assert state == "complete"


def test_the_full_walk_reports_what_is_being_missed():
    _, detail = verdict(100, 100, "dGVhbTpD", total=412)
    assert "412" in detail
    assert "misses 312" in detail
