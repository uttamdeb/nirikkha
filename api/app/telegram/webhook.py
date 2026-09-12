"""Telegram webhook — group discovery, enroll, exam codes, photo intake."""

from __future__ import annotations

import contextlib
import logging
import uuid
from typing import Any

from .. import db, pipeline, settings_store
from ..agents.base import AgentError
from ..rubric import format_rubric_for_grader
from . import client as tg
from . import enroll, sessions

log = logging.getLogger("nirikkha.telegram.webhook")


def _display_name(from_user: dict[str, Any]) -> str:
    return (
        " ".join(
            filter(None, [from_user.get("first_name"), from_user.get("last_name")])
        )
        or from_user.get("username")
        or str(from_user.get("id"))
    )


async def handle_update(update: dict[str, Any]) -> None:
    member_update = update.get("my_chat_member")
    if member_update and member_update.get("chat"):
        chat = member_update["chat"]
        if chat.get("type") in ("group", "supergroup"):
            await enroll.upsert_telegram_group(
                str(chat["id"]), chat.get("title") or "Telegram group"
            )

    if update.get("callback_query"):
        await _handle_callback(update["callback_query"])
        return

    message = update.get("message")
    if not message or not message.get("from") or message["from"].get("is_bot"):
        return

    chat = message["chat"]
    from_user = message["from"]
    telegram_user_id = str(from_user["id"])
    name = _display_name(from_user)

    if chat.get("type") in ("group", "supergroup"):
        group = await enroll.upsert_telegram_group(
            str(chat["id"]), chat.get("title") or "Telegram group"
        )
        batches = await db.select(
            "batches",
            params={
                "telegram_group_id": f"eq.{group['id']}",
                "select": "id",
                "limit": 1,
            },
        )
        if batches:
            user_id = await enroll.provision_telegram_user(telegram_user_id, name)
            await enroll.ensure_batch_member(
                batch_id=batches[0]["id"],
                telegram_user_id=telegram_user_id,
                display_name=name,
                user_id=user_id,
            )

    text = (message.get("text") or "").strip()
    if text.startswith("/start"):
        await _handle_start(telegram_user_id, chat["id"], name)
        return

    # Clarification while awaiting_student
    if text and not message.get("photo"):
        pending = await _pending_clarification(telegram_user_id)
        if pending:
            await sessions.set_bot_session(
                telegram_user_id, state="clarifying", exam_id=pending.get("exam_id")
            )
            await tg.send_message(
                chat["id"], "ধন্যবাদ! Clarification নিয়ে আবার মূল্যায়ন করছি…"
            )
            try:
                lines = await db.select(
                    "ocr_lines",
                    params={
                        "submission_id": f"eq.{pending['id']}",
                        "select": "*",
                        "order": "line_index.asc",
                    },
                )
                from ..config import settings
                from ..pipeline import needs_clarification

                flagged = [
                    line
                    for line in lines
                    if needs_clarification(line, settings.legibility_threshold)
                ]
                if flagged:
                    await pipeline.clarify_line(
                        pending["id"], int(flagged[0]["line_index"]), text
                    )
                await _notify_result(pending["id"])
            except Exception as exc:
                log.exception("clarification failed")
                await db.update(
                    "submissions",
                    params={"id": f"eq.{pending['id']}"},
                    payload={
                        "status": "awaiting_teacher",
                        "needs_human_review": True,
                        "review_reason": "clarification_failed",
                        "error": str(exc)[:500],
                    },
                )
                with contextlib.suppress(Exception):
                    await tg.send_message(
                        chat["id"],
                        "Clarification প্রসেস ব্যর্থ। শিক্ষক পোর্টালে দেখবেন।",
                    )
            return

    photos = message.get("photo") or []
    document = message.get("document")
    photo = photos[-1] if photos else None
    if not photo and document and str(document.get("mime_type") or "").startswith("image/"):
        photo = {"file_id": document["file_id"], "width": 0, "height": 0}

    is_private = chat.get("type") == "private"

    if is_private and text and not photo:
        await _handle_private_text(telegram_user_id, chat["id"], text, name)
        return

    if photo:
        if is_private:
            await _handle_private_photo(
                telegram_user_id=telegram_user_id,
                chat_id=chat["id"],
                message_id=message["message_id"],
                photo=photo,
                name=name,
            )
        else:
            await _handle_group_photo(
                chat_id=chat["id"],
                message_id=message["message_id"],
                photo=photo,
                telegram_user_id=telegram_user_id,
                name=name,
            )


