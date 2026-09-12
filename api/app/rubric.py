"""CQ rubric helpers — shared by exam creation and Telegram announce."""

from __future__ import annotations

import random
from typing import Any, Literal

from .schemas import CQ_PARTS

PartKey = Literal["ka", "kha", "ga", "gha"]

DEFAULT_CQ_RUBRIC: list[dict[str, Any]] = [
    {
        "key": key,
        "label": bn,
        "title": skill,
        "prompt": "",
        "modelAnswer": "",
        "maxMarks": marks,
    }
    for key, (bn, marks, skill) in CQ_PARTS.items()
]

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_PART_KEYS = set(CQ_PARTS)


def generate_exam_code() -> str:
    return "NK-" + "".join(random.choice(_ALPHABET) for _ in range(4))


def _part_max(part: dict[str, Any]) -> int:
    raw = part.get("maxMarks", part.get("max_marks", 0))
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def sum_rubric_marks(parts: list[dict[str, Any]]) -> int:
    return sum(_part_max(p) for p in parts)


def normalize_rubric(parts: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Canonical camelCase shape matching the create-exam UI / source app."""
    if not parts:
        return [dict(p) for p in DEFAULT_CQ_RUBRIC]
    out: list[dict[str, Any]] = []
    for part in parts:
        key = str(part.get("key", "")).strip().lower()
        bn, default_marks, skill = CQ_PARTS.get(key, ("", 0, ""))
        out.append({
            "key": key,
            "label": str(part.get("label") or bn or key),
            "title": str(part.get("title") or skill or ""),
            "prompt": str(part.get("prompt") or ""),
            "modelAnswer": str(
                part.get("modelAnswer")
                or part.get("model_answer")
                or ""
            ),
            "maxMarks": _part_max(part) or default_marks,
        })
    return out


def is_valid_rubric(parts: list[dict[str, Any]], total_marks: int) -> bool:
    if len(parts) != 4:
        return False
    keys = [str(p.get("key", "")).lower() for p in parts]
    if set(keys) != _PART_KEYS:
        return False
    if any(_part_max(p) <= 0 for p in parts):
        return False
    return sum_rubric_marks(parts) == total_marks


def rubric_max_by_part(parts: list[dict[str, Any]] | None) -> dict[str, int]:
    """Part → max marks for grading. Falls back to the fixed CQ scheme."""
    defaults = {key: marks for key, (_, marks, _) in CQ_PARTS.items()}
    if not parts:
        return defaults
    for part in normalize_rubric(parts):
        key = part["key"]
        if key in defaults:
            defaults[key] = int(part["maxMarks"])
    return defaults


def rubric_to_probable_answer(parts: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for part in normalize_rubric(parts):
        lines.append(
            f"{part['label']} ({part['title']}, {part['maxMarks']}): "
            f"{part['modelAnswer'] or part['prompt']}"
        )
    return "\n".join(lines)


def format_rubric_for_grader(parts: list[dict[str, Any]] | None) -> str:
    """Inject exam-specific part descriptors into the grading prompt context."""
    if not parts:
        return ""
    lines = ["Exam-specific mark scheme for this script:"]
    for part in normalize_rubric(parts):
        lines.append(
            f"- {part['key']} ({part['label']}) — {part['maxMarks']} marks — {part['title']}"
        )
        if part["prompt"]:
            lines.append(f"  Asked: {part['prompt']}")
        if part["modelAnswer"]:
            lines.append(f"  Model answer: {part['modelAnswer']}")
    return "\n".join(lines)


def build_exam_question_text(prompt_text: str, rubric: list[dict[str, Any]] | None) -> str:
    prompt = (prompt_text or "").strip()
    rubric_block = format_rubric_for_grader(rubric)
    if prompt and rubric_block:
        return f"{prompt}\n\n{rubric_block}"
    return prompt or rubric_block
