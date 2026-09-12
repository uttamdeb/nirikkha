"""OCR agent — reads a handwritten script into numbered lines.

Providers sit behind `OcrProvider`. Nothing downstream knows which engine ran;
it only reads `OcrResult`. Swapping engine is an env var, never a code change.

Why markers instead of scores
-----------------------------
A model asked for a calibrated confidence float per line tends to return the
same number for every line, which leaves the gate nothing to threshold on.
Asking it to write [[অস্পষ্ট]] where it cannot read pins the exact word instead,
and costs a fraction of the tokens. `legibility` is derived from marker density,
so the numeric interface still holds for engines that report real confidence.
"""

from __future__ import annotations

import logging
import re
from typing import Any, ClassVar, Protocol, runtime_checkable

from ..config import settings
from ..prompts import OCR_PROMPT, UNCLEAR_TOKEN
from ..schemas import BBox, OcrLine, OcrResult
from .base import AgentError, parse_json_object, with_retry

log = logging.getLogger("nirikkha.ocr")

# Tolerate whitespace drift inside the marker, which models introduce freely.
_TOKEN_RE = re.compile(r"\[\[\s*অস্পষ্ট\s*\]\]")
_LINE_RE = re.compile(r"\[\[\s*অস্পষ্ট\s*লাইন\s*\]\]")


#: One page of a script: its bytes and media type.
Page = tuple[bytes, str]


@runtime_checkable
class OcrProvider(Protocol):
    name: str
    supports_legibility: bool
    supports_bbox: bool

    async def read(self, pages: list[Page]) -> OcrResult: ...


# --------------------------------------------------------------------- parsing

def score_line(text: str) -> tuple[float, bool]:
    """Derive (legibility, is_guess) from the uncertainty markers in a line.

    A wholly unreadable line scores 0. Otherwise each unreadable word costs
    proportionally to how much of the line it represents, so one unclear word in
    a long sentence stays above threshold while two in a short one does not.
    """
    if _LINE_RE.search(text):
        return 0.0, True

    unclear = len(_TOKEN_RE.findall(text))
    if unclear == 0:
        return 1.0, False

    words = max(len(_TOKEN_RE.sub("x", text).split()), 1)
    penalty = min(1.0, (unclear / words) * 1.6)
    return round(max(0.0, 1.0 - penalty), 3), True


def parse_transcription(transcription: str) -> list[OcrLine]:
    """Split a transcribed page into numbered lines, scoring each."""
    lines: list[OcrLine] = []
    for raw in (transcription or "").replace("\r\n", "\n").split("\n"):
        text = raw.rstrip()
        if not text.strip():
            continue
        legibility, is_guess = score_line(text)
        lines.append(
            OcrLine(index=len(lines), text=text, legibility=legibility, is_guess=is_guess)
        )
    return lines


def _bbox_from(raw: Any) -> BBox | None:
    """Accept the two shapes models emit: edges as a dict, or Gemini's
    [ymin, xmin, ymax, xmax] scaled 0..1000. Anything else is dropped."""
    if raw is None:
        return None
    try:
        if isinstance(raw, dict):
            box = BBox(x0=float(raw["x0"]), y0=float(raw["y0"]),
                       x1=float(raw["x1"]), y1=float(raw["y1"]))
        elif isinstance(raw, (list, tuple)) and len(raw) == 4:
            ymin, xmin, ymax, xmax = (float(v) for v in raw)
            scale = 1000.0 if max(ymin, xmin, ymax, xmax) > 1.5 else 1.0
            box = BBox(x0=xmin / scale, y0=ymin / scale, x1=xmax / scale, y1=ymax / scale)
        else:
            return None
    except (KeyError, TypeError, ValueError) as exc:
        log.warning("unusable bbox %r (%s)", raw, exc)
        return None
    return None if box.is_degenerate() else box


# --------------------------------------------------------------------- Gemini

