"""Unit tests for the pure logic — the parts where a silent bug costs a student marks."""

from __future__ import annotations

import pytest

from app.agents.base import AgentError, as_int, limit_words, parse_json_object
from app.agents.grader import _coerce, blank_answer_result, build_transcript
from app.agents.ocr import parse_transcription, score_line
from app.pipeline import needs_clarification
from app.prompts import UNCLEAR_LINE, UNCLEAR_TOKEN
from app.schemas import CQ_PARTS, CQ_TOTAL, BBox, GradeResult, OverrideMark

# --------------------------------------------------------------------- rubric

def test_cq_mark_split_is_one_two_three_four():
    assert [m for _, m, _ in CQ_PARTS.values()] == [1, 2, 3, 4]
    assert CQ_TOTAL == 10
    assert [bn for bn, _, _ in CQ_PARTS.values()] == ["ক", "খ", "গ", "ঘ"]


# --------------------------------------------------------------------- JSON coercion

@pytest.mark.parametrize("raw", [
    '{"a": 1}',
    '```json\n{"a": 1}\n```',
    '```\n{"a": 1}\n```',
    'Here you go:\n{"a": 1}',
])
def test_parse_json_object_survives_fences_and_preamble(raw):
    assert parse_json_object(raw) == {"a": 1}


@pytest.mark.parametrize("raw", ["", "   ", "not json", "[1,2,3]", "null"])
def test_parse_json_object_rejects_non_objects(raw):
    with pytest.raises(AgentError):
        parse_json_object(raw)


def test_as_int_rejects_booleans():
    # isinstance(True, int) is True in Python; letting it through would award a mark.
    with pytest.raises(AgentError):
        as_int(True, field="awarded")
    with pytest.raises(AgentError):
        as_int(False, field="awarded")


@pytest.mark.parametrize("value,expected", [(3, 3), (3.0, 3), ("3", 3), (-1, -1)])
def test_as_int_accepts_whole_numbers(value, expected):
    assert as_int(value, field="x") == expected


@pytest.mark.parametrize("value", [3.5, "three", None, [3], {"a": 3}])
def test_as_int_rejects_everything_else(value):
    with pytest.raises(AgentError):
        as_int(value, field="x")


def test_limit_words_truncates_and_normalises_whitespace():
    assert limit_words("  a   b\n c  d ", 3) == "a b c"
    assert limit_words("a b", 10) == "a b"
    assert limit_words("", 5) == ""


# --------------------------------------------------------------------- legibility

def test_clean_line_scores_full_legibility():
    score, guess = score_line("ক) ত্বরণ হলো বেগের পরিবর্তনের হার।")
    assert score == 1.0
    assert guess is False


def test_wholly_unreadable_line_scores_zero():
    score, guess = score_line(UNCLEAR_LINE)
    assert score == 0.0
    assert guess is True


def test_one_unclear_word_in_a_long_line_stays_readable():
    long_line = f"এই বাক্যটি অনেক লম্বা এবং এখানে কেবল {UNCLEAR_TOKEN} একটি শব্দ পড়া যায়নি বাকিটা স্পষ্ট আছে"
    score, guess = score_line(long_line)
    assert guess is True
    assert score > 0.65, "one bad word in a long line should not trigger the gate"


def test_several_unclear_words_in_a_short_line_trips_the_gate():
    score, _ = score_line(f"{UNCLEAR_TOKEN} {UNCLEAR_TOKEN} কমে")
    assert score < 0.65, "a mostly-unreadable line must be flagged"


def test_legibility_is_monotonic_in_marker_count():
    base = "এক দুই তিন চার পাঁচ ছয় সাত আট"
    scores = [
        score_line(base + f" {UNCLEAR_TOKEN}" * n)[0]
        for n in range(4)
    ]
    assert scores == sorted(scores, reverse=True), scores


# --------------------------------------------------------------------- transcription

def test_parse_transcription_numbers_lines_densely_and_drops_blanks():
    lines = parse_transcription("ক) এক\n\n  \nখ) দুই\nগ) তিন")
    assert [line.index for line in lines] == [0, 1, 2]
    assert [line.text for line in lines] == ["ক) এক", "খ) দুই", "গ) তিন"]


def test_parse_transcription_handles_crlf_and_empty_input():
    assert [line.text for line in parse_transcription("a\r\nb")] == ["a", "b"]
    assert parse_transcription("") == []
    assert parse_transcription("   \n  ") == []


# --------------------------------------------------------------------- the gate

def test_clarified_line_is_never_flagged_again():
    line = {"text": UNCLEAR_LINE, "legibility": 0.0, "is_guess": True,
            "clarified_text": "ঘ) ভর বাড়লে ত্বরণ কমে।"}
    assert needs_clarification(line, 0.65) is False