async def _pending_clarification(telegram_user_id: str) -> dict[str, Any] | None:
    members = await db.select(
        "batch_members",
        params={"telegram_user_id": f"eq.{telegram_user_id}", "select": "id"},
    )
    if not members:
        return None
    ids = ",".join(m["id"] for m in members)
    return await db.select_one(
        "submissions",
        params={
            "batch_member_id": f"in.({ids})",
            "status": "eq.awaiting_student",
            "select": "*",
            "order": "updated_at.desc",
            "limit": 1,
        },
    )


async def _answer_callback(query_id: str, text: str, show_alert: bool = False) -> None:
    with contextlib.suppress(Exception):
        await tg.answer_callback_query(query_id, text, show_alert=show_alert)


async def _handle_callback(query: dict[str, Any]) -> None:
    data = query.get("data") or ""
    from_user = query["from"]
    chat_id = (query.get("message") or {}).get("chat", {}).get("id") or from_user["id"]
    telegram_user_id = str(from_user["id"])
    name = _display_name(from_user)

    if data.startswith("exam_help:"):
        exam_id = data[len("exam_help:") :]
        exam = await db.select_one(
            "exams", params={"id": f"eq.{exam_id}", "select": "*"}
        )
        await _answer_callback(query["id"], "Open DM with the bot")
        code = (exam or {}).get("exam_code") or "NK-????"
        await tg.send_message(
            chat_id,
            f"📱 Open a <b>private chat</b> with this bot.\n"
            f"Send exam code <code>{code}</code>, then upload your handwritten photo.",
        )
        return

    if data.startswith("enroll:"):
        batch_id = data[len("enroll:") :]
        user_id = await enroll.provision_telegram_user(telegram_user_id, name)
        await enroll.ensure_batch_member(
            batch_id=batch_id,
            telegram_user_id=telegram_user_id,
            display_name=name,
            user_id=user_id,
        )
        await _answer_callback(query["id"], "Registered")
        await tg.send_message(chat_id, "✅ You are registered in this Nirikkha batch.")
        return

    if data == "exam_code_manual":
        await sessions.set_bot_session(
            telegram_user_id, state="await_exam_code", exam_id=None
        )
        await _answer_callback(query["id"], "Send exam code")
        await tg.send_message(
            chat_id, "Send your exam code (e.g. <code>NK-A7F2</code>)."
        )
        return

    if data.startswith("exam_select:"):
        exam_id = data[len("exam_select:") :]
        exam = await db.select_one(
            "exams", params={"id": f"eq.{exam_id}", "select": "*"}
        )
        if not exam or not exam.get("batch_id") or exam.get("status") != "published":
            await _answer_callback(query["id"], "Exam unavailable", True)
            await tg.send_message(chat_id, "Exam not available.")
            return
        user_id = await enroll.provision_telegram_user(telegram_user_id, name)
        await enroll.ensure_batch_member(
            batch_id=exam["batch_id"],
            telegram_user_id=telegram_user_id,
            display_name=name,
            user_id=user_id,
        )
        await sessions.set_bot_session(
            telegram_user_id, state="await_photo", exam_id=exam["id"]
        )
        await _answer_callback(query["id"], "Exam selected")
        await tg.send_message(
            chat_id,
            f"✅ Exam selected: <b>{exam['title']}</b> ({exam.get('exam_code')}).\n"
            "Now send a photo of your handwritten answer in this DM.",
        )


