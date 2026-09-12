"""Shared agent machinery: JSON coercion, retries, provider registry.

Model output is text, not data. Everything here exists to turn the first into
the second without ever silently accepting something malformed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

log = logging.getLogger("nirikkha.agents")

T = TypeVar("T")

_FENCE = re.compile(r"^\s*```(?:json|JSON)?\s*|\s*```\s*$")


class AgentError(RuntimeError):
    """Raised when a model's output cannot be used. Never swallowed silently —
    it surfaces on the submission as `error` and the status becomes `failed`."""


def parse_json_object(raw: str, *, what: str = "model") -> dict[str, Any]:
    """Parse a JSON object out of model output.

    Models wrap JSON in ```json fences often enough that stripping them is not
    defensive programming, it is the normal path. If the response still will not
    parse, fall back to the outermost {...} span before giving up.
    """
    text = (raw or "").strip()
    if not text:
        raise AgentError(f"{what} returned an empty response")

    text = _FENCE.sub("", text).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise AgentError(f"{what} returned no JSON object") from None
        try:
            parsed = json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise AgentError(f"{what} returned invalid JSON: {exc}") from exc

    if not isinstance(parsed, dict):
        raise AgentError(f"{what} returned {type(parsed).__name__}, expected a JSON object")
    return parsed


def limit_words(text: str, max_words: int) -> str:
    words = " ".join((text or "").split()).split()
    return " ".join(words[:max_words]).strip()


def as_int(value: Any, *, field: str) -> int:
    """Strict int coercion.

    `isinstance(True, int)` is True in Python, so a bare int() would let a
    JSON `true` through as 1 and quietly award a mark. Reject it explicitly.
    """
    if isinstance(value, bool):
        raise AgentError(f"{field} must be a number, got boolean")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if abs(value - round(value)) > 1e-9:
            raise AgentError(f"{field} must be a whole number, got {value}")
        return round(value)
    if isinstance(value, str):
        try:
            return as_int(json.loads(value.strip()), field=field)
        except (json.JSONDecodeError, AgentError):
            raise AgentError(f"{field} must be a number, got {value!r}") from None
    raise AgentError(f"{field} must be a number, got {type(value).__name__}")


def as_unit_float(value: Any, *, field: str) -> float | None:
    """Coerce to 0..1, clamping rather than failing — a legibility score slightly
    out of range is a model quirk, not a reason to fail a whole submission."""
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        log.warning("dropping non-numeric %s: %r", field, value)
        return None
    if f != f:  # NaN
        return None
    return max(0.0, min(1.0, f))


async def with_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    attempts: int = 3,
    base_delay: float = 1.0,
    what: str = "call",
) -> T:
    """Retry with exponential backoff.

    Retries transport and malformed-output failures alike: a model that returned
    unparseable JSON once will often return valid JSON on the next attempt, and
    that is cheaper than failing the submission.
    """
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await fn()
        except Exception as exc:
            last = exc
            if attempt == attempts:
                break
            delay = base_delay * (2 ** (attempt - 1))
            log.warning(
                "%s failed (attempt %d/%d): %s — retrying in %.1fs",
                what, attempt, attempts, exc, delay,
            )
            await asyncio.sleep(delay)
    assert last is not None
    raise AgentError(f"{what} failed after {attempts} attempts: {last}") from last