def test_guessed_line_is_flagged_regardless_of_score():
    assert needs_clarification({"text": "x", "legibility": 0.99, "is_guess": True}, 0.65) is True


def test_line_without_a_legibility_score_is_not_flagged():
    # An engine that reports no confidence must not flag the whole page.
    assert needs_clarification({"text": "x", "legibility": None, "is_guess": False}, 0.65) is False


def test_threshold_boundary_is_exclusive():
    assert needs_clarification({"text": "x", "legibility": 0.65, "is_guess": False}, 0.65) is False
    assert needs_clarification({"text": "x", "legibility": 0.649, "is_guess": False}, 0.65) is True


# --------------------------------------------------------------------- grader output

def _parts(**awards):
    return [{"part": k, "awarded": v, "reason": "r", "evidence_lines": [0]}
            for k, v in awards.items()]


def test_coerce_accepts_a_well_formed_result():
    result = _coerce({"parts": _parts(ka=1, kha=2, ga=3, gha=4), "feedback": "ভালো"})
    assert result.total_awarded == 10
    assert [p.part for p in result.parts] == ["ka", "kha", "ga", "gha"]


def test_coerce_rejects_a_mark_above_the_part_maximum():
    with pytest.raises(AgentError, match="outside"):
        _coerce({"parts": _parts(ka=2, kha=2, ga=3, gha=4)})


def test_coerce_rejects_a_missing_part():
    with pytest.raises(AgentError, match="omitted"):
        _coerce({"parts": _parts(ka=1, kha=2, ga=3)})


def test_coerce_rejects_a_duplicated_part():
    payload = {"parts": _parts(ka=1, kha=2, ga=3, gha=4)}
    payload["parts"].append({"part": "ka", "awarded": 0, "reason": "dup"})
    with pytest.raises(AgentError, match="twice"):
        _coerce(payload)


def test_coerce_rejects_a_boolean_mark():
    with pytest.raises(AgentError):
        _coerce({"parts": _parts(ka=True, kha=2, ga=3, gha=4)})


def test_coerce_caps_improvement_length():
    payload = {"parts": _parts(ka=0, kha=2, ga=3, gha=4)}
    payload["parts"][0]["improvement"] = " ".join(["শব্দ"] * 200)
    result = _coerce(payload)
    assert len(result.parts[0].improvement.split()) <= 40


def test_total_is_computed_not_taken_from_the_model():
    # A model claiming a total must not be able to override the arithmetic.
    result = _coerce({"parts": _parts(ka=1, kha=1, ga=1, gha=1), "total": 99})
    assert result.total_awarded == 4


def test_blank_answer_awards_nothing_and_explains_why():
    result = blank_answer_result()
    assert result.total_awarded == 0
    assert len(result.parts) == 4
    assert all(p.improvement for p in result.parts)


# --------------------------------------------------------------------- transcript

def test_build_transcript_uses_clarified_text_and_numbers_lines():
    rows = [
        {"line_index": 0, "text": f"ঘ) ভর {UNCLEAR_TOKEN} হলে", "clarified_text": "ঘ) ভর দ্বিগুণ হলে"},
        {"line_index": 1, "text": "কারণ a = F/m", "clarified_text": None},
    ]
    out = build_transcript(rows)
    assert "[0] ঘ) ভর দ্বিগুণ হলে" in out
    assert UNCLEAR_TOKEN not in out, "a resolved line must lose its marker"
    assert "[1] কারণ a = F/m" in out


def test_build_transcript_keeps_markers_on_unresolved_lines():
    out = build_transcript([{"line_index": 0, "text": f"x {UNCLEAR_TOKEN}", "clarified_text": None}])
    assert UNCLEAR_TOKEN in out


# --------------------------------------------------------------------- schemas

def test_bbox_normalises_inverted_corners():
    box = BBox(x0=0.8, y0=0.9, x1=0.2, y1=0.1)
    assert box.x0 < box.x1 and box.y0 < box.y1


def test_bbox_flags_degenerate_boxes():
    assert BBox(x0=0.5, y0=0.5, x1=0.5001, y1=0.9).is_degenerate() is True
    assert BBox(x0=0.1, y0=0.1, x1=0.9, y1=0.9).is_degenerate() is False


def test_override_cannot_exceed_the_part_maximum():
    OverrideMark(part="gha", new_awarded=4)
    with pytest.raises(ValueError):
        OverrideMark(part="ka", new_awarded=2)
    with pytest.raises(ValueError):
        OverrideMark(part="ga", new_awarded=4)


def test_grade_result_requires_all_four_parts():
    with pytest.raises(ValueError):
        GradeResult(parts=[])
