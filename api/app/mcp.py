"""MCP server — the marking agent, reachable from any MCP client.

Streamable HTTP transport, JSON-RPC 2.0, implemented directly so the service
carries no extra dependency for it.

Design rule: the tools are a channel to the agent, not a window into the
database. A connected client can submit a script, read back its own marks, and
resolve a line the reader could not make out. It cannot enumerate other people's
submissions or reach the tables underneath — authorisation is the same check the
REST surface makes, on the same Supabase token.

Point a client at:  POST {service}/mcp   with  Authorization: Bearer <token>
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .main import Caller

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from . import db, pipeline
from .agents.base import AgentError
from .agents.ocr import UnreadableScript
from .config import settings
from .schemas import CQ_PARTS, CQ_TOTAL, SubmissionStatus

log = logging.getLogger("nirikkha.mcp")

router = APIRouter()

PROTOCOL_VERSION = "2025-06-18"
# Older clients reject a response that does not name a version they know. The
# tool surface is identical across these, so echo back whichever was asked for.
SUPPORTED_PROTOCOLS = frozenset({"2025-06-18", "2025-03-26", "2024-11-05"})
# Supabase Auth is the authorization server for this endpoint: it issues the
# tokens, and the app hosts the consent screen it redirects to.
AUTHORIZATION_SERVER = f"{settings.supabase_url}/auth/v1"
SERVER_NAME = "nirikkha"
SERVER_VERSION = "0.1.0"
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_PAGES = 3
# Cloud Run caps an HTTP/1 body at 32 MiB and base64 inflates by a third, so
# three pages at the per-page limit would be refused by the platform before this
# code ran — the client would see a connection failure with nothing to act on.
# Refuse it here instead, where the message can name the limit.
MAX_TOTAL_IMAGE_BYTES = 23 * 1024 * 1024

INSTRUCTIONS = (
    "Nirikkha marks handwritten Bangladeshi SSC/HSC সৃজনশীল প্রশ্ন (creative question) "
    "answer scripts. A CQ has four parts — ক (1 mark, knowledge), খ (2, comprehension), "
    "গ (3, application), ঘ (4, higher-order skill) — totalling 10.\n\n"
    "The distinctive behaviour: when the reader cannot make out a word it does NOT guess. "
    "It returns those lines with [[অস্পষ্ট]] marking the exact unreadable spans and asks "
    "for them to be resolved before marking. If check_cq_script comes back with status "
    "'awaiting_student', show the user those lines, ask what they actually say, and send "
    "each answer with clarify_unclear_line. Marking resumes automatically once the last "
    "one is resolved.\n\n"
    "Marks are never final until a teacher releases them; a result with status "
    "'awaiting_teacher' is provisional and should be described that way.\n\n"
    "Start with list_cq_submissions when the user asks about existing work — 'has mine been "
    "marked', 'what is waiting on me', 'which scripts still need releasing'. It is the only "
    "way to find a submission_id you did not just create. A student sees their own scripts, a "
    "teacher sees the whole class.\n\n"
    "A teacher can also work through a script by talking about it: change a part's mark or the "
    "words explaining it with override_cq_mark, rewrite the overall comment with "
    "edit_cq_feedback, and publish with release_cq_marks. Read the result before releasing — "
    "release is the point at which a mistake reaches the student, and it cannot be taken back "
    "quietly. Say what you are about to change before you change it."
)

Handler = Callable[[dict[str, Any], "Caller"], Awaitable[dict[str, Any]]]

# --------------------------------------------------------------------- tools

TOOLS: list[dict[str, Any]] = [
    {
        "name": "check_cq_script",
        "title": "Mark a CQ answer script",
        "description": (
            "Submit a photo of a handwritten সৃজনশীল প্রশ্ন answer script together with the "
            "question it answers, and get per-part marks out of 10.\n\n"
            "Pass the image as base64 in `script_base64`. Supplying `question_text` — the "
            "উদ্দীপক and all four parts — lets the marker judge whether the student engaged "
            "with the stimulus, so include it when you have it. Omit it when the page itself "
            "carries the question; the marker will recover it from the script.\n\n"
            "Returns one of three outcomes in `status`:\n"
            "• 'awaiting_teacher' — marked. `marks` holds per-part awards, the reason for each, "
            "and `improvement` saying what the student should have written.\n"
            "• 'awaiting_student' — some lines could not be read. `unclear_lines` lists them with "
            "[[অস্পষ্ট]] marking the exact spans. Ask the user what those say, then call "
            "clarify_unclear_line for each.\n"
            "• 'failed' with `unreadable` true — the page is rotated, blurred, or is not an answer "
            "script. `message` is a Bangla explanation written for the student; relay it.\n\n"
            "Marking takes 20–60 seconds. Do not call this twice for the same script."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "question_text": {
                    "type": "string",
                    "maxLength": 20000,
                    "description": (
                        "The full question: উদ্দীপক plus parts ক, খ, গ, ঘ. Optional — omit it "
                        "when the photographed page already carries the question, and the "
                        "marker will recover it from the script."
                    ),
                },
                "script_base64": {
                    "type": "string",
                    "description": (
                        "The answer script image, base64-encoded. JPEG, PNG or WebP, under 20 MB. "
                        "For a script running to several sheets use `pages_base64` instead."
                    ),
                },
                "pages_base64": {
                    "type": "array",
                    "items": {"type": "string"},
                    "maxItems": 3,
                    "description": (
                        f"Up to {MAX_PAGES} pages of one script, base64-encoded, in reading "
                        "order. Use this rather than calling the tool once per page — the "
                        "marker reads them together so line numbers stay continuous and an "
                        "answer running over a page break is marked as one answer."
                    ),
                },
                "mime_type": {
                    "type": "string",
                    "enum": ["image/jpeg", "image/png", "image/webp"],
                    "default": "image/jpeg",
                    "description": "Media type of script_base64.",
                },
                "subject": {
                    "type": "string",
                    "maxLength": 120,
                    "description": "Subject, e.g. পদার্থবিজ্ঞান. Optional but improves marking.",
                },
            },
            "required": ["script_base64"],
        },
        "annotations": {"readOnlyHint": False, "idempotentHint": False, "openWorldHint": True},
    },
    {
        "name": "clarify_unclear_line",
        "title": "Resolve a line the reader could not make out",
        "description": (
            "Tell the marker what an unreadable line actually says. Use the `index` from an "
            "`unclear_lines` entry returned by check_cq_script or get_cq_result.\n\n"
            "Send the line's true text, not a correction of the student's work — the point is to "
            "recover what was written, mistakes included, because those mistakes are what gets "
            "marked.\n\n"
            "When the last unclear line is resolved, marking runs automatically and this returns "
            "status 'awaiting_teacher' with the marks."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "submission_id": {"type": "string", "description": "From check_cq_script."},
                "line_index": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "Which line, from an unclear_lines entry.",
                },
                "text": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 2000,
                    "description": "What that line actually says, transcribed as written.",
                },
            },
            "required": ["submission_id", "line_index", "text"],
        },
        "annotations": {"readOnlyHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "get_cq_result",
        "title": "Read a script's marks and status",
        "description": (
            "Fetch the current state of a submission: status, per-part marks with reasons and "
            "improvement guidance, overall feedback, and any lines still waiting to be resolved.\n\n"
            "Only the submission's own owner, or a teacher, can read it."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "submission_id": {"type": "string", "description": "From check_cq_script."},
            },
            "required": ["submission_id"],
        },
        "annotations": {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "list_cq_submissions",
        "title": "List scripts and what each is waiting on",
        "description": (
            "List answer scripts with their status and marks. A student sees their own; a "
            "teacher sees everyone's.\n\n"
            "This is how you find a `submission_id` — nothing else returns one except the call "
            "that created it. Use it to answer 'what is waiting on me', 'has my script been "
            "marked yet', or 'which scripts still need releasing'.\n\n"
            "Filter with `status`: 'awaiting_teacher' is marked and waiting for a teacher to "
            "release it, 'awaiting_student' is stopped on lines the reader could not make out, "
            "'released' is final, 'failed' could not be read at all. Teachers can also pass "
            "`flagged` for the ones the marker itself was unsure about, and `student` to search "
            "by name or email."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["all", "awaiting_teacher", "awaiting_student", "released",
                             "failed", "received"],
                    "default": "all",
                },
                "flagged": {
                    "type": "boolean",
                    "description": "Only scripts the marker flagged for review. Teachers only.",
                },
                "student": {
                    "type": "string",
                    "maxLength": 120,
                    "description": "Match a student by name or email. Teachers only.",
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
            },
        },
        "annotations": {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "override_cq_mark",
        "title": "Change a mark, or the words explaining it",
        "description": (
            "Teachers only. Change what one part was awarded, and/or rewrite the reason and the "
            "improvement advice the marker wrote for it.\n\n"
            "Pass whichever you mean to change — the rest is left alone. The agent's original "
            "wording and score are kept beside the correction, and the student is shown who "
            "changed it, so this is a visible correction rather than a quiet rewrite.\n\n"
            "The total is recomputed here; do not try to set it."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "submission_id": {"type": "string"},
                "part": {"type": "string", "enum": list(CQ_PARTS),
                         "description": "ka=ক 1, kha=খ 2, ga=গ 3, gha=ঘ 4."},
                "awarded": {"type": "integer", "minimum": 0,
                            "description": "New mark. Must not exceed the part's maximum."},
                "reason": {"type": "string", "maxLength": 2000,
                           "description": "Replaces the marker's explanation for this part."},
                "improvement": {"type": "string", "maxLength": 2000,
                                "description": "Replaces the advice on what to have written."},
                "note": {"type": "string", "maxLength": 2000,
                         "description": "Why the change was made. Kept in the audit trail."},
            },
            "required": ["submission_id", "part"],
        },
        "annotations": {"readOnlyHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "edit_cq_feedback",
        "title": "Rewrite the overall feedback",
        "description": (
            "Teachers only. Replace the marker's overall comment on a script. The agent's own "
            "wording is kept, and the student sees the teacher's name against the new text.\n\n"
            "Write it to the student in Bangla, addressing them as তুমি, unless they are clearly "
            "working in English."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "submission_id": {"type": "string"},
                "feedback": {"type": "string", "minLength": 1, "maxLength": 4000},
            },
            "required": ["submission_id", "feedback"],
        },
        "annotations": {"readOnlyHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "release_cq_marks",
        "title": "Publish a result to the student",
        "description": (
            "Teachers only. Make a provisional result final and visible to the student as "
            "settled.\n\n"
            "Refused if the transcript changed after marking — the script has to be marked again "
            "first, because publishing a score computed from text that no longer matches the "
            "script is the one thing this system must not do. Read the result before releasing "
            "it; releasing is the point at which a mistake reaches the student."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"submission_id": {"type": "string"}},
            "required": ["submission_id"],
        },
        "annotations": {"readOnlyHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "get_cq_rubric",
        "title": "The CQ mark scheme",
        "description": (
            "Return the four CQ parts, their Bangla labels, the skill each tests and its maximum "
            "marks. Useful for explaining a result, or for checking a question is a well-formed CQ "
            "before submitting a script against it."
        ),
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
    },
]


# --------------------------------------------------------------------- helpers

def _unclear_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    threshold = settings.legibility_threshold
    return [
        {
            "index": line["line_index"],
            "text_as_read": line.get("text") or "",
            "legibility": line.get("legibility"),
        }
        for line in lines
        if pipeline.needs_clarification(line, threshold)
    ]


async def _result_payload(
    submission_id: str, row: dict[str, Any] | None = None
) -> dict[str, Any]:
    if row is None:
        row = await db.select_one(
            "submissions", params={"id": f"eq.{submission_id}", "select": "*"}
        )
    if not row:
        raise AgentError("submission not found")

    # Independent reads; one round trip rather than two.
    lines, marks = await asyncio.gather(
        db.select("ocr_lines", params={
            "submission_id": f"eq.{submission_id}", "select": "*", "order": "line_index.asc",
        }),
        db.select("marks", params={"submission_id": f"eq.{submission_id}", "select": "*"}),
    )
    order = list(CQ_PARTS)
    marks.sort(key=lambda m: order.index(m["part"]) if m["part"] in order else 99)

    payload: dict[str, Any] = {
        "submission_id": submission_id,
        "status": row["status"],
        "total_awarded": row.get("total_awarded"),
        "total_max": row.get("total_max") or CQ_TOTAL,
        "feedback": row.get("feedback"),
        "needs_teacher_review": bool(row.get("needs_human_review")),
        "provisional": row["status"] != SubmissionStatus.RELEASED.value,
        "marks": [
            {
                "part": m["part"],
                "bangla": CQ_PARTS[m["part"]][0],
                "skill": CQ_PARTS[m["part"]][2],
                "awarded": m["awarded"],
                "max_marks": m["max_marks"],
                "reason": m.get("reason") or "",
                "improvement": m.get("improvement") or "",
            }
            for m in marks
            if m["part"] in CQ_PARTS
        ],
    }
    unclear = _unclear_lines(lines)
    if unclear:
        payload["unclear_lines"] = unclear
    if row.get("error"):
        payload["message"] = row["error"]
    return payload


async def _authorise(submission_id: str, user_id: str, role: str) -> dict[str, Any]:
    """Check ownership and return the row, so the caller need not re-read it."""
    row = await db.select_one(
        "submissions", params={"id": f"eq.{submission_id}", "select": "*"}
    )
    if not row:
        raise AgentError("submission not found")
    if row["student_id"] != user_id and role != "teacher":
        raise AgentError("that submission belongs to someone else")
    return row


# --------------------------------------------------------------------- handlers

async def _tool_check_cq_script(args: dict[str, Any], caller: Caller) -> dict[str, Any]:
    user_id = caller.id
    question_text = str(args.get("question_text") or "").strip()

    raw_pages = args.get("pages_base64")
    if isinstance(raw_pages, list) and raw_pages:
        encoded = [str(page) for page in raw_pages]
    elif args.get("script_base64"):
        encoded = [str(args["script_base64"])]
    else:
        raise AgentError("give the script in script_base64, or several pages in pages_base64")

    if len(encoded) > MAX_PAGES:
        raise AgentError(f"at most {MAX_PAGES} pages per script")

    mime = str(args.get("mime_type") or "image/jpeg")
    if mime not in {"image/jpeg", "image/png", "image/webp"}:
        raise AgentError(f"unsupported mime_type {mime!r}")
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime]

    images: list[bytes] = []
    for position, blob in enumerate(encoded):
        try:
            # validate=True so a truncated or mangled payload fails here with a
            # clear message rather than producing silently corrupt image bytes.
            image = base64.b64decode(blob, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise AgentError(f"page {position + 1} is not valid base64: {exc}") from exc
        if not image:
            raise AgentError(f"page {position + 1} decoded to an empty file")
        if len(image) > MAX_IMAGE_BYTES:
            raise AgentError(f"page {position + 1} is larger than {MAX_IMAGE_BYTES // (1024 * 1024)} MB")
        images.append(image)

    total = sum(len(image) for image in images)
    if total > MAX_TOTAL_IMAGE_BYTES:
        raise AgentError(
            f"{len(images)} pages come to {total // (1024 * 1024)} MB; the limit for one "
            f"script is {MAX_TOTAL_IMAGE_BYTES // (1024 * 1024)} MB. Photograph them at a "
            "lower resolution, or send fewer pages."
        )

    submission_id = str(uuid.uuid4())
    paths = [
        f"{user_id}/{submission_id}{'' if i == 0 else f'-{i + 1}'}{extension}"
        for i in range(len(images))
    ]
    try:
        await asyncio.gather(*(db.upload(p, img, mime) for p, img in zip(paths, images, strict=True)))
    except Exception as exc:
        await asyncio.gather(*(db.remove(p) for p in paths), return_exceptions=True)
        raise AgentError(f"could not store the pages: {exc}") from exc

    await db.insert("submissions", {
        "id": submission_id,
        "student_id": user_id,
        "question_text": question_text,
        "subject": args.get("subject"),
        "image_path": paths[0],
        "image_paths": paths,
        "status": SubmissionStatus.RECEIVED.value,
        "total_max": CQ_TOTAL,
    })

    try:
        outcome = await pipeline.run_ocr(submission_id)
    except UnreadableScript as exc:
        return {"submission_id": submission_id, "status": SubmissionStatus.FAILED.value,
                "unreadable": True, "reason": exc.reason, "message": str(exc)}

    payload = await _result_payload(submission_id)
    if outcome.get("unreadable"):
        payload["unreadable"] = True
    return payload


async def _tool_clarify(args: dict[str, Any], _caller: Caller) -> dict[str, Any]:
    submission_id = str(args.get("submission_id") or "")
    text = str(args.get("text") or "").strip()
    if not submission_id or not text:
        raise AgentError("submission_id and text are required")
    line_index = args.get("line_index")
    if not isinstance(line_index, int) or isinstance(line_index, bool) or line_index < 0:
        raise AgentError("line_index must be a non-negative integer")

    await pipeline.clarify_line(submission_id, line_index, text)
    return await _result_payload(submission_id)


async def _tool_get_result(args: dict[str, Any], _caller: Caller) -> dict[str, Any]:
    submission_id = str(args.get("submission_id") or "")
    if not submission_id:
        raise AgentError("submission_id is required")
    return await _result_payload(submission_id)


async def _tool_list(args: dict[str, Any], caller: Caller) -> dict[str, Any]:
    limit = args.get("limit")
    limit = 20 if not isinstance(limit, int) or isinstance(limit, bool) else max(1, min(limit, 50))

    params: dict[str, Any] = {
        "select": ("id,status,subject,question_text,total_awarded,total_max,"
                   "needs_human_review,marks_stale,created_at,student_id"),
        "order": "created_at.desc",
    }
    status = str(args.get("status") or "all")
    if status != "all":
        if status not in {s.value for s in SubmissionStatus}:
            raise AgentError(f"unknown status {status!r}")
        params["status"] = f"eq.{status}"

    # A student only ever sees their own; the filters that reach across people
    # are refused rather than silently ignored, so nobody reads a short list as
    # "nothing to do".
    if not caller.is_teacher:
        if args.get("student") or args.get("flagged"):
            raise AgentError("only a teacher can filter by student or flag")
        params["student_id"] = f"eq.{caller.id}"
    elif args.get("flagged"):
        params["needs_human_review"] = "is.true"

    needle = str(args.get("student") or "").strip().lower()
    # Searching spans the whole set and reaches into another table, so fetch
    # wide and narrow here rather than paging a filtered query.
    params["limit"] = 1000 if needle else limit
    rows = await db.select("submissions", params=params)

    people: dict[str, dict[str, Any]] = {}
    if caller.is_teacher and rows:
        ids = ",".join(sorted({r["student_id"] for r in rows}))
        people = {p["id"]: p for p in await db.select("profiles", params={
            "id": f"in.({ids})", "select": "id,email,full_name",
        })}
        if needle:
            def matches(row: dict[str, Any]) -> bool:
                who = people.get(row["student_id"], {})
                hay = " ".join(filter(None, [who.get("full_name"), who.get("email")])).lower()
                return needle in hay
            rows = [r for r in rows if matches(r)]

    listed = rows[:limit]
    out: list[dict[str, Any]] = []
    for row in listed:
        item = {
            "submission_id": row["id"],
            "status": row["status"],
            "subject": row.get("subject") or (row.get("question_text") or "").strip()[:60] or None,
            "total_awarded": row.get("total_awarded"),
            "total_max": row.get("total_max") or CQ_TOTAL,
            "needs_teacher_review": bool(row.get("needs_human_review")),
            "marks_stale": bool(row.get("marks_stale")),
            "created_at": row.get("created_at"),
        }
        if caller.is_teacher:
            who = people.get(row["student_id"], {})
            item["student"] = who.get("full_name") or who.get("email") or row["student_id"]
        out.append(item)

    return {
        "viewing_as": "teacher" if caller.is_teacher else "student",
        "count": len(out),
        "more": len(rows) > len(listed),
        "submissions": out,
    }


def _require_teacher(caller: Caller) -> None:
    if not caller.is_teacher:
        raise AgentError("that is a teacher action")


async def _tool_override(args: dict[str, Any], caller: Caller) -> dict[str, Any]:
    _require_teacher(caller)
    submission_id = str(args.get("submission_id") or "")
    part = str(args.get("part") or "")
    if part not in CQ_PARTS:
        raise AgentError(f"part must be one of {', '.join(CQ_PARTS)}")

    awarded = args.get("awarded")
    if awarded is not None:
        if not isinstance(awarded, int) or isinstance(awarded, bool):
            raise AgentError("awarded must be a whole number")
        ceiling = CQ_PARTS[part][1]
        if not 0 <= awarded <= ceiling:
            raise AgentError(f"part {CQ_PARTS[part][0]} is out of {ceiling}")

    reason = (str(args.get("reason")).strip() if args.get("reason") is not None else None)
    improvement = (str(args.get("improvement")).strip()
                   if args.get("improvement") is not None else None)
    if awarded is None and not reason and not improvement:
        raise AgentError("give a new mark, a reason, or an improvement — this changes nothing")

    await pipeline.apply_override(
        submission_id, caller.id, part,
        new_awarded=awarded, note=str(args.get("note") or "") or None,
        reason=reason, improvement=improvement,
    )
    return await _result_payload(submission_id)


async def _tool_edit_feedback(args: dict[str, Any], caller: Caller) -> dict[str, Any]:
    _require_teacher(caller)
    submission_id = str(args.get("submission_id") or "")
    text = str(args.get("feedback") or "").strip()
    if not text:
        raise AgentError("feedback cannot be empty")
    await pipeline.set_feedback(submission_id, caller.id, text)
    return await _result_payload(submission_id)


async def _tool_release(args: dict[str, Any], caller: Caller) -> dict[str, Any]:
    _require_teacher(caller)
    submission_id = str(args.get("submission_id") or "")
    await pipeline.release(submission_id, caller.id)
    return await _result_payload(submission_id)


async def _tool_rubric(_args: dict[str, Any], _caller: Caller) -> dict[str, Any]:
    return {
        "total": CQ_TOTAL,
        "parts": [
            {"part": key, "bangla": bn, "max_marks": marks, "skill": skill}
            for key, (bn, marks, skill) in CQ_PARTS.items()
        ],
    }


HANDLERS: dict[str, Handler] = {
    "check_cq_script": _tool_check_cq_script,
    "clarify_unclear_line": _tool_clarify,
    "get_cq_result": _tool_get_result,
    "list_cq_submissions": _tool_list,
    "override_cq_mark": _tool_override,
    "edit_cq_feedback": _tool_edit_feedback,
    "release_cq_marks": _tool_release,
    "get_cq_rubric": _tool_rubric,
}

# Tools that act on an existing submission must prove the caller owns it.
OWNED: set[str] = {
    "clarify_unclear_line", "get_cq_result",
    "override_cq_mark", "edit_cq_feedback", "release_cq_marks",
}


# --------------------------------------------------------------------- transport

def _public_base(request: Request) -> str:
    """The origin a client actually reached us on.

    Cloud Run terminates TLS and forwards plain HTTP, so request.url would say
    http:// and a client comparing it against the resource identifier it asked
    for would reject the mismatch.
    """
    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


def _resource_metadata(request: Request) -> dict[str, Any]:
    base = _public_base(request)
    return {
        "resource": f"{base}/mcp",
        "authorization_servers": [AUTHORIZATION_SERVER],
        "bearer_methods_supported": ["header"],
        "scopes_supported": ["openid", "email", "profile"],
        "resource_name": "Nirikkha CQ marker",
        "resource_documentation": f"{base}/",
    }


# Clients disagree about where this document lives: the spec appends the
# resource path to the well-known prefix, older ones ask the bare prefix, and
# some ask underneath the endpoint itself. All three are the same answer.
@router.get("/.well-known/oauth-protected-resource")
@router.get("/.well-known/oauth-protected-resource/mcp")
@router.get("/mcp/.well-known/oauth-protected-resource")
async def protected_resource(request: Request) -> JSONResponse:
    return JSONResponse(_resource_metadata(request))


def _unauthenticated(request: Request, request_id: Any, message: str) -> JSONResponse:
    """401 that says where to go and get a token, per RFC 9728."""
    metadata = f"{_public_base(request)}/.well-known/oauth-protected-resource"
    return JSONResponse(
        _rpc_error(request_id, -32001, message),
        status_code=401,
        headers={"WWW-Authenticate": f'Bearer resource_metadata="{metadata}"'},
    )


def _rpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _rpc_ok(request_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _tool_result(payload: dict[str, Any], *, is_error: bool = False) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}],
        "structuredContent": payload,
        "isError": is_error,
    }


@router.post("/mcp")
async def mcp_endpoint(
    request: Request, authorization: str | None = Header(default=None)
) -> JSONResponse:
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse(_rpc_error(None, -32700, "Parse error"), status_code=400)

    if not isinstance(body, dict):
        return JSONResponse(_rpc_error(None, -32600, "Invalid Request"), status_code=400)

    method = body.get("method")
    request_id = body.get("id")

    # Notifications carry no id and expect no body.
    if request_id is None and isinstance(method, str) and method.startswith("notifications/"):
        return JSONResponse({}, status_code=202)

    if method == "initialize":
        asked = ((body.get("params") or {}) if isinstance(body.get("params"), dict) else {}).get(
            "protocolVersion"
        )
        return JSONResponse(_rpc_ok(request_id, {
            "protocolVersion": asked if asked in SUPPORTED_PROTOCOLS else PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "title": "Nirikkha CQ marker",
                           "version": SERVER_VERSION},
            "instructions": INSTRUCTIONS,
        }))

    if method == "ping":
        return JSONResponse(_rpc_ok(request_id, {}))

    if method == "tools/list":
        return JSONResponse(_rpc_ok(request_id, {"tools": TOOLS}))

    # Clients probe these at startup even when the capability is not advertised.
    # An empty list is a true answer and quieter than an error.
    if method in {"resources/list", "resources/templates/list"}:
        return JSONResponse(_rpc_ok(request_id, {"resources": [], "resourceTemplates": []}))
    if method == "prompts/list":
        return JSONResponse(_rpc_ok(request_id, {"prompts": []}))

    if method != "tools/call":
        return JSONResponse(_rpc_error(request_id, -32601, f"Method not found: {method}"))

    # Everything past this point touches user data.
    from .main import current_user  # imported here to avoid a circular import

    try:
        caller = await current_user(authorization)
    except Exception:
        return _unauthenticated(
            request, request_id,
            "Not authenticated. Sign in to Nirikkha, or connect with an account token.",
        )

    params = body.get("params") or {}
    name = params.get("name")
    args = params.get("arguments") or {}
    if not isinstance(args, dict):
        return JSONResponse(_rpc_error(request_id, -32602, "arguments must be an object"))

    handler = HANDLERS.get(name)
    if handler is None:
        return JSONResponse(_rpc_error(request_id, -32602, f"Unknown tool: {name}"))

    try:
        if name in OWNED:
            row = await _authorise(str(args.get("submission_id") or ""), caller.id, caller.role)
            if name == "get_cq_result":
                # Already read while authorising; do not read it twice.
                return JSONResponse(_rpc_ok(request_id, _tool_result(
                    await _result_payload(row["id"], row)
                )))
        payload = await handler(args, caller)
        return JSONResponse(_rpc_ok(request_id, _tool_result(payload)))
    except AgentError as exc:
        # A tool-level failure is reported inside the result, not as a protocol
        # error, so the model can read it and decide what to do next.
        return JSONResponse(_rpc_ok(request_id, _tool_result({"error": str(exc)}, is_error=True)))
    except Exception as exc:
        log.exception("mcp tool %s failed", name)
        return JSONResponse(
            _rpc_ok(request_id, _tool_result({"error": f"{type(exc).__name__}: {exc}"},
                                             is_error=True))
        )
