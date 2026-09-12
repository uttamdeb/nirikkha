"""End-to-end walk of the whole pipeline against a running API.

Exercises the path that matters: upload → OCR → the gate stops on an illegible
line → student clarifies → grading resumes → teacher overrides a mark → release.
Also asserts the authorisation boundaries, because the service key bypasses RLS
and those checks live in application code.

    python tests/e2e.py            # against http://127.0.0.1:8099
    API=https://... python tests/e2e.py
"""

from __future__ import annotations

import json
import os
import struct
import sys
import zlib

import httpx

API = os.environ.get("API", "http://127.0.0.1:8099").rstrip("/")
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
PUBLISHABLE = os.environ["SUPABASE_PUBLISHABLE_KEY"]
PASSWORD = "NirikkhaDemo!2026"

passed = failed = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  \033[32m✓\033[0m {label}")
    else:
        failed += 1
        print(f"  \033[31m✗\033[0m {label}" + (f"  — {detail}" if detail else ""))


def png(width: int = 64, height: int = 64) -> bytes:
    """A real 1-bit PNG, so mime sniffing and the storage bucket's
    allowed_mime_types both behave as they will in production."""
    raw = b"".join(b"\x00" + b"\xff" * (width * 3) for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


def sign_in(email: str) -> str:
    r = httpx.post(
        f"{SUPABASE_URL}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": PUBLISHABLE, "Content-Type": "application/json"},
        json={"email": email, "password": PASSWORD},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def main() -> int:
    print("\n\033[1mNirikkha end-to-end\033[0m →", API, "\n")

    student = sign_in("student.demo@nirikkha.test")
    teacher = sign_in("teacher.demo@nirikkha.test")
    s_auth = {"Authorization": f"Bearer {student}"}
    t_auth = {"Authorization": f"Bearer {teacher}"}
    c = httpx.Client(timeout=120)

    print("\033[1mauth\033[0m")
    check("unauthenticated request is rejected", c.get(f"{API}/api/submissions").status_code == 401)
    check("bad token is rejected",
          c.get(f"{API}/api/submissions", headers={"Authorization": "Bearer nope"}).status_code == 401)
    check("student is not a teacher",
          c.get(f"{API}/api/review-queue", headers=s_auth).status_code == 403)
    check("teacher reaches the review queue",
          c.get(f"{API}/api/review-queue", headers=t_auth).status_code == 200)

    print("\n\033[1mrubric\033[0m")
    rubric = c.get(f"{API}/api/rubric").json()
    check("total is 10", rubric["total"] == 10, str(rubric["total"]))
    check("four parts ক খ গ ঘ",
          [p["bangla"] for p in rubric["parts"]] == ["ক", "খ", "গ", "ঘ"])
    check("mark split is 1/2/3/4",
          [p["max_marks"] for p in rubric["parts"]] == [1, 2, 3, 4])

    print("\n\033[1mupload\033[0m")
    r = c.post(
        f"{API}/api/submissions", headers=s_auth,
        data={"question_text": "উদ্দীপক: ৫ কেজি ভরের একটি বস্তুর উপর ২০ N বল প্রয়োগ করা হলো।\n"
                               "ক) ত্বরণ কাকে বলে?\nখ) বল ও ত্বরণের সম্পর্ক ব্যাখ্যা করো।\n"
                               "গ) উদ্দীপকের বস্তুটির ত্বরণ নির্ণয় করো।\n"
                               "ঘ) ভর দ্বিগুণ হলে কী ঘটবে — বিশ্লেষণ করো।",
              "subject": "পদার্থবিজ্ঞান"},
        files={"script": ("script.png", png(), "image/png")},
    )
    check("submission created", r.status_code == 201, r.text[:200])
    if r.status_code != 201:
        return 1
    sid = r.json()["id"]
    check("stored under the owner's folder", r.json()["image_path"].split("/")[0] != sid)

    check("rejects an empty file",
          c.post(f"{API}/api/submissions", headers=s_auth,
                 data={"question_text": "x"},
                 files={"script": ("e.png", b"", "image/png")}).status_code == 400)
    check("rejects an unsupported type",
          c.post(f"{API}/api/submissions", headers=s_auth,
                 data={"question_text": "x"},
                 files={"script": ("e.exe", b"MZ\x00\x00", "application/x-msdownload")}
                 ).status_code == 415)

    print("\n\033[1mmulti-page\033[0m")
    multi = c.post(
        f"{API}/api/submissions", headers=s_auth,
        data={"question_text": "উদ্দীপক: বহু পাতার উত্তর।", "subject": "পদার্থবিজ্ঞান"},
        files=[("script", ("p1.png", png(), "image/png")),
               ("script", ("p2.png", png(), "image/png")),
               ("script", ("p3.png", png(), "image/png"))],
    )
    check("accepts three pages", multi.status_code == 201, multi.text[:200])
    if multi.status_code == 201:
        check("reports the page count", multi.json().get("pages") == 3, str(multi.json()))
        stored = multi.json().get("image_paths", [])
        check("each page gets its own key", len(set(stored)) == 3, str(stored))
        check("all pages sit under the owner's folder",
              all(p.split("/")[0] == stored[0].split("/")[0] for p in stored))
        mv = c.get(f"{API}/api/submissions/{multi.json()['id']}", headers=s_auth).json()
        check("view returns a signed URL per page", len(mv.get("image_urls", [])) == 3,
              str(len(mv.get("image_urls", []))))
        check("image_url still points at the first page",
              mv.get("image_url") == (mv.get("image_urls") or [None])[0])

    check("rejects a fourth page",
          c.post(f"{API}/api/submissions", headers=s_auth,
                 data={"question_text": "x"},
                 files=[("script", (f"p{i}.png", png(), "image/png")) for i in range(4)]
                 ).status_code == 413)
    check("rejects an empty page among good ones",
          c.post(f"{API}/api/submissions", headers=s_auth,
                 data={"question_text": "x"},
                 files=[("script", ("ok.png", png(), "image/png")),
                        ("script", ("bad.png", b"", "image/png"))]).status_code == 400)
    check("rejects a bad type among good ones",
          c.post(f"{API}/api/submissions", headers=s_auth,
                 data={"question_text": "x"},
                 files=[("script", ("ok.png", png(), "image/png")),
                        ("script", ("x.exe", b"MZ\x00", "application/x-msdownload"))]
                 ).status_code == 415)

    print("\n\033[1mquestion is optional\033[0m")
    noq = c.post(f"{API}/api/submissions", headers=s_auth,
                 data={"subject": "রসায়ন"},
                 files={"script": ("s.png", png(), "image/png")})
    check("accepts a submission with no question", noq.status_code == 201, noq.text[:160])

    print("\n\033[1mocr + the gate\033[0m")
    r = c.post(f"{API}/api/submissions/{sid}/process", headers=s_auth)
    check("process succeeded", r.status_code == 200, r.text[:300])
    if r.status_code != 200:
        return 1
    body = r.json()
    check("gate stopped for a human", body["status"] == "awaiting_student", json.dumps(body))
    flagged = body.get("flagged_lines", [])
    check("exactly the illegible line was flagged", flagged == [4], str(flagged))

    view = c.get(f"{API}/api/submissions/{sid}", headers=s_auth).json()
    check("lines were stored", len(view["lines"]) == 6, str(len(view["lines"])))
    check("line indexes are contiguous",
          [ln["index"] for ln in view["lines"]] == list(range(6)))
    check("bboxes survived the round trip", all(ln["bbox"] for ln in view["lines"]))
    check("flagged line is marked for clarification",
          view["lines"][4]["needs_clarification"] is True)
    check("legible lines are not flagged",
          all(not view["lines"][i]["needs_clarification"] for i in (0, 1, 2, 3, 5)))
    check("no marks awarded before the gate clears", view["marks"] == [])
    check("signed image URL issued", bool(view["image_url"]))

    print("\n\033[1mclarification\033[0m")
    check("rejects an empty clarification",
          c.post(f"{API}/api/submissions/{sid}/clarify", headers=s_auth,
                 json={"line_index": 4, "text": ""}).status_code == 422)
    check("rejects an unknown line",
          c.post(f"{API}/api/submissions/{sid}/clarify", headers=s_auth,
                 json={"line_index": 99, "text": "x"}).status_code == 400)

    r = c.post(f"{API}/api/submissions/{sid}/clarify", headers=s_auth,
               json={"line_index": 4, "text": "ঘ) ভর বাড়লে একই বলে ত্বরণ কমে যাবে।"})
    check("clarification accepted", r.status_code == 200, r.text[:300])
    body = r.json()
    check("grading resumed automatically", body["status"] == "awaiting_teacher", json.dumps(body))

    view = c.get(f"{API}/api/submissions/{sid}", headers=s_auth).json()
    check("clarified text stored", view["lines"][4]["clarified_text"] is not None)
    check("line no longer flagged", view["lines"][4]["needs_clarification"] is False)

    print("\n\033[1mgrading\033[0m")
    check("four marks written", len(view["marks"]) == 4, str(len(view["marks"])))
    check("parts in ক খ গ ঘ order",
          [m["part"] for m in view["marks"]] == ["ka", "kha", "ga", "gha"])
    check("每 mark within its own maximum".replace("每", "each "),
          all(0 <= m["awarded"] <= m["max_marks"] for m in view["marks"]))
    check("total equals the sum of parts",
          view["total_awarded"] == sum(m["awarded"] for m in view["marks"]),
          f'{view["total_awarded"]} vs {sum(m["awarded"] for m in view["marks"])}')
    check("total_max is 10", view["total_max"] == 10)
    check("feedback present", bool(view["feedback"]))
    check("provenance recorded", bool(view["ocr_engine"]) and bool(view["grader_model"]))

    print("\n\033[1mteacher override\033[0m")
    before = next(m for m in view["marks"] if m["part"] == "gha")
    check("student cannot override",
          c.post(f"{API}/api/submissions/{sid}/override", headers=s_auth,
                 json={"part": "gha", "new_awarded": 4}).status_code == 403)
    # 400 or 422 depending on whether the schema or the pipeline catches it: the
    # ceiling is the mark's own max_marks now, which an exam rubric may raise.
    check("override above the part maximum is rejected",
          c.post(f"{API}/api/submissions/{sid}/override", headers=t_auth,
                 json={"part": "gha", "new_awarded": 99}).status_code in (400, 422))
    check("override on an unknown part is rejected",
          c.post(f"{API}/api/submissions/{sid}/override", headers=t_auth,
                 json={"part": "xyz", "new_awarded": 1}).status_code == 422)

    new_mark = 4 if before["awarded"] != 4 else 3
    r = c.post(f"{API}/api/submissions/{sid}/override", headers=t_auth,
               json={"part": "gha", "new_awarded": new_mark, "note": "যুক্তি যথেষ্ট স্পষ্ট।"})
    check("override accepted", r.status_code == 200, r.text[:200])
    check("returns old and new", r.json()["old_awarded"] == before["awarded"]
          and r.json()["new_awarded"] == new_mark, json.dumps(r.json()))

    audit = c.get(f"{API}/api/submissions/{sid}/overrides", headers=t_auth).json()
    check("override written to the audit trail", len(audit) == 1, str(len(audit)))
    check("audit keeps the original mark", audit[0]["old_awarded"] == before["awarded"])

    view = c.get(f"{API}/api/submissions/{sid}", headers=s_auth).json()
    check("total recalculated after override",
          view["total_awarded"] == sum(m["awarded"] for m in view["marks"]))

    print("\n\033[1mrelease\033[0m")
    check("student cannot release",
          c.post(f"{API}/api/submissions/{sid}/release", headers=s_auth).status_code == 403)
    r = c.post(f"{API}/api/submissions/{sid}/release", headers=t_auth)
    check("teacher released", r.status_code == 200, r.text[:200])
    view = c.get(f"{API}/api/submissions/{sid}", headers=s_auth).json()
    check("status is released", view["status"] == "released")
    check("released_at set", bool(view["released_at"]))
    check("review flag cleared", view["needs_human_review"] is False)

    print("\n\033[1misolation\033[0m")
    other = c.post(
        f"{API}/api/submissions", headers=t_auth,
        data={"question_text": "teacher's own"},
        files={"script": ("s.png", png(), "image/png")},
    )
    if other.status_code == 201:
        oid = other.json()["id"]
        check("student cannot read another user's submission",
              c.get(f"{API}/api/submissions/{oid}", headers=s_auth).status_code == 403)
    check("teacher can read a student's submission",
          c.get(f"{API}/api/submissions/{sid}", headers=t_auth).status_code == 200)
    check("404 for a nonexistent submission",
          c.get(f"{API}/api/submissions/00000000-0000-0000-0000-000000000000",
                headers=s_auth).status_code == 404)

    print(f"\n\033[1m{passed} passed, {failed} failed\033[0m\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
