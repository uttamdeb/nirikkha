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


def generate_exam_code() -> str:
    return "NK-" + "".join(random.choice(_ALPHABET) for _ in range(4))


def sum_rubric_marks(parts: list[dict[str, Any]]) -> int:
    return sum(int(p.get("maxMarks") or 0) for p in parts)


def is_valid_rubric(parts: list[dict[str, Any]], total_marks: int) -> bool:
    if len(parts) != 4:
        return False
    keys = [str(p.get("key", "")).lower() for p in parts]
    if set(keys) != set(CQ_PARTS):
        return False
    return sum_rubric_marks(parts) == total_marks


def rubric_to_probable_answer(parts: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for part in parts:
        label = part.get("label") or part.get("key")
        title = part.get("title") or ""
        max_marks = part.get("maxMarks") or 0
        answer = part.get("modelAnswer") or part.get("prompt") or ""
        lines.append(f"{label} ({title}, {max_marks}): {answer}")
    return "\n".join(lines)


def format_rubric_for_grader(parts: list[dict[str, Any]] | None) -> str:
    """Inject exam-specific part descriptors into the grading prompt context."""
    if not parts:
        return ""
    lines = ["Exam-specific mark scheme for this script:"]
    for part in parts:
        key = str(part.get("key", "")).lower()
        label = part.get("label") or key
        title = part.get("title") or ""
        max_marks = part.get("maxMarks") or CQ_PARTS.get(key, ("", 0, ""))[1]
        prompt = (part.get("prompt") or "").strip()
        model = (part.get("modelAnswer") or "").strip()
        lines.append(f"- {key} ({label}) — {max_marks} marks — {title}")
        if prompt:
            lines.append(f"  Asked: {prompt}")
        if model:
            lines.append(f"  Model answer: {model}")
    return "\n".join(lines)
