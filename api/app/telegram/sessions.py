"""Bot DM conversation state."""

from __future__ import annotations

from typing import Any

from .. import db


async def get_bot_session(telegram_user_id: str) -> dict[str, Any]:
    row = await db.select_one(
        "bot_sessions",
        params={"telegram_user_id": f"eq.{telegram_user_id}", "select": "*"},
    )
    if row:
        return row
    rows = await db.insert(
        "bot_sessions",
        {
            "telegram_user_id": telegram_user_id,
            "state": "idle",
            "exam_id": None,
            "payload": None,
        },
    )
    return rows[0]


async def set_bot_session(
    telegram_user_id: str,
    *,
    state: str,
    exam_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    existing = await db.select_one(
        "bot_sessions",
        params={"telegram_user_id": f"eq.{telegram_user_id}", "select": "id"},
    )
    data = {"state": state, "exam_id": exam_id, "payload": payload}
    if existing:
        rows = await db.update(
            "bot_sessions",
            params={"id": f"eq.{existing['id']}"},
            payload=data,
        )
        return rows[0] if rows else {**data, "telegram_user_id": telegram_user_id}
    rows = await db.insert(
        "bot_sessions",
        {"telegram_user_id": telegram_user_id, **data},
    )
    return rows[0]
