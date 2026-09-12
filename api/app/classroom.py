"""Teacher classroom routes: settings, batches, exams, Telegram connect."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import db, settings_store
from .agents.base import AgentError
from .auth import Caller, require_teacher
from .rubric import (
    generate_exam_code,
    is_valid_rubric,
    normalize_rubric,
    rubric_to_probable_answer,
    sum_rubric_marks,
)
from .telegram import client as tg
from .telegram import enroll
from .telegram.webhook import connect_webhook

log = logging.getLogger("nirikkha.classroom")

router = APIRouter(prefix="/api/teacher", tags=["classroom"])


# --------------------------------------------------------------------- schemas

class SettingsPatch(BaseModel):
    telegram_bot_token: str | None = None
    ocr_confidence_threshold: float | None = Field(default=None, ge=0, le=1)
    publish_mode: Literal["auto", "admin"] | None = None


class ConnectBody(BaseModel):
    token: str | None = None


class CreateBatch(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    telegram_group_id: str | None = None


class PatchMember(BaseModel):
    student_number: int | None = None
    display_name: str | None = Field(default=None, max_length=200)


class SyncMembersBody(BaseModel):
    post_enroll: bool = True


class CreateExam(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    publish_mode: Literal["auto", "admin"] | None = None


class RubricPartIn(BaseModel):
    key: Literal["ka", "kha", "ga", "gha"]
    label: str = Field(min_length=1, max_length=20)
    title: str = Field(min_length=1, max_length=80)
    prompt: str = Field(default="", max_length=8_000)
    modelAnswer: str = Field(default="", max_length=8_000)
    maxMarks: int = Field(gt=0, le=100)

    model_config = {"extra": "ignore"}


class CreateQuestion(BaseModel):
    prompt_text: str = Field(min_length=1, max_length=20_000)
    probable_answer: str | None = Field(default=None, max_length=20_000)
    total_marks: int = Field(default=10, ge=1, le=100)
    rubric_json: list[RubricPartIn] | None = None
    approved: bool = True
    order: int | None = Field(default=None, ge=0)


class UpdateExam(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    publish_mode: Literal["auto", "admin"] | None = None


class UpdateQuestion(BaseModel):
    prompt_text: str | None = Field(default=None, min_length=1, max_length=20_000)
    probable_answer: str | None = Field(default=None, max_length=20_000)
    total_marks: int | None = Field(default=None, ge=1, le=100)
    rubric_json: list[RubricPartIn] | None = None
    approved: bool | None = None
    order: int | None = Field(default=None, ge=0)


class PublishExam(BaseModel):
    batch_id: str
    publish_mode: Literal["auto", "admin"] | None = None


# --------------------------------------------------------------------- settings / telegram

@router.get("/settings")
async def get_settings(_caller: Caller = Depends(require_teacher)) -> dict[str, Any]:
    return await settings_store.get_public_settings()


@router.patch("/settings")
async def patch_settings(
    body: SettingsPatch, _caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    try:
        await settings_store.update_org_settings(
            telegram_bot_token=body.telegram_bot_token,
            ocr_confidence_threshold=body.ocr_confidence_threshold,
            publish_mode=body.publish_mode,
        )
        return await settings_store.get_public_settings()
    # DbError subclasses RuntimeError, so it has to be caught first or the
    # broader handler below swallows it and reports a failed database write as
    # the teacher's bad request.
    except db.DbError as exc:
        raise HTTPException(502, f"Could not save settings: {exc}") from exc
    except RuntimeError as exc:
        # Missing SETTINGS_ENCRYPTION_KEY (or similar) — surface to the UI.
        raise HTTPException(400, str(exc)) from exc


@router.post("/telegram/connect")
async def telegram_connect(
    body: ConnectBody, _caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    try:
        return await connect_webhook(body.token)
    except AgentError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"Connect failed: {exc}") from exc


@router.get("/telegram/groups")
@router.post("/telegram/groups")
async def list_telegram_groups(
    _caller: Caller = Depends(require_teacher),
) -> dict[str, Any]:
    groups = await db.select(
        "telegram_groups",
        params={"select": "*", "order": "synced_at.desc"},
    )
    return {"groups": groups}


# --------------------------------------------------------------------- batches

@router.get("/batches")
async def list_batches(_caller: Caller = Depends(require_teacher)) -> dict[str, Any]:
    batches = await db.select(
        "batches", params={"select": "*", "order": "created_at.desc"}
    )
    out: list[dict[str, Any]] = []
    for batch in batches:
        group = None
        if batch.get("telegram_group_id"):
            group = await db.select_one(
                "telegram_groups",
                params={"id": f"eq.{batch['telegram_group_id']}", "select": "*"},
            )
        members = await db.select(
            "batch_members",
            params={"batch_id": f"eq.{batch['id']}", "select": "id,is_group_admin"},
        )
        exams = await db.select(
            "exams",
            params={"batch_id": f"eq.{batch['id']}", "select": "id"},
        )
        students = sum(1 for m in members if not m.get("is_group_admin"))
        out.append({
            **batch,
            "telegram_group": group,
            "_count": {
                "members": len(members),
                "students": students,
                "exams": len(exams),
            },
        })
    return {"batches": out}


@router.post("/batches", status_code=201)
async def create_batch(
    body: CreateBatch, caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    rows = await db.insert(
        "batches",
        {
            "name": body.name.strip(),
            "telegram_group_id": body.telegram_group_id,
            "created_by": caller.id,
        },
    )
    batch = rows[0]
    if body.telegram_group_id:
        try:
            await enroll.sync_batch_members(batch["id"], post_enroll=True)
        except Exception as exc:
            log.warning("auto sync after create failed: %s", exc)
    return {"batch": batch}


@router.get("/batches/{batch_id}")
async def get_batch(
    batch_id: str, _caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    batch = await db.select_one(
        "batches", params={"id": f"eq.{batch_id}", "select": "*"}
    )
    if not batch:
        raise HTTPException(404, "Batch not found")
    group = None
    if batch.get("telegram_group_id"):
        group = await db.select_one(
            "telegram_groups",
            params={"id": f"eq.{batch['telegram_group_id']}", "select": "*"},
        )
    await enroll.backfill_student_numbers(batch_id)
    members = await db.select(
        "batch_members",
        params={
            "batch_id": f"eq.{batch_id}",
            "select": "*",
            "order": "student_number.asc.nullslast,display_name.asc",
        },
    )
    exams = await db.select(
        "exams",
        params={"batch_id": f"eq.{batch_id}", "select": "*", "order": "created_at.desc"},
    )
    return {
        "batch": {**batch, "telegram_group": group, "members": members, "exams": exams}
    }


@router.post("/batches/{batch_id}/sync-members")
async def sync_members(
    batch_id: str,
    body: SyncMembersBody,
    _caller: Caller = Depends(require_teacher),
) -> dict[str, Any]:
    try:
        members = await enroll.sync_batch_members(
            batch_id, post_enroll=body.post_enroll
        )
    except tg.TelegramError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"members": members}


@router.put("/batches/{batch_id}/sync-members")
async def post_enroll_only(
    batch_id: str, _caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    try:
        message = await enroll.post_batch_enroll_message(batch_id)
    except tg.TelegramError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "message_id": message.get("message_id")}


@router.patch("/batches/{batch_id}/members/{member_id}")
async def patch_member(
    batch_id: str,
    member_id: str,
    body: PatchMember,
    _caller: Caller = Depends(require_teacher),
) -> dict[str, Any]:
    member = await db.select_one(
        "batch_members",
        params={
            "id": f"eq.{member_id}",
            "batch_id": f"eq.{batch_id}",
            "select": "*",
        },
    )
    if not member:
        raise HTTPException(404, "Member not found")
    payload: dict[str, Any] = {}
    if body.student_number is not None:
        payload["student_number"] = body.student_number
    if body.display_name is not None:
        payload["display_name"] = body.display_name.strip()
    if not payload:
        return {"member": member}
    rows = await db.update(
        "batch_members", params={"id": f"eq.{member_id}"}, payload=payload
    )
    return {"member": rows[0] if rows else member}


@router.get("/batches/{batch_id}/stats")
async def batch_stats(
    batch_id: str, _caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    members = await db.select(
        "batch_members",
        params={"batch_id": f"eq.{batch_id}", "select": "id"},
    )
    if not members:
        return {"submissions": 0, "average": None, "histogram": {}}
    ids = ",".join(m["id"] for m in members)
    subs = await db.select(
        "submissions",
        params={
            "batch_member_id": f"in.({ids})",
            "select": "total_awarded,total_max,status,needs_human_review",
        },
    )
    scored = [s for s in subs if s.get("total_awarded") is not None]
    average = (
        sum(int(s["total_awarded"]) for s in scored) / len(scored) if scored else None
    )
    histogram: dict[str, int] = {}
    for s in scored:
        key = str(int(s["total_awarded"]))
        histogram[key] = histogram.get(key, 0) + 1
    return {
        "submissions": len(subs),
        "scored": len(scored),
        "average": average,
        "histogram": histogram,
        "flagged": sum(1 for s in subs if s.get("needs_human_review")),
    }


# --------------------------------------------------------------------- exams

@router.get("/exams")
async def list_exams(_caller: Caller = Depends(require_teacher)) -> dict[str, Any]:
    exams = await db.select(
        "exams", params={"select": "*", "order": "created_at.desc"}
    )
    enriched = []
    for exam in exams:
        questions = await db.select(
            "questions",
            params={"exam_id": f"eq.{exam['id']}", "select": "id,approved"},
        )
        batch = None
        if exam.get("batch_id"):
            batch = await db.select_one(
                "batches",
                params={"id": f"eq.{exam['batch_id']}", "select": "id,name"},
            )
        enriched.append({
            **exam,
            "batch": batch,
            "_count": {
                "questions": len(questions),
                "approved": sum(1 for q in questions if q.get("approved")),
            },
        })
    return {"exams": enriched}


@router.post("/exams", status_code=201)
async def create_exam(
    body: CreateExam, _caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    rows = await db.insert(
        "exams",
        {
            "title": body.title.strip(),
            "exam_code": generate_exam_code(),
            "status": "draft",
            "publish_mode": body.publish_mode,
        },
    )
    return {"exam": rows[0]}


@router.get("/exams/{exam_id}")
async def get_exam(
    exam_id: str, _caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    exam = await db.select_one(
        "exams", params={"id": f"eq.{exam_id}", "select": "*"}
    )
    if not exam:
        raise HTTPException(404, "Exam not found")
    questions = await db.select(
        "questions",
        params={
            "exam_id": f"eq.{exam_id}",
            "select": "*",
            "order": "order.asc,created_at.asc",
        },
    )
    batch = None
    if exam.get("batch_id"):
        batch = await db.select_one(
            "batches", params={"id": f"eq.{exam['batch_id']}", "select": "*"}
        )
        if batch and batch.get("telegram_group_id"):
            group = await db.select_one(
                "telegram_groups",
                params={"id": f"eq.{batch['telegram_group_id']}", "select": "*"},
            )
            batch = {**batch, "telegram_group": group}
    return {"exam": {**exam, "questions": questions, "batch": batch}}


@router.post("/exams/{exam_id}/questions", status_code=201)
async def add_question(
    exam_id: str,
    body: CreateQuestion,
    _caller: Caller = Depends(require_teacher),
) -> dict[str, Any]:
    exam = await db.select_one(
        "exams", params={"id": f"eq.{exam_id}", "select": "id,status"}
    )
    if not exam:
        raise HTTPException(404, "Exam not found")
    if exam.get("status") == "closed":
        raise HTTPException(400, "Cannot add questions to a closed exam")

    rubric = normalize_rubric(
        [p.model_dump() for p in body.rubric_json] if body.rubric_json else None
    )
    if not is_valid_rubric(rubric, body.total_marks):
        raise HTTPException(
            400,
            f"Rubric part marks must sum to total_marks "
            f"({sum_rubric_marks(rubric)} != {body.total_marks})",
        )

    existing = await db.select(
        "questions",
        params={"exam_id": f"eq.{exam_id}", "select": "id"},
    )
    order = body.order if body.order is not None else len(existing)
    probable = body.probable_answer or rubric_to_probable_answer(rubric)
    rows = await db.insert(
        "questions",
        {
            "exam_id": exam_id,
            "type": "cq",
            "prompt_text": body.prompt_text.strip(),
            "probable_answer": probable,
            "rubric_json": rubric,
            "total_marks": body.total_marks,
            "source": "manual",
            "order": order,
            "approved": body.approved,
        },
    )
    return {"question": rows[0]}


@router.patch("/exams/{exam_id}")
async def update_exam(
    exam_id: str,
    body: UpdateExam,
    _caller: Caller = Depends(require_teacher),
) -> dict[str, Any]:
    exam = await db.select_one(
        "exams", params={"id": f"eq.{exam_id}", "select": "*"}
    )
    if not exam:
        raise HTTPException(404, "Exam not found")
    payload: dict[str, Any] = {}
    if body.title is not None:
        payload["title"] = body.title.strip()
    if "publish_mode" in body.model_fields_set:
        payload["publish_mode"] = body.publish_mode
    if not payload:
        return {"exam": exam}
    rows = await db.update(
        "exams", params={"id": f"eq.{exam_id}"}, payload=payload
    )
    return {"exam": rows[0] if rows else exam}


@router.patch("/exams/{exam_id}/questions/{question_id}")
async def update_question(
    exam_id: str,
    question_id: str,
    body: UpdateQuestion,
    _caller: Caller = Depends(require_teacher),
) -> dict[str, Any]:
    question = await db.select_one(
        "questions",
        params={
            "id": f"eq.{question_id}",
            "exam_id": f"eq.{exam_id}",
            "select": "*",
        },
    )
    if not question:
        raise HTTPException(404, "Question not found")

    payload: dict[str, Any] = {}
    if body.prompt_text is not None:
        payload["prompt_text"] = body.prompt_text.strip()
    if body.probable_answer is not None:
        payload["probable_answer"] = body.probable_answer
    if body.approved is not None:
        payload["approved"] = body.approved
    if body.order is not None:
        payload["order"] = body.order

    total_marks = body.total_marks if body.total_marks is not None else int(
        question.get("total_marks") or 10
    )
    if body.rubric_json is not None:
        rubric = normalize_rubric([p.model_dump() for p in body.rubric_json])
        if not is_valid_rubric(rubric, total_marks):
            raise HTTPException(
                400,
                f"Rubric part marks must sum to total_marks "
                f"({sum_rubric_marks(rubric)} != {total_marks})",
            )
        payload["rubric_json"] = rubric
        payload["total_marks"] = total_marks
        if body.probable_answer is None:
            payload["probable_answer"] = rubric_to_probable_answer(rubric)
    elif body.total_marks is not None:
        existing_rubric = question.get("rubric_json")
        if isinstance(existing_rubric, list) and not is_valid_rubric(
            normalize_rubric(existing_rubric), total_marks
        ):
            raise HTTPException(
                400,
                "total_marks does not match existing rubric part marks; send rubric_json too",
            )
        payload["total_marks"] = total_marks

    if not payload:
        return {"question": question}
    rows = await db.update(
        "questions",
        params={"id": f"eq.{question_id}", "exam_id": f"eq.{exam_id}"},
        payload=payload,
    )
    return {"question": rows[0] if rows else question}


@router.post("/exams/{exam_id}/questions/{question_id}/approve")
async def approve_question(
    exam_id: str,
    question_id: str,
    _caller: Caller = Depends(require_teacher),
) -> dict[str, Any]:
    rows = await db.update(
        "questions",
        params={"id": f"eq.{question_id}", "exam_id": f"eq.{exam_id}"},
        payload={"approved": True},
    )
    if not rows:
        raise HTTPException(404, "Question not found")
    return {"question": rows[0]}


@router.post("/exams/{exam_id}/generate")
async def generate_exam_questions(
    exam_id: str,
    source_text: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    _caller: Caller = Depends(require_teacher),
) -> dict[str, Any]:
    from .generate import generate_questions

    exam = await db.select_one(
        "exams", params={"id": f"eq.{exam_id}", "select": "id"}
    )
    if not exam:
        raise HTTPException(404, "Exam not found")

    image: tuple[bytes, str] | None = None
    if file is not None:
        data = await file.read()
        mime = file.content_type or "application/octet-stream"
        path = f"exam-assets/{exam_id}/{uuid.uuid4().hex}_{file.filename or 'asset'}"
        await db.upload(path, data, mime)
        await db.insert(
            "exam_assets",
            {
                "exam_id": exam_id,
                "storage_path": path,
                "mime_type": mime,
                "original_name": file.filename or "asset",
            },
        )
        if mime.startswith("image/"):
            image = (data, mime)

    try:
        result = await generate_questions(
            source_text=source_text, image=image, count=1
        )
    except AgentError as exc:
        raise HTTPException(400, str(exc)) from exc

    created = []
    existing = await db.select(
        "questions",
        params={"exam_id": f"eq.{exam_id}", "select": "id"},
    )
    base_order = len(existing)
    for index, q in enumerate(result["questions"]):
        rubric = normalize_rubric(q.get("rubric"))
        total_marks = int(q.get("totalMarks") or sum_rubric_marks(rubric) or 10)
        if not is_valid_rubric(rubric, total_marks):
            # Fall back to normalised defaults that always sum correctly.
            from .rubric import DEFAULT_CQ_RUBRIC
            rubric = normalize_rubric(DEFAULT_CQ_RUBRIC)
            total_marks = sum_rubric_marks(rubric)
        rows = await db.insert(
            "questions",
            {
                "exam_id": exam_id,
                "type": "cq",
                "prompt_text": (q.get("promptText") or "").strip() or "Generated CQ",
                "probable_answer": q.get("probableAnswer")
                or rubric_to_probable_answer(rubric),
                "rubric_json": rubric,
                "total_marks": total_marks,
                "source": "generated",
                "order": base_order + index,
                "approved": False,
            },
        )
        created.append(rows[0])
    return {"questions": created, "model_name": result["modelName"]}


@router.post("/exams/{exam_id}/publish")
async def publish_exam(
    exam_id: str,
    body: PublishExam,
    _caller: Caller = Depends(require_teacher),
) -> dict[str, Any]:
    exam = await db.select_one(
        "exams", params={"id": f"eq.{exam_id}", "select": "*"}
    )
    if not exam:
        raise HTTPException(404, "Exam not found")
    questions = await db.select(
        "questions",
        params={
            "exam_id": f"eq.{exam_id}",
            "approved": "eq.true",
            "select": "*",
            "order": "order.asc",
        },
    )
    if not questions:
        raise HTTPException(400, "Approve/add at least one question before publishing")

    batch = await db.select_one(
        "batches", params={"id": f"eq.{body.batch_id}", "select": "*"}
    )
    if not batch:
        raise HTTPException(404, "Batch not found")

    exam_code = exam.get("exam_code") or generate_exam_code()
    payload = {
        "batch_id": batch["id"],
        "status": "published",
        "published_at": datetime.now(UTC).isoformat(),
        "publish_mode": body.publish_mode or exam.get("publish_mode"),
        "exam_code": exam_code,
    }
    rows = await db.update(
        "exams", params={"id": f"eq.{exam_id}"}, payload=payload
    )
    updated = rows[0] if rows else {**exam, **payload}

    if batch.get("telegram_group_id"):
        group = await db.select_one(
            "telegram_groups",
            params={"id": f"eq.{batch['telegram_group_id']}", "select": "*"},
        )
        if group:
            question = questions[0]
            marks = sum(int(q.get("total_marks") or 0) for q in questions)
            rubric = question.get("rubric_json") or []
            if isinstance(rubric, list) and rubric:
                rubric_lines = "\n".join(
                    f"{p.get('label')} ({p.get('maxMarks')}): {p.get('prompt') or ''}"
                    for p in rubric
                )
            else:
                rubric_lines = question.get("prompt_text") or ""
            try:
                message = await tg.send_message(
                    group["chat_id"],
                    f"📢 <b>Exam published: {updated['title']}</b>\n"
                    f"Exam code: <code>{exam_code}</code>\n"
                    f"Total marks: {marks}\n\n{rubric_lines}\n\n"
                    "📱 Open a <b>DM with the bot</b>, send this exam code, "
                    "then upload your handwritten photo.",
                    reply_markup=tg.exam_publish_keyboard(exam_id),
                )
                await db.update(
                    "exams",
                    params={"id": f"eq.{exam_id}"},
                    payload={"telegram_message_id": str(message.get("message_id"))},
                )
                updated["telegram_message_id"] = str(message.get("message_id"))
            except Exception as exc:
                log.warning("telegram announce failed: %s", exc)

    batch_full = batch
    if batch.get("telegram_group_id"):
        group = await db.select_one(
            "telegram_groups",
            params={"id": f"eq.{batch['telegram_group_id']}", "select": "*"},
        )
        batch_full = {**batch, "telegram_group": group}
    return {
        "exam": {
            **updated,
            "questions": questions,
            "batch": batch_full,
        }
    }


@router.post("/exams/{exam_id}/close")
async def close_exam(
    exam_id: str, _caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    rows = await db.update(
        "exams",
        params={"id": f"eq.{exam_id}"},
        payload={"status": "closed"},
    )
    if not rows:
        raise HTTPException(404, "Exam not found")
    return {"exam": rows[0]}
