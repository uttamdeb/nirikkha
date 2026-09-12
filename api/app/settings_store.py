"""Org-level settings stored in Postgres (Telegram token, publish mode, OCR gate)."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from . import db
from .crypto import decrypt_secret, encrypt_secret, mask_secret

PublishMode = Literal["auto", "admin"]


async def get_org_settings() -> dict[str, Any]:
    row = await db.select_one(
        "org_settings",
        params={"select": "*", "order": "created_at.asc", "limit": 1},
    )
    if row:
        return row
    rows = await db.insert(
        "org_settings",
        {
            "webhook_secret": str(uuid.uuid4()),
            "ocr_confidence_threshold": 0.65,
            "publish_mode": "admin",
            "bot_connected": False,
        },
    )
    return rows[0]


async def get_telegram_token() -> str | None:
    settings = await get_org_settings()
    enc = settings.get("telegram_bot_token_enc")
    if not enc:
        return None
    return decrypt_secret(enc)


def _mask_enc(enc: str | None) -> str | None:
    if not enc:
        return None
    try:
        return mask_secret(decrypt_secret(enc))
    except Exception:
        return "••••••••"


async def get_public_settings() -> dict[str, Any]:
    from .config import settings as app_settings

    s = await get_org_settings()
    # Surface which env-backed engines are active — keys stay on the server.
    ocr = (app_settings.ocr_provider or "stub").lower()
    grader = (app_settings.grader_provider or "stub").lower()
    has_ai = ocr != "stub" or grader != "stub"
    return {
        "id": s["id"],
        "ocr_confidence_threshold": s.get("ocr_confidence_threshold", 0.65),
        "publish_mode": s.get("publish_mode") or "admin",
        "bot_username": s.get("bot_username"),
        "bot_connected": bool(s.get("bot_connected")),
        "has_telegram_token": bool(s.get("telegram_bot_token_enc")),
        "telegram_bot_token_masked": _mask_enc(s.get("telegram_bot_token_enc")),
        "webhook_secret": s.get("webhook_secret"),
        "updated_at": s.get("updated_at"),
        "ai_from_env": True,
        "ai_enabled": has_ai,
        "ocr_provider": ocr,
        "ocr_model": app_settings.ocr_model,
        "grader_provider": grader,
        "grader_model": app_settings.grader_model,
        "has_gemini_key": bool(app_settings.gemini_api_key),
        "has_openai_key": bool(app_settings.openai_api_key),
    }


async def update_org_settings(
    *,
    telegram_bot_token: str | None = None,
    ocr_confidence_threshold: float | None = None,
    publish_mode: PublishMode | None = None,
    bot_username: str | None = None,
    bot_connected: bool | None = None,
    webhook_secret: str | None = None,
) -> dict[str, Any]:
    current = await get_org_settings()
    payload: dict[str, Any] = {}
    if telegram_bot_token is not None:
        trimmed = telegram_bot_token.strip()
        payload["telegram_bot_token_enc"] = encrypt_secret(trimmed) if trimmed else None
    if ocr_confidence_threshold is not None:
        payload["ocr_confidence_threshold"] = ocr_confidence_threshold
    if publish_mode is not None:
        payload["publish_mode"] = publish_mode
    if bot_username is not None:
        payload["bot_username"] = bot_username
    if bot_connected is not None:
        payload["bot_connected"] = bot_connected
    if webhook_secret is not None:
        payload["webhook_secret"] = webhook_secret
    if not payload:
        return current
    rows = await db.update(
        "org_settings",
        params={"id": f"eq.{current['id']}"},
        payload=payload,
    )
    return rows[0] if rows else current
