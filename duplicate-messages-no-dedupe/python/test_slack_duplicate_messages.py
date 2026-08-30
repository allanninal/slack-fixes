from slack_duplicate_messages import classify, fingerprint


def test_one_message_is_never_a_duplicate():
    state, detail = classify(["1712345678.000100"])
    assert state == "unique"
    assert "nothing to explain" in detail


def test_sub_second_copies_are_a_double_delivery():
    state, detail = classify(["1712345678.000100", "1712345678.400200"])
    assert state == "double-delivery"
    assert "app_mention" in detail


def test_sixty_and_three_hundred_second_gaps_are_slack_retries():
    state, detail = classify(["1000.0", "1061.0", "1358.0"])
    assert state == "retry-duplicate"
    assert "three seconds" in detail


def test_hours_apart_is_a_rerun_not_a_retry():
    state, _ = classify(["0.0", "7200.0"])
    assert state == "rerun"


def test_mixed_spacing_is_not_given_a_confident_cause():
    # Sub-second to the second copy, eight seconds to the third: none of the
    # three known causes produces this, so the script must say so.
    state, detail = classify(["1000.0", "1000.2", "1008.0"])
    assert state == "duplicated"
    assert "matches no known cause" in detail


def test_identical_fallback_text_with_different_blocks_is_not_a_duplicate():
    a = {"text": "New alert", "blocks": [{"type": "section", "text": "disk full"}]}
    b = {"text": "New alert", "blocks": [{"type": "section", "text": "cert expiring"}]}
    assert fingerprint(a) != fingerprint(b)


def test_the_same_content_at_different_timestamps_shares_a_fingerprint():
    a = {"text": "deploy finished", "ts": "1712345678.000100"}
    b = {"text": "deploy finished", "ts": "1712345738.000200"}
    assert fingerprint(a) == fingerprint(b)
