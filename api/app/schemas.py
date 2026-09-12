"""Wire contracts for the whole pipeline.

Everything crossing a boundary — model output, HTTP request, HTTP response —
is validated here. Model output in particular is never trusted: see
`GradeResult.coerce`, which rejects rather than rounds.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

# --------------------------------------------------------------------- CQ shape

CQ_PARTS: dict[str, tuple[str, int, str]] = {
    # key: (bangla label, max marks, skill)
    "ka": ("ক", 1, "জ্ঞান"),
    "kha": ("খ", 2, "অনুধাবন"),
    "ga": ("গ", 3, "প্রয়োগ"),
    "gha": ("ঘ", 4, "উচ্চতর দক্ষতা"),
}
CQ_TOTAL = sum(m for _, m, _ in CQ_PARTS.values())  # 10

PartKey = Literal["ka", "kha", "ga", "gha"]


class SubmissionStatus(StrEnum):
    RECEIVED = "received"
    OCR_RUNNING = "ocr_running"
    AWAITING_STUDENT = "awaiting_student"
    GRADING = "grading"
    AWAITING_TEACHER = "awaiting_teacher"
    RELEASED = "released"
    FAILED = "failed"


# --------------------------------------------------------------------- OCR

class BBox(BaseModel):
    """Normalised 0..1, origin top-left. Adapters convert into this; nothing
    downstream ever sees a provider's native coordinate convention."""

    x0: float = Field(ge=0, le=1)
    y0: float = Field(ge=0, le=1)
    x1: float = Field(ge=0, le=1)
    y1: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def ordered(self) -> BBox:
        if self.x1 < self.x0:
            self.x0, self.x1 = self.x1, self.x0
        if self.y1 < self.y0:
            self.y0, self.y1 = self.y1, self.y0
        return self

    def is_degenerate(self, min_size: float = 0.002) -> bool:
        return (self.x1 - self.x0) < min_size or (self.y1 - self.y0) < min_size


class OcrLine(BaseModel):
    index: int = Field(ge=0)
    text: str = ""
    legibility: float | None = Field(default=None, ge=0, le=1)
    is_guess: bool = False
    bbox: BBox | None = None

    @field_validator("text", mode="before")
    @classmethod
    def _blank(cls, v: Any) -> str:
        return "" if v is None else str(v)


class OcrResult(BaseModel):
    engine: str
    lines: list[OcrLine] = Field(default_factory=list)
    supports_legibility: bool = False
    supports_bbox: bool = False
    detected_parts: list[str] = Field(default_factory=list)

    @property
    def full_text(self) -> str:
        return "\n".join(line.text for line in self.lines)


# --------------------------------------------------------------------- grading

class PartMark(BaseModel):
    part: PartKey
    max_marks: int
    awarded: int
    reason: str = ""
    improvement: str = ""      # what to write instead, to earn the missing marks
    evidence_lines: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def within_range(self) -> PartMark:
        # Prefer an explicit positive max (exam rubric); otherwise the fixed CQ scheme.
        if self.max_marks <= 0:
            self.max_marks = CQ_PARTS[self.part][1]
        if not 0 <= self.awarded <= self.max_marks:
            raise ValueError(
                f"part {self.part}: awarded {self.awarded} outside 0..{self.max_marks}"
            )
        return self


class GradeResult(BaseModel):
    parts: list[PartMark]
    feedback: str = ""
    grader_uncertain: bool = False

    @property
    def total_awarded(self) -> int:
        # Computed here, never taken from the model. Asking a grader for both
        # the parts and the total invites the two to disagree.
        return sum(p.awarded for p in self.parts)

    @model_validator(mode="after")
    def all_parts_present(self) -> GradeResult:
        seen = {p.part for p in self.parts}
        missing = set(CQ_PARTS) - seen
        if missing:
            raise ValueError(f"missing marks for part(s): {sorted(missing)}")
        if len(self.parts) != len(seen):
            raise ValueError("duplicate part in grade result")
        order = list(CQ_PARTS)
        self.parts.sort(key=lambda p: order.index(p.part))
        return self


# --------------------------------------------------------------------- HTTP

class CreateSubmission(BaseModel):
    # Optional: students often photograph a page that carries the question and
    # their answer together, and retyping the question is exactly the friction
    # this is meant to remove.
    question_text: Annotated[str, Field(default="", max_length=20_000)]
    subject: str | None = Field(default=None, max_length=120)
    image_path: str | None = Field(default=None, max_length=500)


class ClarifyLine(BaseModel):
    line_index: int = Field(ge=0)
    text: Annotated[str, Field(min_length=1, max_length=2_000)]