async def _handle_start(telegram_user_id: str, chat_id: int, name: str) -> None:
    memberships = await db.select(
        "batch_members",
        params={"telegram_user_id": f"eq.{telegram_user_id}", "select": "batch_id"},
    )
    exams: list[dict[str, Any]] = []
    for membership in memberships:
        found = await db.select(
            "exams",
            params={
                "batch_id": f"eq.{membership['batch_id']}",
                "status": "eq.published",
                "select": "id,exam_code,title,published_at",
                "order": "published_at.desc",
            },
        )
        exams.extend(found)

    await sessions.set_bot_session(
        telegram_user_id, state="await_exam_code", exam_id=None
    )
    if not exams:
        await tg.send_message(
            chat_id,
            f"👋 <b>Nirikkha</b> অনলাইন, {name}.\n"
            "আপনার কোনো published exam roster-এ নেই। Exam code পাঠান "
            "(যেমন <code>NK-A7F2</code>), অথবা class group-এ Register চাপুন।",
        )
        return

    await tg.send_message(
        chat_id,
        "👋 Select an active exam, or enter a code:",
        reply_markup=tg.exam_select_keyboard(exams),
    )


async def _handle_private_text(
    telegram_user_id: str, chat_id: int, text: str, name: str
) -> None:
    session = await sessions.get_bot_session(telegram_user_id)
    code = text.upper().replace(" ", "")

    if (
        session.get("state") in ("await_exam_code", "idle")
        or code.startswith("NK-")
    ):
        if not code.startswith("NK-"):
            await tg.send_message(
                chat_id,
                "Exam code format: <code>NK-XXXX</code>. Or tap /start to pick from a list.",
            )
            await sessions.set_bot_session(
                telegram_user_id, state="await_exam_code"
            )
            return

        exam = await db.select_one(
            "exams", params={"exam_code": f"eq.{code}", "select": "*"}
        )
        if not exam or exam.get("status") != "published" or not exam.get("batch_id"):
            await tg.send_message(chat_id, "Exam code not found or not published.")
            return

        user_id = await enroll.provision_telegram_user(telegram_user_id, name)
        await enroll.ensure_batch_member(
            batch_id=exam["batch_id"],
            telegram_user_id=telegram_user_id,
            display_name=name,
            user_id=user_id,
        )
        await sessions.set_bot_session(
            telegram_user_id, state="await_photo", exam_id=exam["id"]
        )
        await tg.send_message(
            chat_id,
            f"✅ Linked to <b>{exam['title']}</b>.\nNow send your handwritten answer photo.",
        )
        return

    if session.get("state") == "await_photo":
        await tg.send_message(
            chat_id, "Please send a <b>photo</b> of your answer script."
        )


