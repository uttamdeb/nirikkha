"""Production smoke test — drives the deployed service with real models.

Unlike tests/e2e.py this makes no assumptions about which lines a model will
flag; it asserts the pipeline reaches a valid terminal state with coherent
marks, and that authorisation holds.

    API=https://... python tests/smoke_prod.py path/to/script.jpg
"""

from __future__ import annotations

import os
import pathlib
import sys
import time

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


def sign_in(email: str) -> str:
    r = httpx.post(
        f"{SUPABASE_URL}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": PUBLISHABLE},
        json={"email": email, "password": PASSWORD},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["access_token"]


QUESTION = (
    "উদ্দীপক: ৫ কেজি ভরের একটি বস্তুর উপর ২০ N বল প্রয়োগ করা হলো।\n"
    "ক) ত্বরণ কাকে বলে?\n"
    "খ) বল ও ত্বরণের সম্পর্ক ব্যাখ্যা করো।\n"
    "গ) উদ্দীপকের বস্তুটির ত্বরণ নির্ণয় করো।\n"
    "ঘ) ভর দ্বিগুণ হলে কী ঘটবে বিশ্লেষণ করো।"
)


def main() -> int:
    image_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/nk_script.jpg"
    print(f"\n\033[1mProduction smoke\033[0m → {API}\n  script: {image_path}\n")

    student = {"Authorization": f"Bearer {sign_in('student.demo@nirikkha.test')}"}
    teacher = {"Authorization": f"Bearer {sign_in('teacher.demo@nirikkha.test')}"}
    c = httpx.Client(timeout=180)

    health = c.get(f"{API}/health").json()
    print("\033[1menvironment\033[0m")
    check("service healthy", health.get("ok") is True)
    check("real OCR engine wired", health["ocr"]["provider"] != "stub", health["ocr"]["provider"])
    check("real grader wired", health["grader"]["provider"] != "stub", health["grader"]["provider"])
    check("supabase configured", health["supabase_configured"] is True)

    print("\n\033[1mauthorisation\033[0m")
    check("anonymous blocked", c.get(f"{API}/api/submissions").status_code == 401)
    check("student blocked from review queue",
          c.get(f"{API}/api/review-queue", headers=student).status_code == 403)

    print("\n\033[1mpipeline (real models)\033[0m")
    t0 = time.time()
    r = c.post(
        f"{API}/api/submissions", headers=student,
        data={"question_text": QUESTION, "subject": "পদার্থবিজ্ঞান"},
        files={"script": ("script.jpg", pathlib.Path(image_path).read_bytes(), "image/jpeg")},
    )
    check("uploaded", r.status_code == 201, r.text[:200])
    if r.status_code != 201:
        return 1
    sid = r.json()["id"]

    r = c.post(f"{API}/api/submissions/{sid}/process", headers=student)
    check("processed", r.status_code == 200, r.text[:300])
    if r.status_code != 200:
        return 1
    outcome = r.json()
    elapsed = time.time() - t0
    print(f"     status={outcome.get('status')}  {elapsed:.1f}s")

    view = c.get(f"{API}/api/submissions/{sid}", headers=student).json()
    check("OCR produced lines", len(view["lines"]) > 0, str(len(view["lines"])))
    check("engine recorded", bool(view["ocr_engine"]), str(view["ocr_engine"]))
    print(f"     engine={view['ocr_engine']}  lines={len(view['lines'])}")

    if outcome.get("status") == "awaiting_student":
        flagged = [ln for ln in view["lines"] if ln["needs_clarification"]]
        print(f"     gate fired on {len(flagged)} line(s) — clarifying the first")
        check("gate flagged at least one line", len(flagged) > 0)
        r = c.post(f"{API}/api/submissions/{sid}/clarify", headers=student,
                   json={"line_index": flagged[0]["index"], "text": "স্পষ্ট করে লেখা হলো।"})
        check("clarification accepted", r.status_code == 200, r.text[:200])
        # Resolve any remaining flags so the run reaches a terminal state.
        for _ in range(12):
            view = c.get(f"{API}/api/submissions/{sid}", headers=student).json()
            rest = [ln for ln in view["lines"] if ln["needs_clarification"]]
            if not rest:
                break
            c.post(f"{API}/api/submissions/{sid}/clarify", headers=student,
                   json={"line_index": rest[0]["index"], "text": "স্পষ্ট করে লেখা হলো।"})
        view = c.get(f"{API}/api/submissions/{sid}", headers=student).json()
    elif outcome.get("unreadable"):
        print(f"     model judged the page unreadable: {outcome.get('message', '')[:90]}")
        check("unreadable path returns a student-facing message", bool(outcome.get("message")))
        print(f"\n\033[1m{passed} passed, {failed} failed\033[0m\n")
        return 1 if failed else 0
    else:
        check("gate passed cleanly (no illegible lines)", True)

    print("\n\033[1mmarks\033[0m")
    check("reached the teacher queue", view["status"] == "awaiting_teacher", view["status"])
    check("four parts marked", len(view["marks"]) == 4, str(len(view["marks"])))
    check("parts in ক খ গ ঘ order",
          [m["part"] for m in view["marks"]] == ["ka", "kha", "ga", "gha"])
    check("each mark within its maximum",
          all(0 <= m["awarded"] <= m["max_marks"] for m in view["marks"]))
    check("total equals the sum of parts",
          view["total_awarded"] == sum(m["awarded"] for m in view["marks"]))
    check("grader recorded", bool(view["grader_model"]), str(view["grader_model"]))
    check("feedback in Bangla", any("ঀ" <= ch <= "৿" for ch in view["feedback"] or ""))
    check("every part carries a reason", all(m["reason"] for m in view["marks"]))
    lost = [m for m in view["marks"] if m["awarded"] < m["max_marks"]]
    if lost:
        check("parts that lost marks carry improvement guidance",
              all(m["improvement"] for m in lost),
              f"{sum(1 for m in lost if not m['improvement'])} missing")
    for m in view["marks"]:
        print(f"     {m['bangla']} {m['awarded']}/{m['max_marks']}  {m['reason'][:58]}")
        if m["improvement"]:
            print(f"        → {m['improvement'][:66]}")
    print(f"     TOTAL {view['total_awarded']}/{view['total_max']}")
    print(f"     feedback: {(view['feedback'] or '')[:110]}")

    print("\n\033[1mteacher\033[0m")
    target = view["marks"][3]
    new_value = 0 if target["awarded"] > 0 else 1
    r = c.post(f"{API}/api/submissions/{sid}/override", headers=teacher,
               json={"part": target["part"], "new_awarded": new_value, "note": "smoke test"})
    check("override applied", r.status_code == 200, r.text[:200])
    audit = c.get(f"{API}/api/submissions/{sid}/overrides", headers=teacher).json()
    check("audit trail written", len(audit) >= 1)
    r = c.post(f"{API}/api/submissions/{sid}/release", headers=teacher)
    check("released", r.status_code == 200, r.text[:200])
    final = c.get(f"{API}/api/submissions/{sid}", headers=student).json()
    check("student sees released result", final["status"] == "released")
    check("total recomputed after override",
          final["total_awarded"] == sum(m["awarded"] for m in final["marks"]))

    print(f"\n\033[1m{passed} passed, {failed} failed\033[0m   ({time.time() - t0:.0f}s total)\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
