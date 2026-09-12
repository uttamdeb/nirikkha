"""Batch membership and Telegram group helpers."""

from __future__ import annotations

import logging
from typing import Any

from .. import db
from . import client as tg

log = logging.getLogger("nirikkha.telegram.enroll")


async def upsert_telegram_group(chat_id: str, title: str) -> dict[str, Any]:
    existing = await db.select_one(
        "telegram_groups",
        params={"chat_id": f"eq.{chat_id}", "select": "*"},
    )
    if existing:
        rows = await db.update(
            "telegram_groups",
            params={"id": f"eq.{existing['id']}"},
            payload={"title": title},
        )
        return rows[0] if rows else existing
    rows = await db.insert(
        "telegram_groups",
        {"chat_id": chat_id, "title": title},
    )
    return rows[0]


async def next_student_number(batch_id: str) -> int:
    rows = await db.select(
        "batch_members",
        params={
            "batch_id": f"eq.{batch_id}",
            "student_number": "not.is.null",
            "select": "student_number",
            "order": "student_number.desc",
            "limit": 1,
        },
    )
    if not rows:
        return 1
    return int(rows[0]["student_number"]) + 1


async def ensure_batch_member(
    *,
    batch_id: str,
    telegram_user_id: str,
    display_name: str,
    is_group_admin: bool = False,
    user_id: str | None = None,
) -> dict[str, Any]:
    existing = await db.select_one(
        "batch_members",
        params={
            "batch_id": f"eq.{batch_id}",
            "telegram_user_id": f"eq.{telegram_user_id}",
            "select": "*",
        },
    )
    if existing:
        payload: dict[str, Any] = {"display_name": display_name}
        if is_group_admin:
            payload["is_group_admin"] = True
        if user_id and not existing.get("user_id"):
            payload["user_id"] = user_id
        if not is_group_admin and existing.get("student_number") is None:
            payload["student_number"] = await next_student_number(batch_id)
        rows = await db.update(
            "batch_members",
            params={"id": f"eq.{existing['id']}"},
            payload=payload,
        )
        return rows[0] if rows else existing

    student_number = None if is_group_admin else await next_student_number(batch_id)
    rows = await db.insert(
        "batch_members",
        {
            "batch_id": batch_id,
            "telegram_user_id": telegram_user_id,
            "display_name": display_name,
            "is_group_admin": is_group_admin,
            "student_number": student_number,
            "user_id": user_id,
        },
    )
    return rows[0]


async def backfill_student_numbers(batch_id: str) -> None:
    missing = await db.select(
        "batch_members",
        params={
            "batch_id": f"eq.{batch_id}",
            "is_group_admin": "eq.false",
            "student_number": "is.null",
            "select": "*",
            "order": "created_at.asc",
        },
    )
    for member in missing:
        number = await next_student_number(batch_id)
        await db.update(
            "batch_members",
            params={"id": f"eq.{member['id']}"},
            payload={"student_number": number},
        )


async def post_batch_enroll_message(batch_id: str) -> dict[str, Any]:
    batch = await db.select_one(
        "batches",
        params={"id": f"eq.{batch_id}", "select": "*"},
    )
    if not batch or not batch.get("telegram_group_id"):
        raise tg.TelegramError("Batch has no linked Telegram group")
    group = await db.select_one(
        "telegram_groups",
        params={"id": f"eq.{batch['telegram_group_id']}", "select": "*"},
    )
    if not group:
        raise tg.TelegramError("Telegram group not found")
    return await tg.send_message(
        group["chat_id"],
        f"👥 <b>{batch['name']}</b>\n"
        "Tap below to register as a student in this Nirikkha batch.\n"
        "(Also: any message you send in this group will auto-enroll you.)",
        reply_markup=tg.enroll_keyboard(batch_id),
    )


async def sync_batch_members(
    batch_id: str, *, post_enroll: bool = True
) -> list[dict[str, Any]]:
    batch = await db.select_one(
        "batches",
        params={"id": f"eq.{batch_id}", "select": "*"},
    )
    if not batch or not batch.get("telegram_group_id"):
        raise tg.TelegramError("Batch has no linked Telegram group")
    group = await db.select_one(
        "telegram_groups",
        params={"id": f"eq.{batch['telegram_group_id']}", "select": "*"},
    )
    if not group:
        raise tg.TelegramError("Telegram group not found")

    admins = await tg.get_chat_administrators(group["chat_id"])
    for admin in admins:
        user = admin.get("user") or {}
        if user.get("is_bot"):
            continue
        name = (
            " ".join(filter(None, [user.get("first_name"), user.get("last_name")]))
            or user.get("username")
            or str(user.get("id"))
        )
        await ensure_batch_member(
            batch_id=batch_id,
            telegram_user_id=str(user["id"]),
            display_name=name,
            is_group_admin=True,
        )

    await backfill_student_numbers(batch_id)
    if post_enroll:
        try:
            await post_batch_enroll_message(batch_id)
        except Exception as exc:
            log.warning("post enroll failed: %s", exc)

    return await db.select(
        "batch_members",
        params={
            "batch_id": f"eq.{batch_id}",
            "select": "*",
            "order": "student_number.asc.nullslast,display_name.asc",
        },
    )


async def provision_telegram_user(
    telegram_user_id: str, display_name: str
) -> str:
    """Create or find a Supabase Auth user for a Telegram identity.

    Returns the auth user id. Email is synthetic so student_id stays required.
    """
    from .. import db as database
    from ..config import settings

    email = f"tg_{telegram_user_id}@bot.local"
    # Look up an existing profile first.
    profile = await database.select_one(
        "profiles",
        params={"email": f"eq.{email}", "select": "id"},
    )
    if profile:
        return profile["id"]

    url = f"{settings.supabase_url}/auth/v1/admin/users"
    headers = {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "email": email,
        "email_confirm": True,
        "user_metadata": {
            "full_name": display_name,
            "telegram_user_id": telegram_user_id,
            "source": "telegram",
        },
    }
    response = await database.client().post(url, headers=headers, json=payload)
    if response.status_code >= 400:
        # Race: user may already exist.
        listed = await database.client().get(
            url,
            headers=headers,
            params={"page": 1, "per_page": 1, "email": email},
        )
        if listed.status_code == 200:
            users = listed.json().get("users") or []
            for user in users:
                if user.get("email") == email:
                    return user["id"]
        # Fallback: search profiles again after trigger.
        profile = await database.select_one(
            "profiles",
            params={"email": f"eq.{email}", "select": "id"},
        )
        if profile:
            return profile["id"]
        raise RuntimeError(f"provision user failed: {response.text[:300]}")

    user = response.json()
    user_id = user.get("id") or (user.get("user") or {}).get("id")
    if not user_id:
        raise RuntimeError("provision user returned no id")
    # Ensure profile name is set.
    await database.update(
        "profiles",
        params={"id": f"eq.{user_id}"},
        payload={"full_name": display_name, "email": email},
    )
    return user_id
