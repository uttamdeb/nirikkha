"""HTTP surface.

The service key bypasses RLS, so authorisation is enforced here explicitly:
every route resolves the caller from their Supabase JWT and checks ownership or
the teacher role before touching a row.
"""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import os
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db, pipeline
from .agents.base import AgentError
from .agents.ocr import get_ocr_provider
from .config import settings
from .mcp import router as mcp_router
from .schemas import (
    CQ_PARTS,
    CQ_TOTAL,
    Annotation,
    BulkRelease,
    ClarifyLine,
    CreateSubmission,
    EditFeedback,
    EditLine,
    LineView,
    MarkView,
    OverrideMark,
    PanelPage,
    StudentBrief,
    SubmissionRow,
    SubmissionStatus,
    SubmissionView,
    TeacherFeedback,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
log = logging.getLogger("nirikkha")

@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    yield
    await db.aclose()


app = FastAPI(title="Nirikkha API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(mcp_router)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PAGES = 3
# Cloud Run caps an HTTP/1 request body at 32 MiB, so three 20 MB pages would be
# rejected by the platform before this code ever ran. Fail here instead, where
# the message can say which limit was hit.
MAX_TOTAL_UPLOAD_BYTES = 28 * 1024 * 1024
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"}

# Resolving a caller costs two round trips to Supabase — the token check and the
# profile read. With the service in one region and Supabase in another those
# dominate request time, and a client polling a submission repeats them every few
# seconds for the same token. Hold the result briefly.
#
# The cost of caching is that a signed-out or role-changed session stays live for
# up to AUTH_TTL. Thirty seconds is short enough not to matter here and is the
# difference between a page that feels instant and one that does not.
AUTH_TTL = 30.0
AUTH_CACHE_MAX = 512
_auth_cache: dict[str, tuple[float, Caller]] = {}


def _cache_get(token: str) -> Caller | None:
    hit = _auth_cache.get(token)
    if hit is None:
        return None
    expires, caller = hit
    if expires < time.monotonic():
        _auth_cache.pop(token, None)
        return None
    return caller


def _cache_put(token: str, caller: Caller) -> None:
    if len(_auth_cache) >= AUTH_CACHE_MAX:
        now = time.monotonic()
        for key in [k for k, (exp, _) in _auth_cache.items() if exp < now]:
            _auth_cache.pop(key, None)
        if len(_auth_cache) >= AUTH_CACHE_MAX:
            _auth_cache.clear()
    _auth_cache[token] = (time.monotonic() + AUTH_TTL, caller)


# --------------------------------------------------------------------- auth

class Caller:
    def __init__(self, user_id: str, email: str | None, role: str) -> None:
        self.id = user_id
        self.email = email
        self.role = role

    @property
    def is_teacher(self) -> bool:
        return self.role == "teacher"


async def current_user(authorization: str | None = Header(default=None)) -> Caller:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()

    cached = _cache_get(token)
    if cached is not None:
        return cached

    # Validate against Supabase rather than verifying the signature locally:
    # one network call, but it honours revocation and needs no shared secret.
    try:
        response = await db.client().get(
            f"{settings.supabase_url}/auth/v1/user",
            headers={"apikey": settings.supabase_publishable_key or settings.supabase_secret_key,
                     "Authorization": f"Bearer {token}"},
        )
    except httpx.HTTPError as exc:
        raise HTTPException(503, f"Auth check failed: {exc}") from exc

    if response.status_code != 200:
        raise HTTPException(401, "Invalid or expired session")

    user = response.json()
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(401, "Invalid session")

    profile = await db.select_one("profiles", params={"id": f"eq.{user_id}", "select": "role,email"})
    caller = Caller(user_id, user.get("email"), (profile or {}).get("role") or "student")
    _cache_put(token, caller)
    return caller


async def require_teacher(caller: Caller = Depends(current_user)) -> Caller:
    if not caller.is_teacher:
        raise HTTPException(403, "This action is for teachers")
    return caller


async def load_submission(submission_id: str, caller: Caller) -> dict[str, Any]:
    row = await db.select_one("submissions", params={"id": f"eq.{submission_id}", "select": "*"})
    if not row:
        raise HTTPException(404, "Submission not found")
    if row["student_id"] != caller.id and not caller.is_teacher:
        raise HTTPException(403, "Not your submission")
    return row


# --------------------------------------------------------------------- views

async def _none() -> None:
    """Placeholder so gather() keeps a fixed shape when no image is wanted."""
    return None

async def build_view(
    row: dict[str, Any], *, with_image_url: bool = True, with_student: bool = False
) -> SubmissionView:
    submission_id = row["id"]

    paths: list[str] = row.get("image_paths") or (
        [row["image_path"]] if row.get("image_path") else []
    )
    want_url = bool(with_image_url and paths)

    annotations_raw = await db.select("annotations", params={
        "submission_id": f"eq.{submission_id}", "select": "*",
        "order": "page.asc,created_at.asc",
    })
    marks_raw = await db.select(
        "marks", params={"submission_id": f"eq.{submission_id}", "select": "*"}
    )

    # Everyone named on this page — the student and any teacher who rewrote
    # something — resolved in one query rather than one per name.
    wanted = {row["student_id"]}
    for key in ("feedback_edited_by", "reviewed_by"):
        if row.get(key):
            wanted.add(row[key])
    wanted.update(m["edited_by"] for m in marks_raw if m.get("edited_by"))
    people: dict[str, StudentBrief] = {}
    if wanted:
        ids = ",".join(sorted(wanted))
        people = {
            p["id"]: StudentBrief(**p)
            for p in await db.select("profiles", params={
                "id": f"in.({ids})", "select": "id,email,full_name",
            })
        }
    student = people.get(row["student_id"]) if with_student else None

    annotations = [Annotation(**a) for a in annotations_raw]

    # Independent of one another, so pay for one round trip rather than several.
    lines, *signed = await asyncio.gather(
        db.select("ocr_lines", params={
            "submission_id": f"eq.{submission_id}", "select": "*", "order": "line_index.asc",
        }),
        *(db.signed_url(path) for path in paths) if want_url else (),
    )
    marks = marks_raw
    image_urls = [url for url in signed if url]
    image_url = image_urls[0] if image_urls else None

    threshold = settings.legibility_threshold
    order = list(CQ_PARTS)
    marks.sort(key=lambda m: order.index(m["part"]) if m["part"] in order else 99)

    return SubmissionView(
        id=submission_id,
        status=SubmissionStatus(row["status"]),
        question_text=row.get("question_text") or "",
        subject=row.get("subject"),
        image_path=row.get("image_path"),
        image_url=image_url,
        image_urls=image_urls,
        needs_human_review=bool(row.get("needs_human_review")),
        review_reason=row.get("review_reason"),
        total_awarded=row.get("total_awarded"),
        total_max=row.get("total_max") or CQ_TOTAL,
        feedback=row.get("feedback"),
        ocr_engine=row.get("ocr_engine"),
        grader_model=row.get("grader_model"),
        error=row.get("error"),
        created_at=row.get("created_at"),
        released_at=row.get("released_at"),
        teacher_feedback=row.get("teacher_feedback"),
        ai_feedback=row.get("ai_feedback"),
        feedback_edited_by=people.get(row.get("feedback_edited_by") or ""),
        reviewed_by=people.get(row.get("reviewed_by") or ""),
        marks_stale=bool(row.get("marks_stale")),
        reviewed_at=row.get("reviewed_at"),
        student=student,
        annotations=annotations,
        lines=[
            LineView(
                index=line["line_index"],
                text=line.get("text") or "",
                legibility=line.get("legibility"),
                is_guess=bool(line.get("is_guess")),
                bbox=line.get("bbox"),
                clarified_text=line.get("clarified_text"),
                needs_clarification=pipeline.needs_clarification(line, threshold),
            )
            for line in lines
        ],
        marks=[
            MarkView(
                part=m["part"],
                bangla=CQ_PARTS[m["part"]][0],
                skill=CQ_PARTS[m["part"]][2],
                max_marks=m["max_marks"],
                awarded=m["awarded"],
                ai_awarded=m.get("ai_awarded"),
                reason=m.get("reason") or "",
                improvement=m.get("improvement") or "",
                ai_reason=m.get("ai_reason") or "",
                ai_improvement=m.get("ai_improvement") or "",
                edited_by=people.get(m.get("edited_by") or ""),
                edited_at=m.get("edited_at"),
                evidence_lines=m.get("evidence_lines") or [],
            )
            for m in marks
            if m["part"] in CQ_PARTS
        ],
    )


# --------------------------------------------------------------------- routes

@app.get("/health")
async def health() -> dict[str, Any]:
    provider = get_ocr_provider()
    return {
        "ok": True,
        "ocr": {
            "provider": provider.name,
            "model": settings.ocr_model,
            "supports_legibility": provider.supports_legibility,
            "supports_bbox": provider.supports_bbox,
        },
        "grader": {
            "provider": settings.grader_provider,
            "model": settings.grader_model,
            "reasoning_effort": settings.grader_reasoning_effort or None,
        },
        "legibility_threshold": settings.legibility_threshold,
        "supabase_configured": bool(settings.supabase_url and settings.supabase_secret_key),
    }


@app.get("/api/config")
async def client_config() -> dict[str, Any]:
    """Browser-safe configuration, read at runtime rather than baked into the
    bundle — so one image runs in any environment without a rebuild."""
    return {
        "supabase_url": settings.supabase_url,
        "supabase_publishable_key": settings.supabase_publishable_key,
    }


@app.get("/api/rubric")
async def rubric() -> dict[str, Any]:
    return {
        "total": CQ_TOTAL,
        "parts": [
            {"part": key, "bangla": bn, "max_marks": marks, "skill": skill}
            for key, (bn, marks, skill) in CQ_PARTS.items()
        ],
    }


@app.post("/api/submissions", status_code=201)
async def create_submission(
    question_text: str = Form(default=""),
    subject: str | None = Form(default=None),
    script: list[UploadFile] = File(...),
    caller: Caller = Depends(current_user),
) -> dict[str, Any]:
    payload = CreateSubmission(question_text=question_text, subject=subject)

    if not script:
        raise HTTPException(400, "Add at least one page of the script")
    if len(script) > MAX_PAGES:
        raise HTTPException(413, f"At most {MAX_PAGES} pages per submission")

    submission_id = str(uuid.uuid4())
    uploads: list[tuple[str, bytes, str]] = []
    total = 0

    for position, upload in enumerate(script):
        data = await upload.read()
        if not data:
            raise HTTPException(400, f"Page {position + 1} is empty")
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                413, f"Page {position + 1} is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB"
            )
        total += len(data)
        if total > MAX_TOTAL_UPLOAD_BYTES:
            raise HTTPException(
                413,
                f"The pages come to more than {MAX_TOTAL_UPLOAD_BYTES // (1024 * 1024)} MB "
                f"together. Send fewer pages, or smaller ones.",
            )

        mime = (upload.content_type or "").split(";")[0].strip().lower()
        if mime not in ALLOWED_MIME:
            guessed, _ = mimetypes.guess_type(upload.filename or "")
            mime = (guessed or "").lower()
        if mime not in ALLOWED_MIME:
            raise HTTPException(
                415,
                f"Page {position + 1}: unsupported file type. "
                f"Allowed: {', '.join(sorted(ALLOWED_MIME))}",
            )

        extension = mimetypes.guess_extension(mime) or ".bin"
        # First path segment is the owner — the storage RLS policy depends on it.
        suffix = "" if position == 0 else f"-{position + 1}"
        uploads.append((f"{caller.id}/{submission_id}{suffix}{extension}", data, mime))

    # If one page fails to store, the ones already written would be orphaned in
    # the bucket with no row pointing at them. Clean them up before giving up.
    try:
        await asyncio.gather(*(db.upload(path, data, mime) for path, data, mime in uploads))
    except Exception as exc:
        await asyncio.gather(
            *(db.remove(path) for path, _, _ in uploads), return_exceptions=True
        )
        log.warning("upload failed for %s, stored pages removed: %s", submission_id, exc)
        raise HTTPException(502, "Could not store the pages. Try again.") from exc

    paths = [path for path, _, _ in uploads]

    rows = await db.insert("submissions", {
        "id": submission_id,
        "student_id": caller.id,
        "question_text": payload.question_text,
        "subject": payload.subject,
        "image_path": paths[0],
        "image_paths": paths,
        "status": SubmissionStatus.RECEIVED.value,
        "total_max": CQ_TOTAL,
    })
    if not rows:
        raise HTTPException(500, "Could not create the submission")
    # image_path is kept alongside image_paths so a caller written against the
    # single-page shape keeps working.
    return {"id": submission_id, "status": SubmissionStatus.RECEIVED.value,
            "image_path": paths[0], "image_paths": paths, "pages": len(paths)}


@app.post("/api/submissions/{submission_id}/process")
async def process(submission_id: str, caller: Caller = Depends(current_user)) -> dict[str, Any]:
    """Run OCR, then the gate, then grading if nothing needs a human."""
    await load_submission(submission_id, caller)
    try:
        return await pipeline.run_ocr(submission_id)
    except AgentError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/submissions/{submission_id}/clarify")
async def clarify(
    submission_id: str, body: ClarifyLine, caller: Caller = Depends(current_user)
) -> dict[str, Any]:
    await load_submission(submission_id, caller)
    try:
        return await pipeline.clarify_line(submission_id, body.line_index, body.text)
    except AgentError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/submissions/{submission_id}")
async def get_submission(
    submission_id: str,
    image: bool = True,
    caller: Caller = Depends(current_user),
) -> SubmissionView:
    """`image=false` skips minting a signed URL — worth it while the client is
    polling a submission in flight, since the URL it already holds is good for
    an hour."""
    row = await load_submission(submission_id, caller)
    return await build_view(row, with_image_url=image, with_student=caller.is_teacher)


@app.get("/api/submissions")
async def list_submissions(caller: Caller = Depends(current_user)) -> list[dict[str, Any]]:
    params: dict[str, Any] = {
        "select": "id,status,subject,question_text,total_awarded,total_max,"
                  "needs_human_review,review_reason,created_at,released_at",
        "order": "created_at.desc",
        "limit": 100,
    }
    # Always the caller's own, teacher or not. Showing a teacher everyone's
    # scripts here duplicated the panel while hiding whose script each row was.
    params["student_id"] = f"eq.{caller.id}"
    return await db.select("submissions", params=params)


@app.get("/api/teacher/panel")
async def teacher_panel(
    status: str | None = None,
    flagged: bool | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
    caller: Caller = Depends(require_teacher),
) -> PanelPage:
    """Every submission, not just the ones waiting on a teacher.

    The point of the panel is that the teacher decides what needs looking at, so
    the default view is unfiltered and the counts show the shape of the workload
    before anything is narrowed down.
    """
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    needle = (q or "").strip().lower()

    base: dict[str, Any] = {}
    if status and status != "all":
        base["status"] = f"eq.{status}"
    if flagged:
        base["needs_human_review"] = "is.true"

    select = ("id,status,subject,question_text,total_awarded,total_max,"
              "needs_human_review,review_reason,marks_stale,created_at,released_at,"
              "student_id,image_paths")

    counts_raw, students = await asyncio.gather(
        db.select("submissions", params={"select": "status,needs_human_review", "limit": 5000}),
        db.select("profiles", params={"select": "id,email,full_name", "limit": 5000}),
    )
    by_id = {s["id"]: StudentBrief(**s) for s in students}

    if needle:
        # Search has to span the whole set, not the page. It also reaches into the
        # student's name and email, which live in another table, so the match is
        # made here rather than in the query — fetching the filtered set once and
        # paging the result.
        every = await db.select("submissions", params={
            **base, "select": select, "order": "created_at.desc", "limit": 5000,
        })

        def matches(row: dict[str, Any]) -> bool:
            student = by_id.get(row["student_id"])
            haystack = " ".join(filter(None, [
                row.get("subject") or "", row.get("question_text") or "",
                getattr(student, "email", "") or "", getattr(student, "full_name", "") or "",
            ])).lower()
            return needle in haystack

        found = [row for row in every if matches(row)]
        matched = len(found)
        rows = found[offset : offset + limit]
    else:
        rows = await db.select("submissions", params={
            **base, "select": select, "order": "created_at.desc",
            "limit": limit, "offset": offset,
        })
        matched = sum(
            1 for row in counts_raw
            if (not status or status == "all" or row["status"] == status)
            and (not flagged or row.get("needs_human_review"))
        )

    counts: dict[str, int] = {}
    for row in counts_raw:
        counts[row["status"]] = counts.get(row["status"], 0) + 1

    return PanelPage(
        rows=[
            SubmissionRow(
                id=row["id"],
                status=SubmissionStatus(row["status"]),
                subject=row.get("subject"),
                question_text=row.get("question_text") or "",
                total_awarded=row.get("total_awarded"),
                total_max=row.get("total_max") or CQ_TOTAL,
                needs_human_review=bool(row.get("needs_human_review")),
                review_reason=row.get("review_reason"),
                marks_stale=bool(row.get("marks_stale")),
                created_at=row.get("created_at"),
                released_at=row.get("released_at"),
                student=by_id.get(row["student_id"]),
                pages=max(1, len(row.get("image_paths") or [])),
            )
            for row in rows
        ],
        total=len(counts_raw),
        matched=matched,
        offset=offset,
        counts=counts,
        flagged=sum(1 for row in counts_raw if row.get("needs_human_review")),
    )


@app.get("/api/teacher/stats")
async def teacher_stats(caller: Caller = Depends(require_teacher)) -> dict[str, Any]:
    """Enough to tell a teacher where the class is struggling and how often the
    agent is being corrected."""
    subs, marks = await asyncio.gather(
        db.select("submissions", params={
            "select": "status,total_awarded,total_max", "limit": 5000}),
        db.select("marks", params={"select": "part,awarded,max_marks,ai_awarded", "limit": 20000}),
    )

    scored = [s["total_awarded"] for s in subs if s.get("total_awarded") is not None]
    overridden = sum(
        1 for m in marks if m.get("ai_awarded") is not None and m["ai_awarded"] != m["awarded"]
    )

    per_part: dict[str, dict[str, Any]] = {}
    for key, (bn, cap, skill) in CQ_PARTS.items():
        got = [m["awarded"] for m in marks if m["part"] == key]
        per_part[key] = {
            "bangla": bn, "skill": skill, "max_marks": cap, "marked": len(got),
            # Share of the available marks actually earned — comparable across
            # parts worth 1 and parts worth 4.
            "accuracy": round(sum(got) / (len(got) * cap), 3) if got else None,
            "average": round(sum(got) / len(got), 2) if got else None,
        }

    return {
        "submissions": len(subs),
        "scored": len(scored),
        "average": round(sum(scored) / len(scored), 2) if scored else None,
        "highest": max(scored) if scored else None,
        "lowest": min(scored) if scored else None,
        "override_rate": round(overridden / len(marks), 3) if marks else None,
        "overridden_marks": overridden,
        "per_part": per_part,
    }


@app.get("/api/review-queue")
async def review_queue(caller: Caller = Depends(require_teacher)) -> list[dict[str, Any]]:
    return await db.select("submissions", params={
        "select": "id,status,subject,question_text,total_awarded,total_max,"
                  "needs_human_review,review_reason,created_at,student_id",
        "status": f"eq.{SubmissionStatus.AWAITING_TEACHER.value}",
        "order": "needs_human_review.desc,created_at.asc",
        "limit": 100,
    })


@app.post("/api/submissions/{submission_id}/override")
async def override(
    submission_id: str, body: OverrideMark, caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    await load_submission(submission_id, caller)
    try:
        return await pipeline.apply_override(
            submission_id, caller.id, body.part,
            new_awarded=body.new_awarded, note=body.note,
            reason=body.reason, improvement=body.improvement,
        )
    except AgentError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/submissions/{submission_id}/release")
async def release(submission_id: str, caller: Caller = Depends(require_teacher)) -> dict[str, Any]:
    await load_submission(submission_id, caller)
    try:
        return await pipeline.release(submission_id, caller.id)
    except AgentError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/submissions/{submission_id}/edit-line")
async def edit_line(
    submission_id: str, body: EditLine, caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    """Correct any transcribed line, not only one the reader flagged."""
    await load_submission(submission_id, caller)
    try:
        return await pipeline.edit_line(submission_id, body.line_index, body.text)
    except AgentError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/submissions/{submission_id}/regrade")
async def regrade(submission_id: str, caller: Caller = Depends(require_teacher)) -> dict[str, Any]:
    await load_submission(submission_id, caller)
    try:
        return await pipeline.regrade(submission_id)
    except AgentError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/submissions/{submission_id}/feedback")
async def teacher_feedback(
    submission_id: str, body: TeacherFeedback, caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    await load_submission(submission_id, caller)
    return await pipeline.set_teacher_feedback(submission_id, caller.id, body.text)


@app.post("/api/submissions/{submission_id}/edit-feedback")
async def edit_feedback(
    submission_id: str, body: EditFeedback, caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    """Rewrite the agent's overall feedback. The agent's own words are kept."""
    await load_submission(submission_id, caller)
    return await pipeline.set_feedback(submission_id, caller.id, body.text)


@app.post("/api/submissions/{submission_id}/annotations", status_code=201)
async def add_annotation(
    submission_id: str, body: Annotation, caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    await load_submission(submission_id, caller)
    rows = await db.insert("annotations", {
        "submission_id": submission_id,
        "page": body.page, "x0": body.x0, "y0": body.y0, "x1": body.x1, "y1": body.y1,
        "note": body.note, "colour": body.colour, "author_id": caller.id,
    })
    if not rows:
        raise HTTPException(500, "Could not save the annotation")
    return rows[0]


@app.delete("/api/submissions/{submission_id}/annotations/{annotation_id}", status_code=204)
async def delete_annotation(
    submission_id: str, annotation_id: str, caller: Caller = Depends(require_teacher)
) -> None:
    await load_submission(submission_id, caller)
    await db.delete("annotations", params={
        "id": f"eq.{annotation_id}", "submission_id": f"eq.{submission_id}",
    })


@app.post("/api/teacher/release")
async def bulk_release(
    body: BulkRelease, caller: Caller = Depends(require_teacher)
) -> dict[str, Any]:
    """Release many at once. Each is attempted independently so one stale script
    does not block the rest, and the caller is told exactly which failed."""
    released: list[str] = []
    skipped: list[dict[str, str]] = []

    for submission_id in body.submission_ids:
        try:
            row = await db.select_one(
                "submissions", params={"id": f"eq.{submission_id}", "select": "id"}
            )
            if not row:
                skipped.append({"id": submission_id, "reason": "not found"})
                continue
            await pipeline.release(submission_id, caller.id)
            released.append(submission_id)
        except AgentError as exc:
            skipped.append({"id": submission_id, "reason": str(exc)})
        except Exception as exc:
            log.exception("bulk release failed for %s", submission_id)
            skipped.append({"id": submission_id, "reason": f"{type(exc).__name__}"})

    return {"released": released, "skipped": skipped,
            "released_count": len(released), "skipped_count": len(skipped)}


@app.get("/api/submissions/{submission_id}/overrides")
async def submission_overrides(
    submission_id: str, caller: Caller = Depends(current_user)
) -> list[dict[str, Any]]:
    await load_submission(submission_id, caller)
    return await db.select("overrides", params={
        "submission_id": f"eq.{submission_id}", "select": "*", "order": "created_at.desc",
    })


# --------------------------------------------------------------------- static SPA

# Mounted last so it never shadows an /api route. Present only in the container
# image; running the API alone for local development simply skips this.
_STATIC = Path(os.environ.get("STATIC_DIR", "")) if os.environ.get("STATIC_DIR") else None

if _STATIC and _STATIC.is_dir():
    app.mount("/assets", StaticFiles(directory=_STATIC / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> FileResponse:
        """Serve the single-page app, letting client-side routing own the path."""
        # An unknown /api or /mcp path is a client bug, not a page. Falling
        # through to index.html would hand it HTML and a confusing JSON parse
        # error instead of a clear 404. The same goes for /.well-known: clients
        # probe it to discover an OAuth server, and this one has none — a 404
        # says so, where 200 and a page of HTML reads as a broken server.
        if full_path.startswith(("api/", "mcp", ".well-known/")):
            raise HTTPException(404, f"No such endpoint: /{full_path}")

        candidate = (_STATIC / full_path).resolve()
        # resolve() + is_relative_to keeps ../ out of the static root.
        if full_path and candidate.is_file() and candidate.is_relative_to(_STATIC.resolve()):
            return FileResponse(candidate)
        return FileResponse(_STATIC / "index.html")
