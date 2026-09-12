"""Thin Telegram Bot API client over httpx."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .. import settings_store

log = logging.getLogger("nirikkha.telegram")

_TIMEOUT = httpx.Timeout(60.0, connect=15.0)


class TelegramError(RuntimeError):
    pass


async def _token() -> str:
    token = await settings_store.get_telegram_token()
    if not token:
        raise TelegramError("Telegram bot token is not configured")
    return token


async def api(method: str, payload: dict[str, Any] | None = None) -> Any:
    token = await _token()
    url = f"https://api.telegram.org/bot{token}/{method}"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.post(url, json=payload or {})
    body = response.json()
    if not body.get("ok"):
        raise TelegramError(f"{method} failed: {body.get('description') or response.text[:200]}")
    return body.get("result")


async def get_me() -> dict[str, Any]:
    return await api("getMe")


async def set_webhook(url: str, secret_token: str) -> Any:
    return await api(
        "setWebhook",
        {
            "url": url,
            "secret_token": secret_token,
            "drop_pending_updates": True,
            "allowed_updates": [
                "message",
                "callback_query",
                "my_chat_member",
            ],
        },
    )


async def send_message(
    chat_id: str | int,
    text: str,
    *,
    reply_markup: dict[str, Any] | None = None,
    parse_mode: str = "HTML",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return await api("sendMessage", payload)


async def answer_callback_query(
    query_id: str, text: str = "", *, show_alert: bool = False
) -> Any:
    return await api(
        "answerCallbackQuery",
        {"callback_query_id": query_id, "text": text, "show_alert": show_alert},
    )


async def get_chat_administrators(chat_id: str | int) -> list[dict[str, Any]]:
    result = await api("getChatAdministrators", {"chat_id": chat_id})
    return result if isinstance(result, list) else []


async def get_file(file_id: str) -> dict[str, Any]:
    return await api("getFile", {"file_id": file_id})


async def download_file(file_path: str) -> bytes:
    token = await _token()
    url = f"https://api.telegram.org/file/bot{token}/{file_path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.get(url)
    if response.status_code >= 400:
        raise TelegramError(f"download failed: {response.status_code}")
    return response.content


def inline_keyboard(rows: list[list[dict[str, str]]]) -> dict[str, Any]:
    return {"inline_keyboard": rows}


def exam_publish_keyboard(exam_id: str) -> dict[str, Any]:
    return inline_keyboard([[{"text": "How to submit", "callback_data": f"exam_help:{exam_id}"}]])


def enroll_keyboard(batch_id: str) -> dict[str, Any]:
    return inline_keyboard(
        [[{"text": "Register for this class", "callback_data": f"enroll:{batch_id}"}]]
    )


def exam_select_keyboard(
    exams: list[dict[str, Any]],
) -> dict[str, Any]:
    rows: list[list[dict[str, str]]] = []
    for exam in exams:
        code = exam.get("exam_code") or str(exam.get("id", ""))[:8]
        title = exam.get("title") or ""
        label = f"{code} — {title}"[:60]
        rows.append([{"text": label, "callback_data": f"exam_select:{exam['id']}"}])
    rows.append([{"text": "Enter exam code manually", "callback_data": "exam_code_manual"}])
    return inline_keyboard(rows)
