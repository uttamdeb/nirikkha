"""Grading agent — marks a transcribed script against the CQ rubric.

Separate from OCR on purpose: this stage never sees the image, only text. That
is what lets either side be swapped without touching the other, and means the
grading model needs no vision capability at all.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol, runtime_checkable

from ..config import settings
from ..prompts import (
    CQ_GRADING_PROMPT,
    MAX_FEEDBACK_WORDS,
    MAX_IMPROVEMENT_WORDS,
    UNCLEAR_LINE,
    UNCLEAR_TOKEN,
    build_grading_input,
)
from ..schemas import CQ_PARTS, GradeResult, PartMark
from .base import AgentError, as_int, limit_words, parse_json_object, with_retry

log = logging.getLogger("nirikkha.grader")


@runtime_checkable
class GraderProvider(Protocol):
    name: str

    async def grade(self, question_text: str, transcript: str) -> GradeResult: ...


def build_transcript(lines: list[dict[str, Any]]) -> str:
    """Render OCR lines for the grader, line-numbered.

    A line the student clarified is substituted verbatim, so the uncertainty
    markers disappear — that is the whole point of the clarification loop. Lines
    still unresolved keep their [[অস্পষ্ট]] markers inline, exactly where the
    reader failed, and the prompt tells the grader not to penalise them.
    """
    rendered: list[str] = []
    for line in lines:
        clarified = (line.get("clarified_text") or "").strip()
        text = clarified or (line.get("text") or "")
        index = line.get("line_index", line.get("index", 0))
        rendered.append(f"[{index}] {text}")
    return "\n".join(rendered)


def transcript_has_unresolved(transcript: str) -> bool:
    return UNCLEAR_TOKEN in transcript or UNCLEAR_LINE in transcript


def _coerce(payload: dict[str, Any]) -> GradeResult:
    raw_parts = payload.get("parts")
    if not isinstance(raw_parts, list):
        raise AgentError("grader response missing a 'parts' array")

    by_key: dict[str, PartMark] = {}
    for item in raw_parts:
        if not isinstance(item, dict):
            continue
        key = str(item.get("part", "")).strip().lower()
        if key not in CQ_PARTS:
            log.warning("grader returned unknown part %r, ignoring", key)
            continue
        if key in by_key:
            raise AgentError(f"grader returned part {key!r} twice")

        max_marks = CQ_PARTS[key][1]
        awarded = as_int(item.get("awarded"), field=f"{key}.awarded")
        if not 0 <= awarded <= max_marks:
            raise AgentError(f"part {key}: awarded {awarded} outside 0..{max_marks}")

        evidence = item.get("evidence_lines")
        evidence_lines: list[int] = []
        if isinstance(evidence, list):
            for value in evidence:
                try:
                    evidence_lines.append(as_int(value, field=f"{key}.evidence_lines"))
                except AgentError:
                    continue

        by_key[key] = PartMark(
            part=key,  # type: ignore[arg-type]
            max_marks=max_marks,
            awarded=awarded,
            reason=str(item.get("reason") or "").strip(),
            improvement=limit_words(
                str(item.get("improvement") or ""), MAX_IMPROVEMENT_WORDS
            ),
            evidence_lines=evidence_lines,
        )

    missing = set(CQ_PARTS) - set(by_key)
    if missing:
        raise AgentError(f"grader omitted part(s): {', '.join(sorted(missing))}")

    return GradeResult(
        parts=[by_key[k] for k in CQ_PARTS],
        feedback=limit_words(str(payload.get("feedback") or ""), MAX_FEEDBACK_WORDS),
        grader_uncertain=bool(payload.get("grader_uncertain", False)),
    )


def blank_answer_result() -> GradeResult:
    """Short-circuit for an empty script — no model call, no hallucinated marks."""
    return GradeResult(
        parts=[
            PartMark(part=key, max_marks=marks, awarded=0,  # type: ignore[arg-type]
                     reason="No answer detected for this part.",
                     improvement="এই অংশটির উত্তর খাতায় পাওয়া যায়নি।", evidence_lines=[])
            for key, (_, marks, _) in CQ_PARTS.items()
        ],
        feedback="খাতায় কোনো উত্তর পাওয়া যায়নি। ছবিটি স্পষ্ট কি না দেখে আবার পাঠাও।",
        grader_uncertain=False,
    )


# --------------------------------------------------------------------- OpenAI

class OpenAIGrader:
    """OpenAI-compatible chat completion. Points at OpenRouter instead by
    setting OPENROUTER_API_KEY — same wire format, different base URL, so a
    provider switch is configuration rather than code."""

    name = "openai"

    def __init__(self, model: str | None = None) -> None:
        self.model = model or settings.grader_model
        self._client: Any | None = None
        self._effort_unsupported = False

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            from openai import AsyncOpenAI
        except ImportError as exc:  # pragma: no cover
            raise AgentError("openai is not installed") from exc

        if settings.grader_provider == "openrouter":
            if not settings.openrouter_api_key:
                raise AgentError("OPENROUTER_API_KEY is not set")
            self._client = AsyncOpenAI(
                api_key=settings.openrouter_api_key,
                base_url="https://openrouter.ai/api/v1",
            )
        else:
            if not settings.openai_api_key:
                raise AgentError("OPENAI_API_KEY is not set")
            self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        return self._client

    async def grade(self, question_text: str, transcript: str) -> GradeResult:
        client = self._get_client()
        user_content = build_grading_input(question_text, transcript)
        messages = [
            {"role": "system", "content": CQ_GRADING_PROMPT},
            {"role": "user", "content": user_content},
        ]

        async def call() -> str:
            extra: dict[str, Any] = {}
            if settings.grader_reasoning_effort and not self._effort_unsupported:
                extra["reasoning_effort"] = settings.grader_reasoning_effort
            try:
                response = await client.chat.completions.create(
                    model=self.model, messages=messages,
                    response_format={"type": "json_object"}, **extra,
                )
            except Exception as exc:
                # A model that does not take a reasoning hint should still work.
                # Remember that, so the whole run does not pay for the retry.
                if extra and "reasoning_effort" in str(exc):
                    log.info("%s does not accept reasoning_effort; continuing without it",
                             self.model)
                    self._effort_unsupported = True
                    response = await client.chat.completions.create(
                        model=self.model, messages=messages,
                        response_format={"type": "json_object"},
                    )
                else:
                    raise
            content = response.choices[0].message.content
            if not content:
                raise AgentError("grader returned empty content")
            return content

        raw = await with_retry(call, what=f"grading ({self.model})")
        return _coerce(parse_json_object(raw, what="Grader"))


# --------------------------------------------------------------------- stub

class StubGrader:
    """Deterministic marks, derived from the transcript so tests can assert on
    behaviour (unclear lines lower the higher-order mark) without a model."""

    name = "stub"

    async def grade(self, question_text: str, transcript: str) -> GradeResult:
        unclear = transcript_has_unresolved(transcript)
        awards = {"ka": 1, "kha": 1, "ga": 3, "gha": 2 if not unclear else 1}
        return GradeResult(
            parts=[
                PartMark(
                    part=key,  # type: ignore[arg-type]
                    max_marks=marks,
                    awarded=awards[key],
                    reason=f"Stub grader: {CQ_PARTS[key][2]} assessed from the transcript.",
                    improvement=("" if awards[key] == marks
                                 else "স্টাব গাইডেন্স: যুক্তি ও একক স্পষ্ট করে লেখো।"),
                    evidence_lines=[i],
                )
                for i, (key, (_, marks, _)) in enumerate(CQ_PARTS.items())
            ],
            feedback="স্টাব গ্রেডার। প্রয়োগ অংশ ভালো হয়েছে, উচ্চতর দক্ষতায় যুক্তি আরও স্পষ্ট করো।",
            grader_uncertain=unclear,
        )


# --------------------------------------------------------------------- registry

_GRADERS: dict[str, type] = {
    "openai": OpenAIGrader,
    "openrouter": OpenAIGrader,
    "stub": StubGrader,
}


def get_grader(name: str | None = None) -> GraderProvider:
    key = (name or settings.grader_provider or "stub").lower()
    if key not in _GRADERS:
        raise AgentError(
            f"unknown GRADER_PROVIDER {key!r}; available: {', '.join(sorted(_GRADERS))}"
        )
    return _GRADERS[key]()  # type: ignore[return-value]