class GeminiOcrProvider:
    """Gemini via google-genai.

    Works against AI Studio (GEMINI_API_KEY) or Vertex AI (GOOGLE_CLOUD_PROJECT
    with application default credentials).
    """

    name = "gemini"
    supports_legibility = True
    supports_bbox = False  # boxes are a separate targeted call; see locate_lines()

    def __init__(self, model: str | None = None) -> None:
        self.model = model or settings.ocr_model
        self._client: Any | None = None

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            from google import genai
        except ImportError as exc:  # pragma: no cover
            raise AgentError("google-genai is not installed") from exc

        if settings.gemini_api_key:
            self._client = genai.Client(api_key=settings.gemini_api_key)
        elif settings.google_cloud_project:
            self._client = genai.Client(
                vertexai=True,
                project=settings.google_cloud_project,
                location=settings.google_cloud_location,
            )
        else:
            raise AgentError(
                "Gemini needs GEMINI_API_KEY, or GOOGLE_CLOUD_PROJECT with "
                "application default credentials"
            )
        return self._client

    async def read(self, pages: list[Page]) -> OcrResult:
        from google.genai import types as gt

        if not pages:
            raise UnreadableScript("কোনো ছবি পাওয়া যায়নি।", reason="blank")

        client = self._get_client()
        # All pages go in one request so the model numbers lines continuously
        # across them and can follow an answer that runs over a page break.
        parts = [gt.Part.from_bytes(data=data, mime_type=mime) for data, mime in pages]

        async def call() -> str:
            response = await client.aio.models.generate_content(
                model=self.model,
                contents=[*parts, OCR_PROMPT],
                config=gt.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                    # A dense handwritten page runs long; truncation here produced
                    # unparseable JSON in testing, so leave real headroom.
                    max_output_tokens=32768,
                    automatic_function_calling=gt.AutomaticFunctionCallingConfig(disable=True),
                ),
            )
            text = getattr(response, "text", None)
            if not text:
                reason = getattr(response, "prompt_feedback", None)
                raise AgentError(f"Gemini returned no text (feedback: {reason})")
            return text

        raw = await with_retry(call, what=f"gemini OCR ({self.model})")
        payload = parse_json_object(raw, what="Gemini OCR")

        answerable = str(payload.get("is_answerable", "Yes")).strip().lower()
        if answerable.startswith("n"):
            raise UnreadableScript(
                str(payload.get("fallback_response") or "").strip()
                or "ছবিটি পড়া যাচ্ছে না। স্পষ্ট করে সোজাভাবে তুলে আবার পাঠাও।",
                reason=str(payload.get("reason") or "unknown").strip().lower(),
            )

        lines = parse_transcription(str(payload.get("transcription") or ""))
        if not lines:
            raise UnreadableScript(
                "খাতায় কোনো লেখা পাওয়া যায়নি। পুরো পাতাটা ফ্রেমে রেখে আবার ছবি তোলো।",
                reason="blank",
            )

        return OcrResult(
            engine=f"gemini:{self.model}",
            lines=lines,
            supports_legibility=True,
            supports_bbox=any(line.bbox is not None for line in lines),
            detected_parts=[
                p for p in (payload.get("detected_parts") or [])
                if isinstance(p, str) and p in {"ka", "kha", "ga", "gha"}
            ],
        )


class UnreadableScript(AgentError):
    """The page cannot be marked.

    Carries a student-facing Bangla message and a machine-readable `reason`, so
    a student who photographed a printed question paper gets different guidance
    from one whose photo was simply out of focus. This is a product outcome, not
    a crash — refusing beats inventing a grade for handwriting nobody could read.
    """

    REASONS: ClassVar[frozenset[str]] = frozenset(
        {"not_a_script", "rotated", "too_blurry", "blank", "unknown"}
    )

    def __init__(self, message: str, reason: str = "unknown") -> None:
        super().__init__(message)
        self.reason = reason if reason in self.REASONS else "unknown"


# --------------------------------------------------------------------- stub

class StubOcrProvider:
    """Deterministic fake for tests and for running with no keys configured.

    Emits one line carrying an unclear marker so the clarification path is
    exercised without a model or a network.
    """

    name = "stub"
    supports_legibility = True
    supports_bbox = True

    async def read(self, pages: list[Page]) -> OcrResult:
        page = "\n".join([
            "ক) ত্বরণ হলো বেগের পরিবর্তনের হার।",
            "খ) বল প্রয়োগ করলে বস্তুর বেগ পরিবর্তিত হয়, তাই ত্বরণ সৃষ্টি হয়।",
            "গ) উদ্দীপকের বস্তুটির ভর ৫ কেজি এবং প্রযুক্ত বল ২০ N।",
            "a = F/m = 20/5 = 4 ms^-2",
            f"ঘ) ভর {UNCLEAR_TOKEN} হলে একই বলে {UNCLEAR_TOKEN} কমে যাবে।",
            "কারণ ত্বরণ ভরের ব্যস্তানুপাতিক।",
        ])
        lines = parse_transcription(page)
        for i, line in enumerate(lines):
            line.bbox = BBox(x0=0.08, y0=0.10 + i * 0.11, x1=0.92, y1=0.18 + i * 0.11)
        return OcrResult(
            engine="stub", lines=lines,
            supports_legibility=True, supports_bbox=True,
            detected_parts=["ka", "kha", "ga", "gha"],
        )


# --------------------------------------------------------------------- registry

_OCR_PROVIDERS: dict[str, type] = {
    "gemini": GeminiOcrProvider,
    "stub": StubOcrProvider,
}


def get_ocr_provider(name: str | None = None) -> OcrProvider:
    key = (name or settings.ocr_provider or "stub").lower()
    if key not in _OCR_PROVIDERS:
        raise AgentError(
            f"unknown OCR_PROVIDER {key!r}; available: {', '.join(sorted(_OCR_PROVIDERS))}"
        )
    return _OCR_PROVIDERS[key]()  # type: ignore[return-value]