async def _create_submission_from_photo(
    *,
    exam_id: str,
    batch_id: str,
    telegram_user_id: str,
    name: str,
    chat_id: int | str,
    message_id: int,
    photo: dict[str, Any],
) -> dict[str, Any]:
    user_id = await enroll.provision_telegram_user(telegram_user_id, name)
    member = await enroll.ensure_batch_member(
        batch_id=batch_id,
        telegram_user_id=telegram_user_id,
        display_name=name,
        user_id=user_id,
    )

    file_meta = await tg.get_file(photo["file_id"])
    file_path = file_meta.get("file_path") or ""
    data = await tg.download_file(file_path)
    mime = "image/jpeg"
    if file_path.lower().endswith(".png"):
        mime = "image/png"
    elif file_path.lower().endswith(".webp"):
        mime = "image/webp"

    exam = await db.select_one("exams", params={"id": f"eq.{exam_id}", "select": "*"})
    questions = await db.select(
        "questions",
        params={
            "exam_id": f"eq.{exam_id}",
            "approved": "eq.true",
            "select": "*",
            "order": "order.asc",
            "limit": 1,
        },
    )
    question = questions[0] if questions else {}
    prompt = question.get("prompt_text") or ""
    rubric = question.get("rubric_json")
    if isinstance(rubric, list):
        prompt = (prompt + "\n\n" + format_rubric_for_grader(rubric)).strip()

    existing = await db.select_one(
        "submissions",
        params={
            "exam_id": f"eq.{exam_id}",
            "batch_member_id": f"eq.{member['id']}",
            "select": "*",
        },
    )

    submission_id = existing["id"] if existing else str(uuid.uuid4())
    storage_path = f"{user_id}/{submission_id}/0.jpg"
    await db.upload(storage_path, data, mime)

    payload = {
        "student_id": user_id,
        "exam_id": exam_id,
        "batch_member_id": member["id"],
        "question_text": prompt,
        "subject": (exam or {}).get("title"),
        "image_path": storage_path,
        "image_paths": [storage_path],
        "status": "received",
        "telegram_chat_id": str(chat_id),
        "telegram_message_id": str(message_id),
        "error": None,
        "needs_human_review": False,
        "review_reason": None,
        "marks_stale": False,
    }

    if existing:
        # Clear old marks/lines for re-submit.
        await db.delete("marks", params={"submission_id": f"eq.{submission_id}"})
        await db.delete("ocr_lines", params={"submission_id": f"eq.{submission_id}"})
        rows = await db.update(
            "submissions",
            params={"id": f"eq.{submission_id}"},
            payload=payload,
        )
        return rows[0] if rows else {**payload, "id": submission_id}

    rows = await db.insert("submissions", {"id": submission_id, **payload})
    return rows[0]


async def _handle_private_photo(
    *,
    telegram_user_id: str,
    chat_id: int,
    message_id: int,
    photo: dict[str, Any],
    name: str,
) -> None:
    session = await sessions.get_bot_session(telegram_user_id)
    if session.get("state") != "await_photo" or not session.get("exam_id"):
        await tg.send_message(
            chat_id,
            "First send /start or your exam code (e.g. <code>NK-A7F2</code>), "
            "then upload the photo.",
        )
        await sessions.set_bot_session(
            telegram_user_id, state="await_exam_code"
        )
        return

    exam = await db.select_one(
        "exams", params={"id": f"eq.{session['exam_id']}", "select": "*"}
    )
    if not exam or not exam.get("batch_id") or exam.get("status") != "published":
        await tg.send_message(chat_id, "Selected exam is no longer available.")
        return

    submission = await _create_submission_from_photo(
        exam_id=exam["id"],
        batch_id=exam["batch_id"],
        telegram_user_id=telegram_user_id,
        name=name,
        chat_id=chat_id,
        message_id=message_id,
        photo=photo,
    )
    await tg.send_message(
        chat_id,
        f"📥 ছবি গৃহীত ({exam['title']} / {exam.get('exam_code')}). "
        "OCR ও গ্রেডিং শুরু হচ্ছে…",
    )
    try:
        await pipeline.run_ocr(submission["id"])
        await _notify_result(submission["id"])
    except Exception as exc:
        log.exception("processSubmission failed")
        await db.update(
            "submissions",
            params={"id": f"eq.{submission['id']}"},
            payload={
                "status": "awaiting_teacher",
                "needs_human_review": True,
                "review_reason": "processing_failed",
                "error": str(exc)[:500],
            },
        )
        await tg.send_message(
            chat_id,
            "⚠️ অটো গ্রেডিং ব্যর্থ। শিক্ষক পোর্টালে ম্যানুয়ালি স্কোর দেবেন।",
        )


