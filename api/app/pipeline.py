"""The pipeline: read → gate → grade → await teacher → release.

The gate is the product. Everything else is transport.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC
from typing import Any

from . import db
from .agents.base import AgentError
from .agents.grader import blank_answer_result, build_transcript, get_grader
from .agents.ocr import UnreadableScript, get_ocr_provider
from .config import settings
from .schemas import CQ_PARTS, SubmissionStatus

log = logging.getLogger("nirikkha.pipeline")


async def _set_status(
    submission_id: str, status: SubmissionStatus, **fields: Any
) -> None:
    await db.update(
        "submissions",
        params={"id": f"eq.{submission_id}"},
        payload={"status": status.value, **fields},
    )


async def _fail(submission_id: str, message: str) -> None:
    log.error("submission %s failed: %s", submission_id, message)
    await _set_status(submission_id, SubmissionStatus.FAILED, error=message[:2000])


def needs_clarification(line: dict[str, Any], threshold: float) -> bool:
    """A line needs a human when the transcription is not trustworthy and
    nobody has fixed it yet."""
    if (line.get("clarified_text") or "").strip():
        return False
    if line.get("is_guess"):
        return True
    legibility = line.get("legibility")
    return legibility is not None and float(legibility) < threshold


async def run_ocr(submission_id: str) -> dict[str, Any]:
    """Stage 1 — transcribe, then decide whether a human is needed.

    On exit the submission is either `awaiting_student` (illegible lines to
    resolve) or has moved straight on to grading.
    """
    submission = await db.select_one("submissions", params={"id": f"eq.{submission_id}", "select": "*"})
    if not submission:
        raise AgentError(f"submission {submission_id} not found")
    paths = submission.get("image_paths") or (
        [submission["image_path"]] if submission.get("image_path") else []
    )
    if not paths:
        raise AgentError("submission has no image to read")

    await _set_status(submission_id, SubmissionStatus.OCR_RUNNING, error=None)

    try:
        pages = list(await asyncio.gather(*(db.download(path) for path in paths)))
        provider = get_ocr_provider()
        result = await provider.read(pages)
    except UnreadableScript as exc:
        # Rotated, blurred, or not an answer script. Refusing is the correct
        # outcome — a fabricated grade on an unreadable page is the worst
        # failure this system could have. The message is written for the student.
        message = str(exc)
        await _set_status(
            submission_id, SubmissionStatus.FAILED,
            error=message, needs_human_review=False, review_reason=exc.reason,
        )
        return {"status": SubmissionStatus.FAILED.value, "unreadable": True,
                "reason": exc.reason, "message": message}
    except Exception as exc:
        await _fail(submission_id, f"OCR failed: {exc}")
        raise

    # Replace rather than append: re-running OCR must not leave stale lines
    # behind, and the unique (submission_id, line_index) constraint would
    # otherwise reject the write.
    await db.delete("ocr_lines", params={"submission_id": f"eq.{submission_id}"})

    if result.lines:
        await db.insert("ocr_lines", [
            {
                "submission_id": submission_id,
                "line_index": line.index,
                "text": line.text,
                "legibility": line.legibility,
                "is_guess": line.is_guess,
                "bbox": line.bbox.model_dump() if line.bbox else None,
            }
            for line in result.lines
        ])

    threshold = settings.legibility_threshold
    stored = await db.select("ocr_lines", params={
        "submission_id": f"eq.{submission_id}", "select": "*", "order": "line_index.asc",
    })

    # If the engine reported no legibility at all, the gate has no signal to
    # threshold on. Fall back to flagging guessed lines only, and say so — a
    # silently disabled gate would be worse than a noisy one.
    flagged = [line for line in stored if needs_clarification(line, threshold)]
    if not result.supports_legibility:
        log.warning(
            "OCR engine %s reported no legibility; gate is running on is_guess alone",
            result.engine,
        )

    if flagged:
        await _set_status(
            submission_id, SubmissionStatus.AWAITING_STUDENT,
            ocr_engine=result.engine, needs_human_review=True, review_reason="low_legibility",
        )
        return {"status": SubmissionStatus.AWAITING_STUDENT.value,
                "flagged_lines": [line["line_index"] for line in flagged],
                "engine": result.engine}

    await db.update("submissions", params={"id": f"eq.{submission_id}"},
                    payload={"ocr_engine": result.engine})
    return await run_grading(submission_id)


async def run_grading(submission_id: str) -> dict[str, Any]:
    """Stage 2 — mark the transcript. Lands in `awaiting_teacher`, never
    straight to `released`: a human always releases."""
    submission = await db.select_one("submissions", params={"id": f"eq.{submission_id}", "select": "*"})
    if not submission:
        raise AgentError(f"submission {submission_id} not found")

    lines = await db.select("ocr_lines", params={
        "submission_id": f"eq.{submission_id}", "select": "*", "order": "line_index.asc",
    })

    await _set_status(submission_id, SubmissionStatus.GRADING, error=None)

    has_text = any((line.get("clarified_text") or line.get("text") or "").strip() for line in lines)

    try:
        if not has_text:
            # No model call on an empty page — cheaper, and it cannot hallucinate.
            result = blank_answer_result()
            grader_name = "short-circuit:blank"
        else:
            transcript = build_transcript(lines)
            grader = get_grader()
            result = await grader.grade(submission.get("question_text") or "", transcript)
            grader_name = f"{grader.name}:{settings.grader_model}"
        # Persisting is inside the try on purpose: a write that fails here used
        # to leave the submission stuck in `grading` with no error recorded and
        # no route out of it.
        await db.upsert(
            "marks",
            [
                {
                    "submission_id": submission_id,
                    "part": mark.part,
                    "max_marks": mark.max_marks,
                    "awarded": mark.awarded,
                    "reason": mark.reason,
                    "improvement": mark.improvement,
                    "evidence_lines": mark.evidence_lines,
                    # Kept so the panel can show what the agent proposed even
                    # after a teacher changes the mark or rewrites its wording.
                    "ai_awarded": mark.awarded,
                    "ai_reason": mark.reason,
                    "ai_improvement": mark.improvement,
                    # Marking again is the agent speaking afresh, so an earlier
                    # rewrite no longer applies to text it has not seen.
                    "edited_by": None,
                    "edited_at": None,
                }
                for mark in result.parts
            ],
            on_conflict="submission_id,part",
        )
    except Exception as exc:
        await _fail(submission_id, f"Grading failed: {exc}")
        raise

    still_unclear = any(
        needs_clarification(line, settings.legibility_threshold) for line in lines
    )
    review_reason = (
        "grader_uncertain" if result.grader_uncertain
        else ("low_legibility" if still_unclear else None)
    )

    await _set_status(
        submission_id, SubmissionStatus.AWAITING_TEACHER,
        marks_stale=False,
        ai_feedback=result.feedback,
        feedback_edited_by=None,
        feedback_edited_at=None,
        total_awarded=result.total_awarded,
        total_max=sum(m for _, m, _ in CQ_PARTS.values()),
        feedback=result.feedback,
        grader_model=grader_name,
        needs_human_review=bool(review_reason),
        review_reason=review_reason,
    )

    return {
        "status": SubmissionStatus.AWAITING_TEACHER.value,
        "total_awarded": result.total_awarded,
        "grader": grader_name,
        "needs_human_review": bool(review_reason),
    }


async def clarify_line(submission_id: str, line_index: int, text: str) -> dict[str, Any]:
    """A human resolved an illegible line. If that was the last one outstanding,
    grading resumes automatically."""
    from datetime import datetime

    updated = await db.update(
        "ocr_lines",
        params={"submission_id": f"eq.{submission_id}", "line_index": f"eq.{line_index}"},
        payload={
            "clarified_text": text.strip(),
            "clarified_at": datetime.now(UTC).isoformat(),
            "is_guess": False,
        },
    )
    if not updated:
        raise AgentError(f"line {line_index} not found on submission {submission_id}")

    lines = await db.select("ocr_lines", params={
        "submission_id": f"eq.{submission_id}", "select": "*", "order": "line_index.asc",
    })
    remaining = [
        line["line_index"] for line in lines
        if needs_clarification(line, settings.legibility_threshold)
    ]
    if remaining:
        return {"status": SubmissionStatus.AWAITING_STUDENT.value, "flagged_lines": remaining}

    # Claim the transition before grading. Two clarifications arriving together
    # would otherwise both find nothing outstanding and each start a model call;
    # the conditional update means only one wins.
    claimed = await db.update(
        "submissions",
        params={"id": f"eq.{submission_id}",
                "status": f"eq.{SubmissionStatus.AWAITING_STUDENT.value}"},
        payload={"status": SubmissionStatus.GRADING.value},
    )
    if not claimed:
        current = await db.select_one(
            "submissions", params={"id": f"eq.{submission_id}", "select": "status"}
        )
        return {"status": (current or {}).get("status", SubmissionStatus.GRADING.value),
                "flagged_lines": []}

    return await run_grading(submission_id)


async def apply_override(
    submission_id: str,
    teacher_id: str,
    part: str,
    new_awarded: int | None = None,
    note: str | None = None,
    reason: str | None = None,
    improvement: str | None = None,
) -> dict[str, Any]:
    """Teacher changes a mark. The old value is preserved in `overrides`
    forever — that history is the evidence the human-in-the-loop is real."""
    current = await db.select_one("marks", params={
        "submission_id": f"eq.{submission_id}", "part": f"eq.{part}", "select": "*",
    })
    if not current:
        raise AgentError(f"no mark for part {part} on submission {submission_id}")

    old = int(current["awarded"])
    changes: dict[str, Any] = {}

    if new_awarded is not None:
        cap = CQ_PARTS[part][1]
        if not 0 <= new_awarded <= cap:
            raise AgentError(f"part {part} is out of {cap}")
        if new_awarded != old:
            changes["awarded"] = new_awarded
            await db.insert("overrides", {
                "submission_id": submission_id,
                "part": part,
                "teacher_id": teacher_id,
                "old_awarded": old,
                "new_awarded": new_awarded,
                "note": note,
            })

    # The agent's wording is already preserved in ai_reason / ai_improvement, so
    # a rewrite replaces what the student reads without losing what was proposed.
    if reason is not None:
        changes["reason"] = reason.strip()
    if improvement is not None:
        changes["improvement"] = improvement.strip()

    if reason is not None or improvement is not None:
        from datetime import UTC, datetime
        changes["edited_by"] = teacher_id
        changes["edited_at"] = datetime.now(UTC).isoformat()

    if changes:
        await db.update("marks", params={"id": f"eq.{current['id']}"}, payload=changes)

    marks = await db.select("marks", params={"submission_id": f"eq.{submission_id}", "select": "*"})
    total = sum(int(m["awarded"]) for m in marks)
    await db.update("submissions", params={"id": f"eq.{submission_id}"},
                    payload={"total_awarded": total})
    return {
        "part": part,
        "old_awarded": old,
        "new_awarded": new_awarded if new_awarded is not None else old,
        "total_awarded": total,
    }


async def release(submission_id: str, teacher_id: str | None = None) -> dict[str, Any]:
    from datetime import UTC, datetime

    submission = await db.select_one(
        "submissions", params={"id": f"eq.{submission_id}", "select": "status,marks_stale"}
    )
    if not submission:
        raise AgentError("submission not found")
    if submission.get("marks_stale"):
        raise AgentError(
            "The transcript changed after marking. Mark it again before releasing, "
            "so the published score matches the text it came from."
        )

    marks = await db.select("marks", params={"submission_id": f"eq.{submission_id}", "select": "*"})
    if not marks:
        raise AgentError("cannot release a submission that has no marks")

    total = sum(int(m["awarded"]) for m in marks)
    payload: dict[str, Any] = {
        "total_awarded": total,
        "needs_human_review": False,
        "review_reason": None,
        "released_at": datetime.now(UTC).isoformat(),
    }
    if teacher_id:
        payload["reviewed_by"] = teacher_id
        payload["reviewed_at"] = datetime.now(UTC).isoformat()
    await _set_status(submission_id, SubmissionStatus.RELEASED, **payload)
    return {"status": SubmissionStatus.RELEASED.value, "total_awarded": total}


async def edit_line(submission_id: str, line_index: int, text: str) -> dict[str, Any]:
    """A teacher corrects a transcribed line.

    Unlike `clarify_line` this does not resume grading: correcting the text
    invalidates marks that were computed from the old text, so the submission is
    flagged stale and the teacher decides when to mark it again. Publishing a
    score that no longer matches the transcript it came from would be worse than
    making them press a button.
    """
    from datetime import UTC, datetime

    updated = await db.update(
        "ocr_lines",
        params={"submission_id": f"eq.{submission_id}", "line_index": f"eq.{line_index}"},
        payload={
            "clarified_text": text.strip(),
            "clarified_at": datetime.now(UTC).isoformat(),
            "is_guess": False,
        },
    )
    if not updated:
        raise AgentError(f"line {line_index} not found on submission {submission_id}")

    submission = await db.select_one(
        "submissions", params={"id": f"eq.{submission_id}", "select": "status"}
    )
    already_marked = (submission or {}).get("status") in {
        SubmissionStatus.AWAITING_TEACHER.value,
        SubmissionStatus.RELEASED.value,
    }
    if already_marked:
        await db.update("submissions", params={"id": f"eq.{submission_id}"},
                        payload={"marks_stale": True})

    return {"line_index": line_index, "marks_stale": already_marked}


async def regrade(submission_id: str) -> dict[str, Any]:
    """Mark the script again from the current transcript.

    Teacher overrides are not silently reinstated — the grader is marking text it
    has not seen before, so its verdict stands and the earlier overrides remain in
    the audit trail for the teacher to reapply if they still hold.
    """
    return await run_grading(submission_id)


async def set_teacher_feedback(submission_id: str, teacher_id: str, text: str) -> dict[str, Any]:
    from datetime import UTC, datetime

    await db.update(
        "submissions", params={"id": f"eq.{submission_id}"},
        payload={
            "teacher_feedback": text.strip() or None,
            "reviewed_by": teacher_id,
            "reviewed_at": datetime.now(UTC).isoformat(),
        },
    )
    return {"teacher_feedback": text.strip()}


async def set_feedback(submission_id: str, teacher_id: str, text: str) -> dict[str, Any]:
    """Rewrite the agent's overall feedback.

    The agent's own words stay in `ai_feedback`, and the student is told whose
    words they are now reading — an unattributed correction is worth less to
    them, and attaching a name keeps the teacher answerable for it.
    """
    from datetime import UTC, datetime

    await db.update(
        "submissions", params={"id": f"eq.{submission_id}"},
        payload={
            "feedback": text.strip() or None,
            "feedback_edited_by": teacher_id,
            "feedback_edited_at": datetime.now(UTC).isoformat(),
        },
    )
    return {"feedback": text.strip()}