class OverrideMark(BaseModel):
    """A teacher correcting one part.

    `new_awarded` is optional so the wording can be rewritten without touching
    the mark, and the mark can be changed without rewriting the wording.
    """

    part: PartKey
    new_awarded: int | None = Field(default=None, ge=0)
    reason: str | None = Field(default=None, max_length=2_000)
    improvement: str | None = Field(default=None, max_length=2_000)
    note: str | None = Field(default=None, max_length=1_000)

    @model_validator(mode="after")
    def sane(self) -> OverrideMark:
        # Cap is enforced against the stored mark's max_marks in the pipeline —
        # exam rubrics may differ from the default 1/2/3/4 scheme.
        if self.new_awarded is not None and self.new_awarded > 100:
            raise ValueError(f"part {self.part} is out of range")
        if self.new_awarded is None and self.reason is None and self.improvement is None:
            raise ValueError("nothing to change")
        return self


class LineView(BaseModel):
    index: int
    text: str
    legibility: float | None = None
    is_guess: bool = False
    bbox: BBox | None = None
    clarified_text: str | None = None
    needs_clarification: bool = False


class MarkView(BaseModel):
    part: PartKey
    bangla: str
    skill: str
    max_marks: int
    awarded: int
    ai_awarded: int | None = None      # what the grader proposed, before any override
    reason: str = ""
    improvement: str = ""
    ai_reason: str = ""                # the agent's wording, kept when a teacher rewrites it
    ai_improvement: str = ""
    edited_by: StudentBrief | None = None      # the teacher whose words these now are
    edited_at: str | None = None
    evidence_lines: list[int] = Field(default_factory=list)

    @property
    def overridden(self) -> bool:
        return self.ai_awarded is not None and self.ai_awarded != self.awarded


class Annotation(BaseModel):
    id: str | None = None
    page: int = Field(default=0, ge=0)
    x0: float = Field(ge=0, le=1)
    y0: float = Field(ge=0, le=1)
    x1: float = Field(ge=0, le=1)
    y1: float = Field(ge=0, le=1)
    note: str | None = Field(default=None, max_length=500)
    colour: Literal["red", "green", "amber"] = "red"

    @model_validator(mode="after")
    def ordered_and_visible(self) -> Annotation:
        if self.x1 < self.x0:
            self.x0, self.x1 = self.x1, self.x0
        if self.y1 < self.y0:
            self.y0, self.y1 = self.y1, self.y0
        if (self.x1 - self.x0) < 0.005 or (self.y1 - self.y0) < 0.005:
            raise ValueError("annotation is too small to see; drag a larger box")
        return self


class EditLine(BaseModel):
    line_index: int = Field(ge=0)
    text: Annotated[str, Field(max_length=2_000)]


class TeacherFeedback(BaseModel):
    text: Annotated[str, Field(default="", max_length=2_000)]


class EditFeedback(BaseModel):
    """Rewriting the agent's own overall feedback."""

    text: Annotated[str, Field(default="", max_length=4_000)]


class BulkRelease(BaseModel):
    submission_ids: list[str] = Field(min_length=1, max_length=100)


class StudentBrief(BaseModel):
    """Enough to name a person in the interface, and nothing more."""

    id: str
    email: str | None = None
    full_name: str | None = None

    @property
    def display(self) -> str:
        return self.full_name or (self.email or "").split("@")[0] or "—"


class SubmissionRow(BaseModel):
    """One line in the teacher panel."""

    id: str
    status: SubmissionStatus
    subject: str | None = None
    question_text: str = ""
    total_awarded: int | None = None
    total_max: int = CQ_TOTAL
    needs_human_review: bool = False
    review_reason: str | None = None
    marks_stale: bool = False
    created_at: str | None = None
    released_at: str | None = None
    student: StudentBrief | None = None
    pages: int = 1


class PanelPage(BaseModel):
    rows: list[SubmissionRow]
    total: int                 # every submission, whatever the filter
    matched: int = 0           # how many the current filter and search match
    offset: int = 0
    counts: dict[str, int] = Field(default_factory=dict)
    flagged: int = 0


class SubmissionView(BaseModel):
    id: str
    status: SubmissionStatus
    question_text: str
    subject: str | None = None
    image_path: str | None = None
    image_url: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    needs_human_review: bool = False
    review_reason: str | None = None
    total_awarded: int | None = None
    total_max: int = CQ_TOTAL
    feedback: str | None = None
    ocr_engine: str | None = None
    grader_model: str | None = None
    error: str | None = None
    created_at: str | None = None
    released_at: str | None = None
    teacher_feedback: str | None = None
    ai_feedback: str | None = None
    feedback_edited_by: StudentBrief | None = None
    reviewed_by: StudentBrief | None = None
    marks_stale: bool = False
    reviewed_at: str | None = None
    student: StudentBrief | None = None
    lines: list[LineView] = Field(default_factory=list)
    marks: list[MarkView] = Field(default_factory=list)
    annotations: list[Annotation] = Field(default_factory=list)
