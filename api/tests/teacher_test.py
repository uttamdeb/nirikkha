"""The teacher panel: listing, review, annotations, and the guards around release.

Runs against a server using stub providers.

    python tests/teacher_test.py
"""

from __future__ import annotations

import os
import pathlib
import struct
import sys
import zlib

import httpx

API = os.environ.get("API", "http://127.0.0.1:8099").rstrip("/")
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
PUBLISHABLE = os.environ["SUPABASE_PUBLISHABLE_KEY"]
PASSWORD = "NirikkhaDemo!2026"

passed = failed = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  \033[32m✓\033[0m {label}")
    else:
        failed += 1
        print(f"  \033[31m✗\033[0m {label}" + (f"  — {detail}" if detail else ""))


def png(w: int = 64, h: int = 64) -> bytes:
    raw = b"".join(b"\x00" + b"\xff" * (w * 3) for _ in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def script_bytes() -> tuple[bytes, str]:
    """A page the reader will accept.

    The synthetic PNG is fine against stub providers, but a real vision model
    correctly refuses a blank white square — so when a sample script is on hand,
    use it. SCRIPT=path overrides.
    """
    candidate = os.environ.get("SCRIPT", "/tmp/nk_script.jpg")
    if os.path.exists(candidate):
        mime = "image/png" if candidate.endswith(".png") else "image/jpeg"
        return pathlib.Path(candidate).read_bytes(), mime
    return png(), "image/png"


def sign_in(email: str) -> str:
    r = httpx.post(f"{SUPABASE_URL}/auth/v1/token", params={"grant_type": "password"},
                   headers={"apikey": PUBLISHABLE},
                   json={"email": email, "password": PASSWORD}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


def main() -> int:
    print(f"\n\033[1mTeacher panel\033[0m → {API}\n")
    s = {"Authorization": f"Bearer {sign_in('student.demo@nirikkha.test')}"}
    tch = {"Authorization": f"Bearer {sign_in('teacher.demo@nirikkha.test')}"}
    c = httpx.Client(timeout=180)

    print("\033[1maccess\033[0m")
    for path in (
        "/api/teacher/panel",
        "/api/teacher/stats",
        "/api/teacher/settings",
        "/api/teacher/batches",
        "/api/teacher/exams",
    ):
        check(f"student blocked from {path}", c.get(f"{API}{path}", headers=s).status_code == 403)
        check(f"teacher reaches {path}", c.get(f"{API}{path}", headers=tch).status_code == 200)
    check("anonymous blocked", c.get(f"{API}/api/teacher/panel").status_code == 401)

    print("\033[1mclassroom\033[0m")
    created = c.post(
        f"{API}/api/teacher/batches",
        headers=tch,
        json={"name": "Demo Batch (teacher_test)"},
    )
    check("create batch", created.status_code == 201, created.text[:200])
    batch_id = (created.json().get("batch") or {}).get("id") if created.status_code == 201 else None

    exam = c.post(
        f"{API}/api/teacher/exams",
        headers=tch,
        json={"title": "Demo Exam (teacher_test)"},
    )
    check("create exam", exam.status_code == 201, exam.text[:200])
    exam_id = (exam.json().get("exam") or {}).get("id") if exam.status_code == 201 else None

    if exam_id:
        q = c.post(
            f"{API}/api/teacher/exams/{exam_id}/questions",
            headers=tch,
            json={
                "prompt_text": "স্টাব উদ্দীপক",
                "total_marks": 10,
                "rubric_json": [
                    {"key": "ka", "label": "ক", "title": "জ্ঞান", "prompt": "ক?", "modelAnswer": "", "maxMarks": 1},
                    {"key": "kha", "label": "খ", "title": "অনুধাবন", "prompt": "খ?", "modelAnswer": "", "maxMarks": 2},
                    {"key": "ga", "label": "গ", "title": "প্রয়োগ", "prompt": "গ?", "modelAnswer": "", "maxMarks": 3},
                    {"key": "gha", "label": "ঘ", "title": "উচ্চতর দক্ষতা", "prompt": "ঘ?", "modelAnswer": "", "maxMarks": 4},
                ],
                "approved": True,
            },
        )
        check("add question", q.status_code == 201, q.text[:200])

    if exam_id and batch_id:
        pub = c.post(
            f"{API}/api/teacher/exams/{exam_id}/publish",
            headers=tch,
            json={"batch_id": batch_id},
        )
        check("publish assigns batch", pub.status_code == 200, pub.text[:200])
        if pub.status_code == 200:
            body = pub.json().get("exam") or {}
            check("exam has batch_id", body.get("batch_id") == batch_id)
            check("exam has code", bool(body.get("exam_code")))

    wh = c.post(f"{API}/api/telegram/webhook", json={"update_id": 1})
    check("webhook accepts without secret when unset-or-empty", wh.status_code in (200, 401))

    print("\n\033[1mlisting\033[0m")
    page = c.get(f"{API}/api/teacher/panel", headers=tch).json()
    check("returns rows", len(page["rows"]) > 0, str(len(page["rows"])))
    check("counts every status", len(page["counts"]) > 0, str(page["counts"]))
    check("shows who submitted", any(r.get("student") for r in page["rows"]))
    check("reports page count per script", all(r["pages"] >= 1 for r in page["rows"]))
    check("shows more than the teacher queue",
          page["total"] >= page["counts"].get("awaiting_teacher", 0),
          f'{page["total"]} vs {page["counts"].get("awaiting_teacher")}')

    released = c.get(f"{API}/api/teacher/panel", headers=tch, params={"status": "released"}).json()
    check("filters by status",
          all(r["status"] == "released" for r in released["rows"]), "non-released row present")
    flagged = c.get(f"{API}/api/teacher/panel", headers=tch, params={"flagged": "true"}).json()
    check("filters to flagged only",
          all(r["needs_human_review"] for r in flagged["rows"]), "unflagged row present")
    nomatch = c.get(f"{API}/api/teacher/panel", headers=tch,
                    params={"q": "zzz-no-such-thing"}).json()
    check("search narrows results", len(nomatch["rows"]) == 0, str(len(nomatch["rows"])))
    # Their work was 58th and 59th of 132 while the panel loaded 50 rows and the
    # interface had no way to reach past them.
    print("\n\033[1mpaging and search reach the whole queue\033[0m")
    first = c.get(f"{API}/api/teacher/panel", headers=tch, params={"limit": 5}).json()
    second = c.get(f"{API}/api/teacher/panel", headers=tch,
                   params={"limit": 5, "offset": 5}).json()
    check("offset returns a different page",
          {r["id"] for r in first["rows"]}.isdisjoint({r["id"] for r in second["rows"]}))
    check("the page says how many match", first["matched"] >= len(first["rows"]))
    check("and where in them it is", second["offset"] == 5, str(second["offset"]))

    # Search used to filter only the rows already fetched, so anything past the
    # first page was unfindable by name.
    deep = c.get(f"{API}/api/teacher/panel", headers=tch,
                 params={"q": "student.demo", "limit": 5}).json()
    check("search matches beyond the first page",
          deep["matched"] > 5, f'matched={deep["matched"]}')
    check("search results page too", len(deep["rows"]) <= 5)
    seen = set()
    for page_no in range(6):
        chunk = c.get(f"{API}/api/teacher/panel", headers=tch,
                      params={"q": "student.demo", "limit": 5, "offset": page_no * 5}).json()
        seen.update(r["id"] for r in chunk["rows"])
        if not chunk["rows"]:
            break
    check("paging through a search reaches distinct rows", len(seen) > 5, str(len(seen)))

    check("limit is capped",
          len(c.get(f"{API}/api/teacher/panel", headers=tch,
                    params={"limit": 9999}).json()["rows"]) <= 200)

    print("\n\033[1mstats\033[0m")
    stats = c.get(f"{API}/api/teacher/stats", headers=tch).json()
    check("counts submissions", stats["submissions"] > 0)
    check("has a per-part breakdown", set(stats["per_part"]) == {"ka", "kha", "ga", "gha"})
    check("accuracy is a fraction",
          all(p["accuracy"] is None or 0 <= p["accuracy"] <= 1 for p in stats["per_part"].values()))
    check("override rate is a fraction",
          stats["override_rate"] is None or 0 <= stats["override_rate"] <= 1)

    print("\n\033[1mreview a script\033[0m")
    data, mime = script_bytes()
    made = c.post(f"{API}/api/submissions", headers=s,
                  data={"question_text": "উদ্দীপক: রিভিউ পরীক্ষা।", "subject": "পদার্থবিজ্ঞান"},
                  files={"script": (f"s.{mime.split('/')[1]}", data, mime)})
    sid = made.json()["id"]
    processed = c.post(f"{API}/api/submissions/{sid}/process", headers=s)
    check("the script was accepted for marking",
          not processed.json().get("unreadable"), str(processed.json())[:140])
    view = c.get(f"{API}/api/submissions/{sid}", headers=s).json()
    for line in [ln for ln in view["lines"] if ln["needs_clarification"]]:
        c.post(f"{API}/api/submissions/{sid}/clarify", headers=s,
               json={"line_index": line["index"], "text": "স্পষ্ট করে লেখা।"})
    view = c.get(f"{API}/api/submissions/{sid}", headers=tch).json()
    check("reached the teacher", view["status"] == "awaiting_teacher", view["status"])
    check("teacher sees the student", view.get("student") is not None)
    check("marks carry what the agent proposed",
          all(m["ai_awarded"] is not None for m in view["marks"]))

    print("\n\033[1mediting the transcript\033[0m")
    check("student cannot edit a line",
          c.post(f"{API}/api/submissions/{sid}/edit-line", headers=s,
                 json={"line_index": 0, "text": "x"}).status_code == 403)
    r = c.post(f"{API}/api/submissions/{sid}/edit-line", headers=tch,
               json={"line_index": 0, "text": "ক) সংশোধিত লাইন।"})
    check("teacher edits any line", r.status_code == 200, r.text[:150])
    check("editing after marking flags the marks stale", r.json().get("marks_stale") is True)
    view = c.get(f"{API}/api/submissions/{sid}", headers=tch).json()
    check("stale shows on the submission", view["marks_stale"] is True)
    check("the edit is visible", view["lines"][0]["clarified_text"] == "ক) সংশোধিত লাইন।")

    print("\n\033[1mrelease is guarded\033[0m")
    blocked = c.post(f"{API}/api/submissions/{sid}/release", headers=tch)
    check("stale marks cannot be released", blocked.status_code == 400, str(blocked.status_code))
    check("the reason explains why", "again" in blocked.text or "আবার" in blocked.text,
          blocked.text[:120])

    re = c.post(f"{API}/api/submissions/{sid}/regrade", headers=tch)
    check("teacher can mark it again", re.status_code == 200, re.text[:150])
    view = c.get(f"{API}/api/submissions/{sid}", headers=tch).json()
    check("marking again clears stale", view["marks_stale"] is False)

    print("\n\033[1mteacher's note\033[0m")
    check("student cannot write the teacher's note",
          c.post(f"{API}/api/submissions/{sid}/feedback", headers=s,
                 json={"text": "x"}).status_code == 403)
    c.post(f"{API}/api/submissions/{sid}/feedback", headers=tch,
           json={"text": "গ অংশে এককটি লিখতে ভুলো না।"})
    view = c.get(f"{API}/api/submissions/{sid}", headers=s).json()
    check("the student sees it", view["teacher_feedback"] == "গ অংশে এককটি লিখতে ভুলো না।")
    check("it is separate from the agent's feedback", view["feedback"] != view["teacher_feedback"])

    print("\n\033[1meverything the agent wrote is editable, and attributed\033[0m")
    before = c.get(f"{API}/api/submissions/{sid}", headers=tch).json()
    part = before["marks"][0]["part"]

    check("student cannot rewrite a mark's wording",
          c.post(f"{API}/api/submissions/{sid}/override", headers=s,
                 json={"part": part, "reason": "x"}).status_code == 403)
    check("an override with nothing to change is rejected",
          c.post(f"{API}/api/submissions/{sid}/override", headers=tch,
                 json={"part": part}).status_code == 422)

    r = c.post(f"{API}/api/submissions/{sid}/override", headers=tch,
               json={"part": part, "reason": "সংজ্ঞাটি সঠিক, তবে উদাহরণ নেই।",
                     "improvement": "একটি উদাহরণ যোগ করো।"})
    check("a teacher rewrites the wording without touching the mark",
          r.status_code == 200, r.text[:150])
    view = c.get(f"{API}/api/submissions/{sid}", headers=s).json()
    mark = next(m for m in view["marks"] if m["part"] == part)
    check("the mark itself is unchanged",
          mark["awarded"] == next(m for m in before["marks"] if m["part"] == part)["awarded"])
    check("the student reads the teacher's words",
          mark["reason"] == "সংজ্ঞাটি সঠিক, তবে উদাহরণ নেই।")
    check("the agent's words are kept", bool(mark["ai_reason"]))
    check("and they differ", mark["ai_reason"] != mark["reason"])
    check("the student is told which teacher wrote it",
          (mark.get("edited_by") or {}).get("email") == "teacher.demo@nirikkha.test",
          str(mark.get("edited_by")))

    check("student cannot rewrite the overall feedback",
          c.post(f"{API}/api/submissions/{sid}/edit-feedback", headers=s,
                 json={"text": "x"}).status_code == 403)
    c.post(f"{API}/api/submissions/{sid}/edit-feedback", headers=tch,
           json={"text": "সামগ্রিকভাবে ভালো, উদ্দীপক ব্যবহার করো।"})
    view = c.get(f"{API}/api/submissions/{sid}", headers=s).json()
    check("the overall feedback is now the teacher's",
          view["feedback"] == "সামগ্রিকভাবে ভালো, উদ্দীপক ব্যবহার করো।")
    check("the agent's overall feedback is kept", bool(view["ai_feedback"]))
    check("and the student is told who rewrote it",
          (view.get("feedback_edited_by") or {}).get("email") == "teacher.demo@nirikkha.test")

    # Marking again is the agent speaking about text it has not seen before, so a
    # rewrite from an earlier pass must not be presented as the agent's verdict.
    c.post(f"{API}/api/submissions/{sid}/regrade", headers=tch)
    view = c.get(f"{API}/api/submissions/{sid}", headers=tch).json()
    check("marking again clears a stale attribution",
          all(m.get("edited_by") is None for m in view["marks"]),
          str([m.get("edited_by") for m in view["marks"]]))

    print("\n\033[1mannotations\033[0m")
    check("student cannot annotate",
          c.post(f"{API}/api/submissions/{sid}/annotations", headers=s,
                 json={"page": 0, "x0": .1, "y0": .1, "x1": .4, "y1": .3}).status_code == 403)
    a = c.post(f"{API}/api/submissions/{sid}/annotations", headers=tch,
               json={"page": 0, "x0": .1, "y0": .1, "x1": .45, "y1": .3,
                     "note": "এখানে একক নেই", "colour": "amber"})
    check("teacher draws a box", a.status_code == 201, a.text[:150])
    aid = a.json().get("id")
    check("a box too small to see is rejected",
          c.post(f"{API}/api/submissions/{sid}/annotations", headers=tch,
                 json={"page": 0, "x0": .1, "y0": .1, "x1": .101, "y1": .101}).status_code == 422)
    check("coordinates outside the page are rejected",
          c.post(f"{API}/api/submissions/{sid}/annotations", headers=tch,
                 json={"page": 0, "x0": -1, "y0": .1, "x1": .4, "y1": .3}).status_code == 422)
    view = c.get(f"{API}/api/submissions/{sid}", headers=s).json()
    check("the student sees the annotation", len(view["annotations"]) == 1)
    check("the note travels with it", view["annotations"][0]["note"] == "এখানে একক নেই")
    check("deleting works",
          c.delete(f"{API}/api/submissions/{sid}/annotations/{aid}",
                   headers=tch).status_code == 204)
    check("it is gone",
          len(c.get(f"{API}/api/submissions/{sid}", headers=tch).json()["annotations"]) == 0)

    print("\n\033[1mbulk release\033[0m")
    check("student cannot bulk release",
          c.post(f"{API}/api/teacher/release", headers=s,
                 json={"submission_ids": [sid]}).status_code == 403)
    bulk = c.post(f"{API}/api/teacher/release", headers=tch,
                  json={"submission_ids": [sid, "00000000-0000-0000-0000-000000000000"]})
    check("releases what it can", bulk.json()["released_count"] == 1, bulk.text[:150])
    check("reports what it skipped", bulk.json()["skipped_count"] == 1)
    check("one bad id does not block the rest", sid in bulk.json()["released"])
    check("empty list is rejected",
          c.post(f"{API}/api/teacher/release", headers=tch,
                 json={"submission_ids": []}).status_code == 422)
    check("the released script is released",
          c.get(f"{API}/api/submissions/{sid}", headers=s).json()["status"] == "released")

    print("\n\033[1mteachers keep student powers\033[0m")
    own = c.post(f"{API}/api/submissions", headers=tch,
                 data={"question_text": "শিক্ষক নিজেই জমা দিচ্ছেন।"},
                 files={"script": ("t.png", png(), "image/png")})
    check("a teacher can submit a script too", own.status_code == 201, own.text[:150])
    mine = c.get(f"{API}/api/submissions", headers=tch).json()
    check("and it appears in their own list", any(r["id"] == own.json()["id"] for r in mine))
    # "My scripts" means mine. A teacher sees other people's work in the panel,
    # where every row says whose it is.
    student_sub = c.post(f"{API}/api/submissions", headers=s,
                         data={"question_text": "শিক্ষার্থীর নিজের খাতা।"},
                         files={"script": ("x.png", png(), "image/png")}).json()["id"]
    check("a teacher's own list excludes other people's scripts",
          not any(r["id"] == student_sub for r in
                  c.get(f"{API}/api/submissions", headers=tch).json()))
    check("but the panel shows them",
          any(r["id"] == student_sub for r in
              c.get(f"{API}/api/teacher/panel", headers=tch,
                    params={"limit": 200}).json()["rows"]))

    print(f"\n\033[1m{passed} passed, {failed} failed\033[0m\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
