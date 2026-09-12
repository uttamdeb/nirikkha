"""Configuration. Every knob is an environment variable; nothing is hardcoded."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _env(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


def _env_float(key: str, default: float) -> float:
    raw = _env(key)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # Supabase
    supabase_url: str = field(default_factory=lambda: _env("SUPABASE_URL").rstrip("/"))
    supabase_secret_key: str = field(default_factory=lambda: _env("SUPABASE_SECRET_KEY"))
    supabase_publishable_key: str = field(default_factory=lambda: _env("SUPABASE_PUBLISHABLE_KEY"))

    # OCR
    ocr_provider: str = field(default_factory=lambda: _env("OCR_PROVIDER", "stub").lower())
    ocr_model: str = field(default_factory=lambda: _env("OCR_MODEL", "gemini-3.7-flash"))
    gemini_api_key: str = field(default_factory=lambda: _env("GEMINI_API_KEY"))
    google_cloud_project: str = field(default_factory=lambda: _env("GOOGLE_CLOUD_PROJECT"))
    google_cloud_location: str = field(default_factory=lambda: _env("GOOGLE_CLOUD_LOCATION", "us-central1"))

    # Grading
    grader_provider: str = field(default_factory=lambda: _env("GRADER_PROVIDER", "stub").lower())
    grader_model: str = field(default_factory=lambda: _env("GRADER_MODEL", "gpt-5.6-luna"))
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_API_KEY"))
    # Reasoning models mark more carefully at higher effort. Measured on a script
    # with correct method but wrong arithmetic, high effort caught the slip in 3
    # runs of 4 where the default caught it in 1. Set to "" to send no effort hint.
    grader_reasoning_effort: str = field(
        default_factory=lambda: _env("GRADER_REASONING_EFFORT", "high").lower()
    )
    openrouter_api_key: str = field(default_factory=lambda: _env("OPENROUTER_API_KEY"))

    # Gate
    legibility_threshold: float = field(default_factory=lambda: _env_float("LEGIBILITY_THRESHOLD", 0.65))

    # HTTP
    cors_origins: str = field(default_factory=lambda: _env("CORS_ORIGINS", "*"))
    port: int = field(default_factory=lambda: int(_env("PORT", "8080")))

    @property
    def storage_bucket(self) -> str:
        return "scripts"

    def allowed_origins(self) -> list[str]:
        raw = self.cors_origins.strip()
        if raw in ("", "*"):
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]


@lru_cache(maxsize=1)
def _load() -> Settings:
    return Settings()


class _Proxy:
    """Re-reads settings lazily so tests can monkeypatch the environment."""

    def __getattr__(self, item: str):
        return getattr(_load(), item)

    @staticmethod
    def reload() -> None:
        _load.cache_clear()


settings = _Proxy()