async def _handle_group_photo(
    *,
    chat_id: int,
    message_id: int,
    photo: dict[str, Any],
    telegram_user_id: str,
    name: str,
) -> None:
    group = await db.select_one(
        "telegram_groups",
        params={"chat_id": f"eq.{chat_id!s}", "select": "*"},
    )
    if not group:
        await tg.send_message(
            chat_id,
            "Group not linked yet. Teacher should create a batch from this group.",
        )
        return

    batches = await db.select(
        "batches",
        params={"telegram_group_id": f"eq.{group['id']}", "select": "id"},
    )
    batch_ids = [b["id"] for b in batches]
    if not batch_ids:
        await tg.send_message(
            chat_id, "No batch linked to this group yet."
        )
        return

    exams: list[dict[str, Any]] = []
    for batch_id in batch_ids:
        found = await db.select(
            "exams",
            params={
                "batch_id": f"eq.{batch_id}",
                "status": "eq.published",
                "select": "*",
                "order": "published_at.desc",
            },
        )
        exams.extend(found)

    if not exams:
        await tg.send_message(
            chat_id, "No published exam for this group. Teacher must publish first."
        )
        return
    if len(exams) > 1:
        await tg.send_message(
            chat_id,
            f"Multiple exams are active. Please <b>DM the bot</b> with exam code "
            f"(e.g. <code>{exams[0].get('exam_code')}</code>) then send the photo privately.",
        )
        return

    exam = exams[0]
    if not exam.get("batch_id"):
        return

    submission = await _create_submission_from_photo(
        exam_id=exam["id"],
        batch_id=exam["batch_id"],
        telegram_user_id=telegram_user_id,
        name=name,
        chat_id=telegram_user_id,
        message_id=message_id,
        photo=photo,
    )
    await tg.send_message(
        chat_id,
        f"📥 ছবি গৃহীত ({exam['title']}). Prefer DM next time with code "
        f"<code>{exam.get('exam_code')}</code>. Processing…",
    )
    try:
        await pipeline.run_ocr(submission["id"])
        await _notify_result(submission["id"])
    except Exception as exc:
        log.exception("group photo processing failed")
        await db.update(
            "submissions",
            params={"id": f"eq.{submission['id']}"},
            payload={
                "status": "awaiting_teacher",
                "needs_human_review": True,
                "review_reason": "processing_failed",
                "error": str(exc)[:500],
            },
        )


async def _notify_result(submission_id: str) -> None:
    """DM the student after processing when status is terminal for them."""
    row = await db.select_one(
        "submissions", params={"id": f"eq.{submission_id}", "select": "*"}
    )
    if not row:
        return
    chat_id = row.get("telegram_chat_id")
    if not chat_id:
        return
    status = row.get("status")
    if status == "awaiting_student":
        await tg.send_message(
            chat_id,
            "কিছু লাইন পরিষ্কার পড়া যায়নি। অনুগ্রহ করে সেই লাইনগুলো টেক্সট হিসেবে পাঠাও।",
        )
        return
    if status == "released":
        total = row.get("total_awarded")
        max_marks = row.get("total_max") or 10
        feedback = (row.get("feedback") or "")[:500]
        await tg.send_message(
            chat_id,
            f"✅ ফলাফল: <b>{total}/{max_marks}</b>\n{feedback}",
        )
        return
    if status == "awaiting_teacher":
        await tg.send_message(
            chat_id,
            "মূল্যায়ন হয়েছে। শিক্ষক রিভিউ করে প্রকাশ করলে ফলাফল পাবে।",
        )
    if status == "failed":
        await tg.send_message(
            chat_id,
            f"স্ক্রিপ্ট প্রসেস করা যায়নি: {row.get('error') or 'unknown error'}",
        )


async def connect_webhook(token: str | None = None) -> dict[str, Any]:
    from ..config import settings

    if not settings.app_url:
        raise AgentError("APP_URL is not set")
    if token:
        await settings_store.update_org_settings(telegram_bot_token=token)

    org = await settings_store.get_org_settings()
    secret = org.get("webhook_secret") or str(uuid.uuid4())
    # Temporarily set token for getMe if just saved.
    me = await tg.get_me()
    username = me.get("username") or me.get("first_name") or "bot"
    webhook_url = f"{settings.app_url}/api/telegram/webhook"
    await tg.set_webhook(webhook_url, secret)
    await settings_store.update_org_settings(
        bot_username=username,
        bot_connected=True,
        webhook_secret=secret,
    )
    return {
        "username": username,
        "webhook_url": webhook_url,
        "bot_connected": True,
    }
